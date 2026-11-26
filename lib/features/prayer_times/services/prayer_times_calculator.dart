import 'package:adhan/adhan.dart';
// Adhan does not expose raw angle events through its public API.
// ignore: implementation_imports
import 'package:adhan/src/internal/solar_time.dart';
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
    CalculationProfileSelection selection =
        CalculationProfileSelection.byLocation,
    DateTime? now,
  }) {
    try {
      final coordinates = Coordinates(latitude, longitude);
      final profile = profileForSelection(countryCode, regionCode, selection);
      final zoneResult = _timeZone(timeZoneId, now: now);
      final zone = zoneResult.location;
      final localNow = now == null
          ? timezone.TZDateTime.now(zone)
          : timezone.TZDateTime.from(now, zone);
      final date = DateTime.utc(localNow.year, localNow.month, localNow.day);

      final parameters = _parameters(profile);
      final dateComponents = _dateComponents(coordinates, date, zone);
      final solar = SolarTime(dateComponents.toUtcMidnight(), coordinates);
      final times = _times(coordinates, dateComponents, parameters);
      final rawTransit = _solarEvent(dateComponents, solar.transit)!;
      final transit = _roundMinute(rawTransit);
      final previousDate = date.subtract(const Duration(days: 1));
      final nextDate = date.add(const Duration(days: 1));
      final previousComponents = _dateComponents(
        coordinates,
        previousDate,
        zone,
      );
      final nextComponents = _dateComponents(coordinates, nextDate, zone);
      final previousSolar = SolarTime(
        previousComponents.toUtcMidnight(),
        coordinates,
      );
      final nextSolar = SolarTime(nextComponents.toUtcMidnight(), coordinates);
      final rawSunrise = _solarEvent(dateComponents, solar.sunrise);
      final rawSunset = _solarEvent(dateComponents, solar.sunset);
      final previousSunset = _solarEvent(
        previousComponents,
        previousSolar.sunset,
      );
      final nextSunrise = _solarEvent(nextComponents, nextSolar.sunrise);
      final rawFajr = _solarAngle(
        dateComponents,
        solar,
        18,
        afterTransit: false,
      );
      final rawIsha15 = _solarAngle(
        dateComponents,
        solar,
        15,
        afterTransit: true,
      );
      final rawIsha18 = _solarAngle(
        dateComponents,
        solar,
        18,
        afterTransit: true,
      );
      final previousIsha18 = _solarAngle(
        previousComponents,
        previousSolar,
        18,
        afterTransit: true,
      );
      final nextFajr18 = _solarAngle(
        nextComponents,
        nextSolar,
        18,
        afterTransit: false,
      );
      final tatarstan = profile == RegionalPrayerProfile.tatarstan;
      final hasPolarGap =
          times.usedPolarResolution ||
          rawSunrise == null ||
          rawSunset == null ||
          previousSunset == null ||
          nextSunrise == null;

      var fajr = times.fajr;
      var isha = times.isha;
      var usedRegionalFallback = false;
      if (profile != RegionalPrayerProfile.muslimWorldLeague && !hasPolarGap) {
        final sunrise = rawSunrise;
        final sunset = rawSunset;
        if (tatarstan) {
          // DUM RT switches both prayers for the night when the 18° twilight
          // angle is not reached, even though the 15° Isha angle may be reached.
          final no18DegreeFajr = rawFajr == null || previousIsha18 == null;
          final no18DegreeIsha = rawIsha18 == null || nextFajr18 == null;
          fajr = no18DegreeFajr
              ? _roundMinute(sunrise.subtract(const Duration(minutes: 120)))
              : rawFajr;
          isha = no18DegreeIsha
              ? _roundMinute(sunset.add(const Duration(minutes: 90)))
              : rawIsha15 ?? times.isha;
          usedRegionalFallback = no18DegreeFajr || no18DegreeIsha;
        } else {
          fajr =
              rawFajr ?? _fractionBeforeSunrise(previousSunset, sunrise, 0.3);
          isha = rawIsha15 ?? _fractionAfterSunset(sunset, nextSunrise, 0.25);
          usedRegionalFallback = rawFajr == null || rawIsha15 == null;
        }
      }

      final rows = <PrayerTimeEntry>[
        (name: 'Фаджр', time: fajr),
        (name: 'Шурук', time: times.sunrise),
        (name: 'Истива', time: transit),
        (
          name: 'Зухр',
          time: _dhuhr(profile, times.dhuhr, rawTransit, date, zone),
        ),
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
        isApproximate:
            zoneResult.isApproximate ||
            (profile == RegionalPrayerProfile.muslimWorldLeague &&
                times.isApproximate) ||
            times.usedPolarResolution ||
            hasPolarGap ||
            usedRegionalFallback,
        notice: zoneResult.notice,
      );
    } on Object {
      return null;
    }
  }

  CalculationParameters _parameters(RegionalPrayerProfile profile) {
    if (profile == RegionalPrayerProfile.muslimWorldLeague) {
      final mwl = CalculationMethod.muslim_world_league.getParameters();
      return mwl.copyWith(
        madhab: Madhab.shafi,
        highLatitudeRule: HighLatitudeRule.middle_of_the_night,
        methodAdjustments: mwl.methodAdjustments,
      );
    }
    return CalculationParameters(
      method: CalculationMethod.other,
      fajrAngle: 18,
      ishaAngle: 15,
      madhab: profile == RegionalPrayerProfile.tatarstan
          ? Madhab.hanafi
          : Madhab.shafi,
      // Regional prayer angles are resolved against raw solar events below.
      // Do not let Adhan clamp a reachable angle to its high-latitude portion.
      highLatitudeRule: HighLatitudeRule.middle_of_the_night,
      adjustments: profile == RegionalPrayerProfile.russia
          ? const PrayerAdjustments(sunrise: -5, dhuhr: 5, maghrib: 5)
          : const PrayerAdjustments(),
    );
  }

  PrayerTimes _times(
    Coordinates coordinates,
    DateComponents date,
    CalculationParameters parameters,
  ) {
    return PrayerTimes(coordinates, date, parameters);
  }

  DateTime _dhuhr(
    RegionalPrayerProfile profile,
    DateTime calculatedDhuhr,
    DateTime rawTransit,
    DateTime localDate,
    timezone.Location zone,
  ) {
    if (profile != RegionalPrayerProfile.tatarstan) return calculatedDhuhr;
    final localThreshold = timezone.TZDateTime(
      zone,
      localDate.year,
      localDate.month,
      localDate.day,
      12,
    );
    final afterTransit = rawTransit.add(const Duration(minutes: 1));
    final roundedUp = DateTime.fromMillisecondsSinceEpoch(
      ((afterTransit.millisecondsSinceEpoch + 59999) ~/ 60000) * 60000,
      isUtc: true,
    );
    return roundedUp.isAfter(localThreshold) ? roundedUp : localThreshold;
  }

  DateComponents _dateComponents(
    Coordinates coordinates,
    DateTime localDate,
    timezone.Location zone,
  ) {
    final localNoon = timezone.TZDateTime(
      zone,
      localDate.year,
      localDate.month,
      localDate.day,
      12,
    );
    return DateComponents.fromLocalNoon(localNoon, coordinates);
  }

  _TimeZoneResolution _timeZone(String? id, {DateTime? now}) {
    if (id != null && id.isNotEmpty) {
      try {
        return _TimeZoneResolution(timezone.getLocation(id));
      } on Object {
        // Unknown stored zones use the device offset and are visibly marked.
      }
    }
    final deviceNow = now?.toLocal() ?? DateTime.now();
    final offset = DateTime(
      deviceNow.year,
      deviceNow.month,
      deviceNow.day,
      12,
    ).timeZoneOffset;
    final deviceZone = timezone.Location('Device', [-8640000000000000], [0], [
      timezone.TimeZone(offset, isDst: false, abbreviation: 'LOCAL'),
    ]);
    return _TimeZoneResolution(
      deviceZone,
      isApproximate: true,
      notice: 'Часовой пояс места неизвестен; использовано время устройства',
    );
  }

  DateTime? _solarAngle(
    DateComponents date,
    SolarTime solar,
    double angle, {
    required bool afterTransit,
  }) {
    final hours = solar.hourAngle(-angle, afterTransit);
    if (!hours.isFinite) return null;
    return _roundMinute(_solarEvent(date, hours)!);
  }

  DateTime? _solarEvent(DateComponents date, double hours) {
    if (!hours.isFinite) return null;
    final milliseconds = (hours * Duration.millisecondsPerHour).round();
    return DateTime.utc(
      date.year,
      date.month,
      date.day,
    ).add(Duration(milliseconds: milliseconds));
  }

  DateTime _roundMinute(DateTime value) {
    final seconds = (value.millisecondsSinceEpoch / 1000).floor();
    final minutes = ((seconds / 60) + 0.5).floor();
    return DateTime.fromMillisecondsSinceEpoch(minutes * 60000, isUtc: true);
  }

  DateTime _fractionBeforeSunrise(
    DateTime sunset,
    DateTime sunrise,
    double fraction,
  ) {
    final night = sunrise.difference(sunset);
    return _roundMinute(
      sunrise.subtract(
        Duration(milliseconds: (night.inMilliseconds * fraction).round()),
      ),
    );
  }

  DateTime _fractionAfterSunset(
    DateTime sunset,
    DateTime sunrise,
    double fraction,
  ) {
    final night = sunrise.difference(sunset);
    return _roundMinute(
      sunset.add(
        Duration(milliseconds: (night.inMilliseconds * fraction).round()),
      ),
    );
  }
}

class PrayerTimesSchedule {
  const PrayerTimesSchedule({
    required this.profile,
    required this.entries,
    required this.isApproximate,
    this.notice,
  });

  final RegionalPrayerProfile profile;
  final List<PrayerTimeEntry> entries;
  final bool isApproximate;
  final String? notice;
}

class _TimeZoneResolution {
  const _TimeZoneResolution(
    this.location, {
    this.isApproximate = false,
    this.notice,
  });

  final timezone.Location location;
  final bool isApproximate;
  final String? notice;
}
