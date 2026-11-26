import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:shared_preferences_platform_interface/shared_preferences_async_platform_interface.dart';
import 'package:vaqtpro/design_system/design_system.dart';
import 'package:vaqtpro/features/location/models/prayer_location.dart';
import 'package:vaqtpro/features/prayer_times/models/calculation_profile.dart';
import 'package:vaqtpro/features/prayer_times/screens/settings_screen.dart';
import 'package:vaqtpro/features/prayer_times/services/prayer_times_calculator.dart';
import 'package:vaqtpro/features/prayer_times/view_models/calculation_profile_view_model.dart';
// ignore: implementation_imports
import 'package:adhan/src/internal/solar_time.dart';
import 'package:adhan/adhan.dart';
import 'package:timezone/timezone.dart' as timezone;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('GeoNames codes select Tatarstan, Russia, or MWL', () {
    expect(
      _profile(_place(country: 'RU', region: '73')),
      RegionalPrayerProfile.tatarstan,
    );
    expect(
      _profile(_place(country: 'RU', region: '77')),
      RegionalPrayerProfile.russia,
    );
    expect(_profile(_place(country: 'RU')), RegionalPrayerProfile.russia);
    expect(
      _profile(_place(country: 'US', region: 'CA')),
      RegionalPrayerProfile.muslimWorldLeague,
    );
    expect(_profile(_place()), RegionalPrayerProfile.muslimWorldLeague);
  });

  test('Tatarstan calculation applies its seasonal fixed intervals', () {
    final schedule = _schedule(
      _place(country: 'RU', region: '73'),
      DateTime.utc(2026, 6, 21, 12),
    );

    expect(schedule, isNotNull);
    expect(schedule!.profile, RegionalPrayerProfile.tatarstan);
    expect(schedule.isApproximate, isTrue);
    expect(schedule.entries, hasLength(7));
    final fajr = schedule.entries[0].time!;
    final sunrise = schedule.entries[1].time!;
    final solarNoon = schedule.entries[2].time!;
    final dhuhr = schedule.entries[3].time!;
    final isha = schedule.entries.last.time!;
    final maghrib = schedule.entries[5].time!;
    expect(sunrise.difference(fajr), const Duration(hours: 2));
    expect(dhuhr.hour, greaterThanOrEqualTo(12));
    expect(
      dhuhr.difference(solarNoon),
      greaterThanOrEqualTo(const Duration(minutes: 1)),
    );
    expect(isha.difference(maghrib), const Duration(minutes: 90));
  });

  test('Russia uses the Moscow profile and per-prayer high-latitude rules', () {
    final schedule = _schedule(
      _place(
        country: 'RU',
        region: '78',
        latitude: 59.9386,
        longitude: 30.3141,
      ),
      DateTime.utc(2026, 6, 21, 12),
    );

    expect(schedule, isNotNull);
    expect(schedule!.profile, RegionalPrayerProfile.russia);
    expect(schedule.isApproximate, isTrue);
    final fajr = schedule.entries[0].time!;
    final isha = schedule.entries.last.time!;
    const petersburg = PrayerLocation(
      latitude: 59.9386,
      longitude: 30.3141,
      countryCode: 'RU',
      regionCode: '78',
      timeZoneId: 'Europe/Moscow',
    );
    final today = _rawTimes(petersburg, DateTime.utc(2026, 6, 21, 12));
    final previous = _rawTimes(petersburg, DateTime.utc(2026, 6, 20, 12));
    final next = _rawTimes(petersburg, DateTime.utc(2026, 6, 22, 12));
    final expectedFajr = _roundMinute(
      today.sunrise!.subtract(
        Duration(
          milliseconds:
              (today.sunrise!.difference(previous.sunset!).inMilliseconds * .3)
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
    expect(fajr.millisecondsSinceEpoch, expectedFajr.millisecondsSinceEpoch);
    expect(isha.millisecondsSinceEpoch, expectedIsha.millisecondsSinceEpoch);
  });

  test('ordinary dates retain the selected place timezone and seven times', () {
    final schedule = _schedule(
      _place(country: 'RU', region: '77', timezone: 'Europe/Moscow'),
      DateTime.utc(2026, 11, 26, 12),
    );

    expect(schedule, isNotNull);
    expect(schedule!.isApproximate, isFalse);
    expect(schedule.entries, hasLength(7));
    expect(schedule.entries.every((entry) => entry.time != null), isTrue);
    expect(schedule.entries[0].time!.timeZoneOffset, const Duration(hours: 3));
  });

  test('missing place timezone uses and labels the device offset', () {
    final schedule = _schedule(
      _place(country: 'RU', region: '77', timezone: null),
      DateTime.utc(2026, 11, 26, 12),
    );

    expect(schedule, isNotNull);
    expect(schedule!.isApproximate, isTrue);
    expect(schedule.notice, contains('Часовой пояс места неизвестен'));
  });

  test('Russia keeps reachable 18 and 15 degree astronomical times', () {
    final kazan = _place(
      country: 'RU',
      region: '73',
      timezone: 'Europe/Moscow',
    );
    final date = DateTime.utc(2026, 11, 26, 12);
    final schedule = _schedule(
      kazan,
      date,
      selection: CalculationProfileSelection.russia,
    );
    final expected = _rawTimes(kazan, date);

    expect(schedule, isNotNull);
    expect(schedule!.profile, RegionalPrayerProfile.russia);
    expect(
      schedule.entries[0].time!.millisecondsSinceEpoch,
      expected.fajr18!.millisecondsSinceEpoch,
    );
    expect(
      schedule.entries[6].time!.millisecondsSinceEpoch,
      expected.isha15!.millisecondsSinceEpoch,
    );
    expect(schedule.isApproximate, isFalse);
  });

  test(
    'Tatarstan checks 18 degrees while Russia checks Isha at 15 degrees',
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
      final tatarstan = _schedule(kazan, boundaryDate!);
      final russia = _schedule(
        const PrayerLocation(
          latitude: 55.78874,
          longitude: 49.12214,
          countryCode: 'RU',
          regionCode: '77',
          timeZoneId: 'Europe/Moscow',
        ),
        boundaryDate,
      );
      final nextTatarstan = _schedule(
        kazan,
        boundaryDate.add(const Duration(days: 1)),
      );
      final followingSunrise = _rawTimes(
        kazan,
        boundaryDate.add(const Duration(days: 1)),
      ).sunrise!;
      final expectedTatarstanIsha = _roundMinute(
        boundary.sunset!.add(const Duration(minutes: 90)),
      );
      final expectedFollowingFajr = _roundMinute(
        followingSunrise.subtract(const Duration(minutes: 120)),
      );

      expect(
        tatarstan!.entries.last.time!.millisecondsSinceEpoch,
        expectedTatarstanIsha.millisecondsSinceEpoch,
      );
      expect(
        russia!.entries.last.time!.millisecondsSinceEpoch,
        boundary.isha15!.millisecondsSinceEpoch,
      );
      expect(
        nextTatarstan!.entries.first.time!.millisecondsSinceEpoch,
        expectedFollowingFajr.millisecondsSinceEpoch,
      );
    },
  );

  test(
    'profile overrides are stored per location and reset to automatic',
    () async {
      final previous = SharedPreferencesAsyncPlatform.instance;
      final preferences = _MemoryPreferences();
      SharedPreferencesAsyncPlatform.instance = preferences;
      addTearDown(() => SharedPreferencesAsyncPlatform.instance = previous);

      final first = CalculationProfileViewModel(SharedPreferencesAsync());
      await first.initialize();
      expect(
        await first.saveForLocation(
          'geoname:551487',
          CalculationProfileSelection.russia,
        ),
        isTrue,
      );
      first.dispose();

      final restored = CalculationProfileViewModel(SharedPreferencesAsync());
      await restored.initialize();
      expect(
        restored.selectionFor('geoname:551487'),
        CalculationProfileSelection.russia,
      );
      expect(
        restored.selectionFor('geoname:524901'),
        CalculationProfileSelection.byLocation,
      );
      expect(
        await restored.saveForLocation(
          'geoname:551487',
          CalculationProfileSelection.byLocation,
        ),
        isTrue,
      );
      expect(
        restored.selectionFor('geoname:551487'),
        CalculationProfileSelection.byLocation,
      );
      restored.dispose();
    },
  );

  testWidgets('settings profile choice saves and updates immediately', (
    tester,
  ) async {
    final profiles = CalculationProfileViewModel();
    await profiles.initialize();
    await tester.pumpWidget(
      AppRoot(
        title: 'Vaqtpro',
        home: SettingsScreen(
          viewModel: profiles,
          locationKey: 'geoname:551487',
          countryCode: 'RU',
          regionCode: '73',
        ),
      ),
    );

    expect(find.text('По месту · Татарстан'), findsOneWidget);
    await tester.tap(find.text('Профиль расчёта'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Россия'));
    await tester.pumpAndSettle();
    expect(
      profiles.selectionFor('geoname:551487'),
      CalculationProfileSelection.russia,
    );
    expect(find.text('Россия'), findsOneWidget);

    await tester.tap(find.text('Профиль расчёта'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('По месту · Татарстан'));
    await tester.pumpAndSettle();
    expect(
      profiles.selectionFor('geoname:551487'),
      CalculationProfileSelection.byLocation,
    );
    expect(tester.takeException(), isNull);
    profiles.dispose();
  });

  test('polar-day calculations are returned and marked approximate', () {
    final schedule = _schedule(
      _place(
        country: 'RU',
        region: '77',
        timezone: 'Europe/London',
        latitude: 80,
        longitude: 0,
      ),
      DateTime.utc(2026, 6, 21, 12),
    );

    expect(schedule, isNotNull);
    expect(schedule!.isApproximate, isTrue);
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

RegionalPrayerProfile _profile(PrayerLocation location) =>
    profileForRegion(location.countryCode, location.regionCode);

PrayerTimesSchedule? _schedule(
  PrayerLocation location,
  DateTime now, {
  CalculationProfileSelection selection =
      CalculationProfileSelection.byLocation,
}) => PrayerTimesCalculator().calculate(
  latitude: location.latitude,
  longitude: location.longitude,
  countryCode: location.countryCode,
  regionCode: location.regionCode,
  timeZoneId: location.timeZoneId,
  selection: selection,
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
    return DateTime.fromMillisecondsSinceEpoch(
      ((((raw.millisecondsSinceEpoch / 1000).floor() / 60) + 0.5).floor()) *
          60000,
      isUtc: true,
    );
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
