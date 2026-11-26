import 'package:flutter_test/flutter_test.dart';
import 'package:vaqtpro/features/location/models/prayer_location.dart';
import 'package:vaqtpro/features/prayer_times/models/calculation_profile.dart';
import 'package:vaqtpro/features/prayer_times/services/prayer_times_calculator.dart';

void main() {
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
    expect(schedule.isApproximate, isFalse);
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
    expect(schedule.isApproximate, isFalse);
    final fajr = schedule.entries[0].time!;
    final sunrise = schedule.entries[1].time!;
    final isha = schedule.entries.last.time!;
    final maghrib = schedule.entries[5].time!;
    final previousSunset = _schedule(
      _place(
        country: 'RU',
        region: '78',
        latitude: 59.9386,
        longitude: 30.3141,
      ),
      DateTime.utc(2026, 6, 20, 12),
    )!.entries[5].time!.subtract(const Duration(minutes: 5));
    final nextSunrise = _schedule(
      _place(
        country: 'RU',
        region: '78',
        latitude: 59.9386,
        longitude: 30.3141,
      ),
      DateTime.utc(2026, 6, 22, 12),
    )!.entries[1].time!.add(const Duration(minutes: 5));
    final fajrNight = sunrise.difference(previousSunset);
    final ishaNight = nextSunrise.difference(
      maghrib.subtract(const Duration(minutes: 5)),
    );
    expect(
      sunrise.add(const Duration(minutes: 5)).difference(fajr).inMinutes,
      closeTo(fajrNight.inMinutes * .3, 1),
    );
    expect(
      isha.difference(maghrib).inMinutes + 5,
      closeTo(ishaNight.inMinutes * .25, 1),
    );
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

PrayerTimesSchedule? _schedule(PrayerLocation location, DateTime now) =>
    PrayerTimesCalculator().calculate(
      latitude: location.latitude,
      longitude: location.longitude,
      countryCode: location.countryCode,
      regionCode: location.regionCode,
      timeZoneId: location.timeZoneId,
      now: now,
    );
