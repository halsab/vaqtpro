import 'dart:convert';

import 'package:adhan/adhan.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart' as m;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:shared_preferences_platform_interface/shared_preferences_async_platform_interface.dart';
import 'package:vaqtpro/design_system/design_system.dart';
import 'package:vaqtpro/features/location/models/prayer_location.dart';
import 'package:vaqtpro/features/prayer_times/models/calculation_profile.dart';
import 'package:vaqtpro/features/prayer_times/screens/settings_screen.dart';
import 'package:vaqtpro/features/prayer_times/services/prayer_times_calculator.dart';
import 'package:vaqtpro/features/prayer_times/view_models/calculation_profile_view_model.dart';
import 'package:timezone/timezone.dart' as timezone;
// ignore: implementation_imports
import 'package:adhan/src/internal/solar_time.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('automatic profile follows GeoNames country and region codes', () {
    expect(
      prayerCalculationProfileForRegion('RU', '73'),
      PrayerCalculationProfile.tatarstan,
    );
    expect(
      prayerCalculationProfileForRegion('RU', '77'),
      PrayerCalculationProfile.russia,
    );
    expect(
      prayerCalculationProfileForRegion('RU', null),
      PrayerCalculationProfile.russia,
    );
    expect(
      prayerCalculationProfileForRegion('US', 'CA'),
      PrayerCalculationProfile.muslimWorldLeague,
    );
    expect(
      prayerCalculationProfileForRegion(null, null),
      PrayerCalculationProfile.muslimWorldLeague,
    );
  });

  test(
    'manual profile list contains all 12 methods and two regional profiles',
    () {
      expect(PrayerCalculationProfile.values, hasLength(14));
      expect(
        PrayerCalculationProfile.values.where(
          (profile) => profile.calculationMethod != null,
        ),
        hasLength(12),
      );
      expect(
        PrayerCalculationProfile.values.map((profile) => profile.label),
        containsAll([
          'Татарстан',
          'Россия',
          'Всемирная мусульманская лига',
          'Египетский геодезический институт',
          'Карачи',
          'Умм аль-Кура',
          'Дубай',
          'Комитет наблюдения луны',
          'Северная Америка (ISNA)',
          'Кувейт',
          'Катар',
          'Сингапур',
          'Турция (Diyanet)',
          'Тегеран',
        ]),
      );
    },
  );

  test(
    'selecting a profile resets Asr and high-latitude rules to its defaults',
    () {
      final selected = const PrayerCalculationConfiguration(
        mode: PrayerCalculationMode.manual,
        profile: PrayerCalculationProfile.tatarstan,
        madhab: Madhab.shafi,
        highLatitudeRule: PrayerHighLatitudeRule.middleOfTheNight,
      ).selectingProfile(PrayerCalculationProfile.russia);

      expect(selected.profile, PrayerCalculationProfile.russia);
      expect(selected.madhab, Madhab.shafi);
      expect(selected.highLatitudeRule, PrayerHighLatitudeRule.profileRussia);

      final tatarstan = selected.selectingProfile(
        PrayerCalculationProfile.tatarstan,
      );
      expect(tatarstan.madhab, Madhab.hanafi);
      expect(
        tatarstan.highLatitudeRule,
        PrayerHighLatitudeRule.profileTatarstan,
      );

      final custom = tatarstan.copyWith(
        madhab: Madhab.shafi,
        highLatitudeRule: PrayerHighLatitudeRule.seventhOfTheNight,
      );
      expect(custom.profile, PrayerCalculationProfile.tatarstan);
      expect(custom.madhab, Madhab.shafi);
      expect(custom.highLatitudeRule, PrayerHighLatitudeRule.seventhOfTheNight);
    },
  );

  test(
    'Tatarstan uses its fixed intervals when 18 degree twilight is absent',
    () {
      final schedule = _schedule(
        _place(country: 'RU', region: '73'),
        DateTime.utc(2026, 6, 21, 12),
      );

      expect(schedule, isNotNull);
      expect(schedule!.profile, PrayerCalculationProfile.tatarstan);
      expect(schedule.isApproximate, isTrue);
      expect(schedule.entries, hasLength(7));
      expect(
        schedule.entries[1].time!.difference(schedule.entries[0].time!),
        const Duration(hours: 2),
      );
      expect(
        schedule.entries.last.time!.difference(schedule.entries[5].time!),
        const Duration(minutes: 90),
      );
    },
  );

  test(
    'Russia keeps reachable 15 degree Isha when 18 degrees is unavailable',
    () {
      const kazan = PrayerLocation(
        latitude: 55.78874,
        longitude: 49.12214,
        countryCode: 'RU',
        regionCode: '73',
        timeZoneId: 'Europe/Moscow',
      );
      DateTime? boundaryDate;
      late ({
        DateTime? fajr18,
        DateTime? isha15,
        DateTime? isha18,
        DateTime? sunrise,
        DateTime? sunset,
      })
      boundary;
      for (var day = 1; day <= 365; day++) {
        final date = DateTime.utc(2026, 1, 1).add(Duration(days: day - 1));
        final candidate = _rawTimes(kazan, date.add(const Duration(hours: 12)));
        if (candidate.isha15 != null && candidate.isha18 == null) {
          boundaryDate = date;
          boundary = candidate;
          break;
        }
      }

      expect(boundaryDate, isNotNull);
      final russia = _schedule(
        kazan,
        boundaryDate!,
        configuration: const PrayerCalculationConfiguration(
          mode: PrayerCalculationMode.manual,
          profile: PrayerCalculationProfile.russia,
          madhab: Madhab.shafi,
          highLatitudeRule: PrayerHighLatitudeRule.profileRussia,
        ),
      );
      final tatarstan = _schedule(
        kazan,
        boundaryDate,
        configuration: const PrayerCalculationConfiguration(
          mode: PrayerCalculationMode.manual,
          profile: PrayerCalculationProfile.tatarstan,
          madhab: Madhab.hanafi,
          highLatitudeRule: PrayerHighLatitudeRule.profileTatarstan,
        ),
      );

      expect(
        russia!.entries.last.time!.millisecondsSinceEpoch,
        boundary.isha15!.millisecondsSinceEpoch,
      );
      expect(
        tatarstan!.entries.last.time!.millisecondsSinceEpoch,
        _roundMinute(boundary.sunset!.add(const Duration(minutes: 90)))
            .millisecondsSinceEpoch,
      );
    },
  );

  test(
    'Russia uses independent raw angle fallback and raw solar night length',
    () {
      const petersburg = PrayerLocation(
        latitude: 59.9386,
        longitude: 30.3141,
        countryCode: 'RU',
        regionCode: '78',
        timeZoneId: 'Europe/Moscow',
      );
      final date = DateTime.utc(2026, 6, 21, 12);
      final schedule = _schedule(petersburg, date);
      final today = _rawTimes(petersburg, date);
      final previous = _rawTimes(petersburg, DateTime.utc(2026, 6, 20, 12));
      final next = _rawTimes(petersburg, DateTime.utc(2026, 6, 22, 12));

      expect(schedule, isNotNull);
      expect(schedule!.profile, PrayerCalculationProfile.russia);
      final expectedFajr = _roundMinute(
        today.sunrise!.subtract(
          Duration(
            milliseconds:
                (today.sunrise!.difference(previous.sunset!).inMilliseconds *
                        .3)
                    .round(),
          ),
        ),
      );
      final expectedIsha = _roundMinute(
        today.sunset!.add(
          Duration(
            milliseconds:
                (next.sunrise!.difference(today.sunset!).inMilliseconds * .25)
                    .round(),
          ),
        ),
      );
      expect(
        schedule.entries.first.time!.millisecondsSinceEpoch,
        expectedFajr.millisecondsSinceEpoch,
      );
      expect(
        schedule.entries.last.time!.millisecondsSinceEpoch,
        expectedIsha.millisecondsSinceEpoch,
      );
    },
  );

  test(
    'manual calculation honors selected method, Asr and high-latitude rule',
    () {
      const place = PrayerLocation(
        latitude: 59.9386,
        longitude: 30.3141,
        countryCode: 'RU',
        regionCode: '78',
        timeZoneId: 'Europe/Moscow',
      );
      final date = DateTime.utc(2026, 6, 21, 12);
      final shafi = _schedule(
        place,
        date,
        configuration: const PrayerCalculationConfiguration(
          mode: PrayerCalculationMode.manual,
          profile: PrayerCalculationProfile.muslimWorldLeague,
          madhab: Madhab.shafi,
          highLatitudeRule: PrayerHighLatitudeRule.middleOfTheNight,
        ),
      )!;
      final hanafi = _schedule(
        place,
        date,
        configuration: const PrayerCalculationConfiguration(
          mode: PrayerCalculationMode.manual,
          profile: PrayerCalculationProfile.muslimWorldLeague,
          madhab: Madhab.hanafi,
          highLatitudeRule: PrayerHighLatitudeRule.middleOfTheNight,
        ),
      )!;
      final seventh = _schedule(
        place,
        date,
        configuration: const PrayerCalculationConfiguration(
          mode: PrayerCalculationMode.manual,
          profile: PrayerCalculationProfile.muslimWorldLeague,
          madhab: Madhab.shafi,
          highLatitudeRule: PrayerHighLatitudeRule.seventhOfTheNight,
        ),
      )!;

      expect(shafi.profile, PrayerCalculationProfile.muslimWorldLeague);
      expect(shafi.entries[4].time!.isBefore(hanafi.entries[4].time!), isTrue);
      expect(seventh.entries.first.time, isNot(shafi.entries.first.time));
    },
  );

  test('every manual method produces a schedule from its own parameters', () {
    final place = _place(
      country: 'TR',
      timezone: 'Europe/Istanbul',
      latitude: 39.939382,
      longitude: 32.819713,
    );
    for (final profile in PrayerCalculationProfile.values) {
      if (profile.calculationMethod == null) continue;
      final schedule = _schedule(
        place,
        DateTime.utc(2026, 11, 26, 12),
        configuration: defaultsForProfile(profile)
            .copyWith(mode: PrayerCalculationMode.manual),
      );
      expect(schedule, isNotNull, reason: profile.label);
      expect(schedule!.profile, profile);
      expect(schedule.entries, hasLength(7));
    }
  });

  test(
    'reachable regional angles are not replaced by a high-latitude portion',
    () {
      final kazan = _place(
        country: 'RU',
        region: '73',
        timezone: 'Europe/Moscow',
      );
      final date = DateTime.utc(2026, 11, 26, 12);
      final schedule = _schedule(
        kazan,
        date,
        configuration: const PrayerCalculationConfiguration(
          mode: PrayerCalculationMode.manual,
          profile: PrayerCalculationProfile.russia,
          madhab: Madhab.shafi,
          highLatitudeRule: PrayerHighLatitudeRule.profileRussia,
        ),
      );
      final expected = _rawTimes(kazan, date);

      expect(schedule, isNotNull);
      expect(
        schedule!.entries.first.time!.millisecondsSinceEpoch,
        expected.fajr18!.millisecondsSinceEpoch,
      );
      expect(
        schedule.entries.last.time!.millisecondsSinceEpoch,
        expected.isha15!.millisecondsSinceEpoch,
      );
    },
  );

  test('unknown location can use manual settings and saved settings stay per-place', () async {
    final previous = SharedPreferencesAsyncPlatform.instance;
    final preferences = _MemoryPreferences();
    SharedPreferencesAsyncPlatform.instance = preferences;
    addTearDown(() => SharedPreferencesAsyncPlatform.instance = previous);

    final viewModel = CalculationProfileViewModel(SharedPreferencesAsync());
    await viewModel.initialize();
    final manual = defaultsForProfile(PrayerCalculationProfile.egyptian)
        .copyWith(mode: PrayerCalculationMode.manual);
    expect(await viewModel.updateConfiguration(null, manual), isTrue);

    final starter = viewModel.configurationFor(
      'geoname:551487',
      automaticProfile: PrayerCalculationProfile.tatarstan,
    );
    expect(starter.mode, PrayerCalculationMode.manual);
    expect(starter.profile, PrayerCalculationProfile.egyptian);

    final locationConfig = starter.selectingProfile(
      PrayerCalculationProfile.russia,
    );
    expect(
      await viewModel.updateConfiguration('geoname:551487', locationConfig),
      isTrue,
    );
    expect(
      viewModel
          .configurationFor(
            'geoname:551487',
            automaticProfile: PrayerCalculationProfile.tatarstan,
          )
          .profile,
      PrayerCalculationProfile.russia,
    );
    expect(
      viewModel
          .configurationFor(
            'geoname:524901',
            automaticProfile: PrayerCalculationProfile.russia,
          )
          .profile,
      PrayerCalculationProfile.egyptian,
    );
    viewModel.dispose();

    final restored = CalculationProfileViewModel(SharedPreferencesAsync());
    await restored.initialize();
    expect(
      restored
          .configurationFor(
            'geoname:551487',
            automaticProfile: PrayerCalculationProfile.tatarstan,
          )
          .profile,
      PrayerCalculationProfile.russia,
    );
    restored.dispose();
  });

  test(
    'a place-specific manual profile does not transfer to another place',
    () async {
      final previous = SharedPreferencesAsyncPlatform.instance;
      SharedPreferencesAsyncPlatform.instance = _MemoryPreferences();
      addTearDown(() => SharedPreferencesAsyncPlatform.instance = previous);
      final viewModel = CalculationProfileViewModel(SharedPreferencesAsync());
      await viewModel.initialize();
      await viewModel.updateConfiguration(
        'geoname:551487',
        defaultsForProfile(PrayerCalculationProfile.russia)
            .copyWith(mode: PrayerCalculationMode.manual),
      );

      expect(
        viewModel
            .configurationFor(
              'geoname:551487',
              automaticProfile: PrayerCalculationProfile.tatarstan,
            )
            .profile,
        PrayerCalculationProfile.russia,
      );
      final otherPlace = viewModel.configurationFor(
        'geoname:524901',
        automaticProfile: PrayerCalculationProfile.russia,
      );
      expect(otherPlace.mode, PrayerCalculationMode.automatic);
      expect(otherPlace.profile, PrayerCalculationProfile.russia);
      viewModel.dispose();
    },
  );

  test(
    'legacy regional overrides and global manual settings are migrated',
    () async {
      final previous = SharedPreferencesAsyncPlatform.instance;
      final preferences = _MemoryPreferences()
        ..values['prayer_calculation_profile_overrides_v1'] = jsonEncode({
          'geoname:551487': 'russia',
        })
        ..values['prayer_calculation_profile'] = jsonEncode({
          'method': 'egyptian',
          'madhab': 'hanafi',
          'highLatitudeRule': 'seventh_of_the_night',
        });
      SharedPreferencesAsyncPlatform.instance = preferences;
      addTearDown(() => SharedPreferencesAsyncPlatform.instance = previous);

      final viewModel = CalculationProfileViewModel(SharedPreferencesAsync());
      await viewModel.initialize();
      final location = viewModel.configurationFor(
        'geoname:551487',
        automaticProfile: PrayerCalculationProfile.tatarstan,
      );
      final unplaced = viewModel.configurationFor(
        null,
        automaticProfile: PrayerCalculationProfile.muslimWorldLeague,
      );

      expect(location.mode, PrayerCalculationMode.manual);
      expect(location.profile, PrayerCalculationProfile.russia);
      expect(unplaced.mode, PrayerCalculationMode.automatic);
      expect(unplaced.profile, PrayerCalculationProfile.egyptian);
      expect(unplaced.madhab, Madhab.hanafi);
      expect(
        unplaced.highLatitudeRule,
        PrayerHighLatitudeRule.seventhOfTheNight,
      );
      viewModel.dispose();
    },
  );

  testWidgets(
    'automatic hides fields and manual settings work without a place',
    (tester) async {
      final previous = SharedPreferencesAsyncPlatform.instance;
      SharedPreferencesAsyncPlatform.instance = _MemoryPreferences();
      addTearDown(() => SharedPreferencesAsyncPlatform.instance = previous);
      final viewModel = CalculationProfileViewModel(SharedPreferencesAsync());
      await viewModel.initialize();

      await tester.pumpWidget(
        AppRoot(
          title: 'Vaqtpro',
          home: SettingsScreen(
            viewModel: viewModel,
            locationKey: null,
            countryCode: null,
            regionCode: null,
          ),
        ),
      );

      expect(find.text('Параметры расчета времени намаза'), findsOneWidget);
      expect(find.text('Автоматически'), findsOneWidget);
      expect(
        find.textContaining('Всемирная мусульманская лига'),
        findsOneWidget,
      );
      expect(
        find.text(
          'Всемирная мусульманская лига · Аср: '
          'Шафиитский (одинарная тень) · Высокие широты: По профилю',
        ),
        findsOneWidget,
      );
      expect(find.text('Профиль расчёта'), findsNothing);

      await tester.tap(find.byType(m.SwitchListTile));
      await tester.pumpAndSettle();
      expect(find.text('Вручную'), findsOneWidget);
      expect(find.text('Профиль расчёта'), findsOneWidget);
      expect(find.text('Правило расчёта Асра'), findsOneWidget);
      expect(find.text('Правило для высоких широт'), findsOneWidget);
      expect(find.text('Сначала выберите место'), findsNothing);
      expect(find.text('Сохранить'), findsNothing);
      await tester.tap(find.text('Всемирная мусульманская лига').last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Татарстан').last);
      await tester.pumpAndSettle();
      var configuration = viewModel.configurationFor(
        null,
        automaticProfile: PrayerCalculationProfile.muslimWorldLeague,
      );
      expect(configuration.profile, PrayerCalculationProfile.tatarstan);
      expect(configuration.madhab, Madhab.hanafi);
      expect(find.text('Ханафитский (двойная тень)'), findsOneWidget);
      expect(
        configuration.highLatitudeRule,
        PrayerHighLatitudeRule.profileTatarstan,
      );
      expect(find.text('По правилам профиля Татарстан'), findsOneWidget);
      await tester.tap(find.text('Ханафитский (двойная тень)'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Шафиитский (одинарная тень)').last);
      await tester.pumpAndSettle();
      configuration = viewModel.configurationFor(
        null,
        automaticProfile: PrayerCalculationProfile.muslimWorldLeague,
      );
      expect(configuration.profile, PrayerCalculationProfile.tatarstan);
      expect(configuration.madhab, Madhab.shafi);
      expect(
        configuration.highLatitudeRule,
        PrayerHighLatitudeRule.profileTatarstan,
      );
      await tester.tap(find.byType(m.SwitchListTile));
      await tester.pumpAndSettle();
      expect(find.text('Профиль расчёта'), findsNothing);
      await tester.tap(find.byType(m.SwitchListTile));
      await tester.pumpAndSettle();
      configuration = viewModel.configurationFor(
        null,
        automaticProfile: PrayerCalculationProfile.muslimWorldLeague,
      );
      expect(configuration.profile, PrayerCalculationProfile.tatarstan);
      expect(configuration.madhab, Madhab.shafi);
      expect(tester.takeException(), isNull);
      viewModel.dispose();
    },
  );

  test('missing place timezone uses and labels the device offset', () {
    final schedule = _schedule(
      _place(country: 'RU', region: '77', timezone: null),
      DateTime.utc(2026, 11, 26, 12),
    );

    expect(schedule, isNotNull);
    expect(schedule!.isApproximate, isTrue);
    expect(schedule.notice, contains('Часовой пояс места неизвестен'));
  });

  test('ordinary place keeps its timezone and all seven prayer times', () {
    final schedule = _schedule(
      _place(country: 'RU', region: '77', timezone: 'Europe/Moscow'),
      DateTime.utc(2026, 11, 26, 12),
    );

    expect(schedule, isNotNull);
    expect(schedule!.entries, hasLength(7));
    expect(schedule.entries.every((entry) => entry.time != null), isTrue);
    expect(
      schedule.entries.first.time!.timeZoneOffset,
      const Duration(hours: 3),
    );
  });
}

PrayerLocation _place({
  String? country,
  String? region,
  String? timezone = 'Europe/Moscow',
  double latitude = 55.78874,
  double longitude = 49.12214,
}) => PrayerLocation(
  latitude: latitude,
  longitude: longitude,
  countryCode: country,
  regionCode: region,
  timeZoneId: timezone,
);

PrayerTimesSchedule? _schedule(
  PrayerLocation place,
  DateTime now, {
  PrayerCalculationConfiguration? configuration,
}) => PrayerTimesCalculator().calculate(
  latitude: place.latitude,
  longitude: place.longitude,
  countryCode: place.countryCode,
  regionCode: place.regionCode,
  timeZoneId: place.timeZoneId,
  configuration: configuration,
  now: now,
);

({
  DateTime? fajr18,
  DateTime? isha15,
  DateTime? isha18,
  DateTime? sunrise,
  DateTime? sunset,
})
_rawTimes(PrayerLocation place, DateTime instant) {
  final zone = timezone.getLocation(place.timeZoneId!);
  final local = timezone.TZDateTime.from(instant, zone);
  final coordinates = Coordinates(place.latitude, place.longitude);
  final components = DateComponents.fromLocalNoon(
    timezone.TZDateTime(zone, local.year, local.month, local.day, 12),
    coordinates,
  );
  final solar = SolarTime(components.toUtcMidnight(), coordinates);
  DateTime? event(double hour) {
    if (!hour.isFinite) return null;
    final millis = (hour * Duration.millisecondsPerHour).round();
    final raw = DateTime.utc(
      components.year,
      components.month,
      components.day,
    ).add(Duration(milliseconds: millis));
    return _roundMinute(raw);
  }

  return (
    fajr18: event(solar.hourAngle(-18, false)),
    isha15: event(solar.hourAngle(-15, true)),
    isha18: event(solar.hourAngle(-18, true)),
    sunrise: event(solar.sunrise),
    sunset: event(solar.sunset),
  );
}

DateTime _roundMinute(DateTime value) {
  final seconds = (value.millisecondsSinceEpoch / 1000).floor();
  final minutes = ((seconds / 60) + 0.5).floor();
  return DateTime.fromMillisecondsSinceEpoch(minutes * 60000, isUtc: true);
}

final class _MemoryPreferences extends SharedPreferencesAsyncPlatform {
  final Map<String, String> values = {};

  @override
  Future<String?> getString(
    String key,
    SharedPreferencesOptions options,
  ) async => values[key];

  @override
  Future<void> setString(
    String key,
    String value,
    SharedPreferencesOptions options,
  ) async {
    values[key] = value;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
