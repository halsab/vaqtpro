import 'package:adhan/adhan.dart';
import 'package:timezone/data/latest_all.dart' as timezone_data;
import 'package:timezone/timezone.dart' as timezone;

import '../models/calculation_profile.dart';

typedef PrayerTimeEntry = ({String name, DateTime? time});

class PrayerTimesCalculator {
  PrayerTimesCalculator() {
    if (!_timeZonesInitialized) {
      timezone_data.initializeTimeZones();
      _timeZonesInitialized = true;
    }
  }

  static bool _timeZonesInitialized = false;

  PrayerTimesSchedule? calculate({
    required double latitude,
    required double longitude,
    required String? countryCode,
    required String? regionCode,
    required String? timeZoneId,
    DateTime? now,
  }) {
    final coordinates = Coordinates(latitude, longitude);
    final profile = profileForRegion(countryCode, regionCode);
    final zone = _timeZone(timeZoneId);
    final localNow = now == null
        ? timezone.TZDateTime.now(zone)
        : timezone.TZDateTime.from(now, zone);
    final date = DateTime(localNow.year, localNow.month, localNow.day);

    try {
      final parameters = _parameters(profile);
      final times = _times(coordinates, date, zone, parameters);
      final transit = _times(
        coordinates,
        date,
        zone,
        _parameters(profile, includeRegionalOffsets: false),
      ).dhuhr;
      final previousDate = date.subtract(const Duration(days: 1));
      final nextDate = date.add(const Duration(days: 1));
      final previous = _times(
        coordinates,
        previousDate,
        zone,
        _probeParameters(),
      );
      final probe = _times(coordinates, date, zone, _probeParameters());
      final next = _times(coordinates, nextDate, zone, _probeParameters());
      final tatarstan = profile == RegionalPrayerProfile.tatarstan;
      final approximate =
          times.usedPolarResolution ||
          previous.usedPolarResolution ||
          probe.usedPolarResolution ||
          next.usedPolarResolution;

      var fajr = times.fajr;
      var isha = times.isha;
      if (tatarstan) {
        // DUM RT switches both prayers for the night when the 18° twilight
        // angle is not reached, even though the 15° Isha angle may be reached.
        final previousNightUnavailable =
            times.fajrSource != PrayerTimeSource.astronomical;
        final currentNightUnavailable =
            probe.ishaSource != PrayerTimeSource.astronomical;
        if (previousNightUnavailable) {
          fajr = times.sunrise.subtract(const Duration(minutes: 120));
        }
        if (currentNightUnavailable) {
          isha = probe.sunset.add(const Duration(minutes: 90));
        }
      } else if (profile == RegionalPrayerProfile.russia) {
        // Test each angle against its own night. This avoids applying a
        // high-latitude adjustment merely because the location is far north.
        if (times.fajrSource != PrayerTimeSource.astronomical) {
          fajr = _fractionBeforeSunrise(previous.sunset, probe.sunrise, 0.3);
        }
        if (times.ishaSource != PrayerTimeSource.astronomical) {
          isha = _fractionAfterSunset(probe.sunset, next.sunrise, 0.25);
        }
      }

      final rows = <PrayerTimeEntry>[
        (name: 'Фаджр', time: fajr),
        (name: 'Шурук', time: times.sunrise),
        (name: 'Истива', time: transit),
        (name: 'Зухр', time: _dhuhr(profile, times, zone)),
        (name: 'Аср', time: times.asr),
        (name: 'Магриб', time: times.maghrib),
        (name: 'Иша', time: isha),
      ];
      return PrayerTimesSchedule(
        profile: profile,
        entries: rows
            .map(
              (row) => (
                name: row.name,
                time: row.time == null
                    ? null
                    : timezone.TZDateTime.from(row.time!, zone),
              ),
            )
            .toList(growable: false),
        isApproximate: approximate,
      );
    } on Object {
      return null;
    }
  }

  CalculationParameters _parameters(
    RegionalPrayerProfile profile, {
    bool includeRegionalOffsets = true,
  }) {
    if (profile == RegionalPrayerProfile.muslimWorldLeague) {
      final mwl = CalculationMethod.muslim_world_league.getParameters();
      return mwl.copyWith(
        madhab: Madhab.shafi,
        highLatitudeRule: HighLatitudeRule.middle_of_the_night,
        methodAdjustments: includeRegionalOffsets
            ? mwl.methodAdjustments
            : const PrayerAdjustments(),
      );
    }
    return CalculationParameters(
      method: CalculationMethod.other,
      fajrAngle: 18,
      ishaAngle: 15,
      madhab: profile == RegionalPrayerProfile.tatarstan
          ? Madhab.hanafi
          : Madhab.shafi,
      highLatitudeRule: HighLatitudeRule.twilight_angle,
      adjustments:
          profile == RegionalPrayerProfile.russia && includeRegionalOffsets
          ? const PrayerAdjustments(sunrise: -5, dhuhr: 5, maghrib: 5)
          : const PrayerAdjustments(),
    );
  }

  CalculationParameters _probeParameters() => CalculationParameters(
    method: CalculationMethod.other,
    fajrAngle: 18,
    ishaAngle: 18,
    highLatitudeRule: HighLatitudeRule.middle_of_the_night,
    polarCircleResolution: PolarCircleResolution.aqrabBalad,
  );

  PrayerTimes _times(
    Coordinates coordinates,
    DateTime localDate,
    timezone.Location zone,
    CalculationParameters parameters,
  ) {
    final localNoon = timezone.TZDateTime(
      zone,
      localDate.year,
      localDate.month,
      localDate.day,
      12,
    );
    return PrayerTimes(
      coordinates,
      DateComponents.fromLocalNoon(localNoon, coordinates),
      parameters,
    );
  }

  DateTime _dhuhr(
    RegionalPrayerProfile profile,
    PrayerTimes times,
    timezone.Location zone,
  ) {
    if (profile != RegionalPrayerProfile.tatarstan) return times.dhuhr;
    final localThreshold = timezone.TZDateTime(
      zone,
      times.dhuhr.year,
      times.dhuhr.month,
      times.dhuhr.day,
      12,
    );
    final afterTransit = times.dhuhr.add(const Duration(minutes: 1));
    final roundedUp = DateTime.fromMillisecondsSinceEpoch(
      ((afterTransit.millisecondsSinceEpoch + 59999) ~/ 60000) * 60000,
      isUtc: true,
    );
    return roundedUp.isAfter(localThreshold) ? roundedUp : localThreshold;
  }

  timezone.Location _timeZone(String? id) {
    if (id != null && id.isNotEmpty) {
      try {
        return timezone.getLocation(id);
      } on Object {
        // Fall back to the device zone if a stored IANA ID is no longer known.
      }
    }
    return timezone.local;
  }

  DateTime _fractionBeforeSunrise(
    DateTime sunset,
    DateTime sunrise,
    double fraction,
  ) {
    final night = sunrise.difference(sunset);
    return sunrise.subtract(
      Duration(milliseconds: (night.inMilliseconds * fraction).round()),
    );
  }

  DateTime _fractionAfterSunset(
    DateTime sunset,
    DateTime sunrise,
    double fraction,
  ) {
    final night = sunrise.difference(sunset);
    return sunset.add(
      Duration(milliseconds: (night.inMilliseconds * fraction).round()),
    );
  }
}

class PrayerTimesSchedule {
  const PrayerTimesSchedule({
    required this.profile,
    required this.entries,
    required this.isApproximate,
  });

  final RegionalPrayerProfile profile;
  final List<PrayerTimeEntry> entries;
  final bool isApproximate;
}
