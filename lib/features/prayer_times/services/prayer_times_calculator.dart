import 'package:adhan/adhan.dart';
// Adhan does not expose raw angle events through its public API.
// ignore: implementation_imports
import 'package:adhan/src/internal/solar_time.dart';
import 'package:timezone/data/latest_all.dart' as timezone_data;
import 'package:timezone/timezone.dart' as timezone;

import '../models/calculation_profile.dart';

typedef PrayerTimeEntry = ({String name, DateTime? time});

enum RegionalPrayerProfile { tatarstan, russia, muslimWorldLeague }

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
    PrayerCalculationConfiguration? configuration,
    DateTime? now,
  }) {
    try {
      final coordinates = Coordinates(latitude, longitude);
      final automaticProfile = prayerCalculationProfileForRegion(
        countryCode,
        regionCode,
      );
      final settings =
          configuration ??
          defaultsForProfile(automaticProfile)
              .copyWith(mode: PrayerCalculationMode.automatic);
      final profile = settings.mode == PrayerCalculationMode.automatic
          ? automaticProfile
          : settings.profile;
      final defaults = defaultsForProfile(profile);
      final madhab = settings.mode == PrayerCalculationMode.automatic
          ? defaults.madhab
          : settings.madhab;
      final highLatitudeRule = settings.mode == PrayerCalculationMode.automatic
          ? defaults.highLatitudeRule
          : settings.highLatitudeRule;
      final zoneResult = _timeZone(timeZoneId, now: now);
      final zone = zoneResult.location;
      final localNow = now == null
          ? timezone.TZDateTime.now(zone)
          : timezone.TZDateTime.from(now, zone);
      final date = DateTime.utc(localNow.year, localNow.month, localNow.day);

      final parameters = _parameters(
        profile,
        madhab: madhab,
        highLatitudeRule: highLatitudeRule,
      );
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
      final hasRawSolarGap =
          rawSunrise == null ||
          rawSunset == null ||
          previousSunset == null ||
          nextSunrise == null;

      var fajr = times.fajr;
      var isha = times.isha;
      var usedRegionalFallback = false;
      if (!hasRawSolarGap &&
          (highLatitudeRule == PrayerHighLatitudeRule.profileTatarstan ||
              highLatitudeRule == PrayerHighLatitudeRule.profileRussia)) {
        final sunrise = rawSunrise;
        final sunset = rawSunset;
        if (highLatitudeRule == PrayerHighLatitudeRule.profileTatarstan) {
          final tatarstanProfile =
              profile == PrayerCalculationProfile.tatarstan;
          final fajrAngle = tatarstanProfile ? 18.0 : parameters.fajrAngle;
          final ishaAngle = tatarstanProfile ? 18.0 : parameters.ishaAngle;
          final currentFajr = tatarstanProfile
              ? rawFajr
              : fajrAngle > 0
              ? _solarAngle(
                  dateComponents,
                  solar,
                  fajrAngle,
                  afterTransit: false,
                )
              : null;
          final previousNightIsha = tatarstanProfile
              ? previousIsha18
              : ishaAngle > 0
              ? _solarAngle(
                  previousComponents,
                  previousSolar,
                  ishaAngle,
                  afterTransit: true,
                )
              : null;
          final currentIsha = tatarstanProfile
              ? rawIsha18
              : ishaAngle > 0
              ? _solarAngle(
                  dateComponents,
                  solar,
                  ishaAngle,
                  afterTransit: true,
                )
              : null;
          final nextNightFajr = tatarstanProfile
              ? nextFajr18
              : fajrAngle > 0
              ? _solarAngle(
                  nextComponents,
                  nextSolar,
                  fajrAngle,
                  afterTransit: false,
                )
              : null;
          final noFajr =
              fajrAngle > 0 &&
              (currentFajr == null || previousNightIsha == null);
          final noIsha =
              ishaAngle > 0 && (currentIsha == null || nextNightFajr == null);
          fajr = noFajr
              ? _roundMinute(sunrise.subtract(const Duration(minutes: 120)))
              : currentFajr == null
              ? times.fajr
              : _adjustRawTime(currentFajr, parameters, fajr: true);
          isha = noIsha
              ? _roundMinute(sunset.add(const Duration(minutes: 90)))
              : ishaAngle == 0
              ? times.isha
              : _adjustRawTime(
                  tatarstanProfile ? rawIsha15! : currentIsha!,
                  parameters,
                  fajr: false,
                );
          usedRegionalFallback = noFajr || noIsha;
        } else {
          final fajrAngle = parameters.fajrAngle;
          final ishaAngle = parameters.ishaAngle;
          final missingFajr = fajrAngle > 0
              ? _solarAngle(
                      dateComponents,
                      solar,
                      fajrAngle,
                      afterTransit: false,
                    ) ==
                    null
              : false;
          final missingIsha = ishaAngle > 0
              ? _solarAngle(
                      dateComponents,
                      solar,
                      ishaAngle,
                      afterTransit: true,
                    ) ==
                    null
              : false;
          final noFajr = missingFajr;
          final noIsha = missingIsha;
          if (noFajr) {
            fajr = _fractionBeforeSunrise(previousSunset, sunrise, 0.3);
          } else if (fajrAngle > 0) {
            final raw = _solarAngle(
              dateComponents,
              solar,
              fajrAngle,
              afterTransit: false,
            );
            if (raw != null) {
              fajr = _adjustRawTime(raw, parameters, fajr: true);
            }
          }
          if (noIsha) {
            isha = _fractionAfterSunset(sunset, nextSunrise, 0.25);
          } else if (ishaAngle > 0) {
            final raw = _solarAngle(
              dateComponents,
              solar,
              ishaAngle,
              afterTransit: true,
            );
            if (raw != null) {
              isha = _adjustRawTime(raw, parameters, fajr: false);
            }
          }
          usedRegionalFallback = noFajr || noIsha;
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
        regionalProfile: switch (profile) {
          PrayerCalculationProfile.tatarstan => RegionalPrayerProfile.tatarstan,
          PrayerCalculationProfile.russia => RegionalPrayerProfile.russia,
          _ => RegionalPrayerProfile.muslimWorldLeague,
        },
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
            times.isApproximate ||
            times.usedPolarResolution ||
            hasRawSolarGap ||
            usedRegionalFallback,
        notice: zoneResult.notice,
      );
    } on Object {
      return null;
    }
  }

  CalculationParameters _parameters(
    PrayerCalculationProfile profile, {
    required Madhab madhab,
    required PrayerHighLatitudeRule highLatitudeRule,
  }) {
    final adhanHighLatitudeRule = switch (highLatitudeRule) {
      PrayerHighLatitudeRule.middleOfTheNight ||
      PrayerHighLatitudeRule.profileTatarstan ||
      PrayerHighLatitudeRule.profileRussia =>
        HighLatitudeRule.middle_of_the_night,
      PrayerHighLatitudeRule.seventhOfTheNight =>
        HighLatitudeRule.seventh_of_the_night,
      PrayerHighLatitudeRule.twilightAngle => HighLatitudeRule.twilight_angle,
    };
    if (profile == PrayerCalculationProfile.tatarstan ||
        profile == PrayerCalculationProfile.russia) {
      return CalculationParameters(
        method: CalculationMethod.other,
        fajrAngle: 18,
        ishaAngle: 15,
        madhab: madhab,
        highLatitudeRule: adhanHighLatitudeRule,
        adjustments: profile == PrayerCalculationProfile.russia
            ? const PrayerAdjustments(sunrise: -5, dhuhr: 5, maghrib: 5)
            : const PrayerAdjustments(),
      );
    }
    return profile.calculationMethod!.getParameters().copyWith(
      madhab: madhab,
      highLatitudeRule: adhanHighLatitudeRule,
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
    PrayerCalculationProfile profile,
    DateTime calculatedDhuhr,
    DateTime rawTransit,
    DateTime localDate,
    timezone.Location zone,
  ) {
    if (profile != PrayerCalculationProfile.tatarstan) return calculatedDhuhr;
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
    return _solarEvent(date, hours);
  }

  DateTime _adjustRawTime(
    DateTime raw,
    CalculationParameters parameters, {
    required bool fajr,
  }) {
    final offset = fajr
        ? parameters.adjustments.fajr + parameters.methodAdjustments.fajr
        : parameters.adjustments.isha + parameters.methodAdjustments.isha;
    final adjusted = raw.add(Duration(minutes: offset));
    if (parameters.rounding == Rounding.none) return adjusted;
    final seconds = (adjusted.millisecondsSinceEpoch / 1000).floor();
    final minutes = seconds / 60;
    final rounded = parameters.rounding == Rounding.up
        ? minutes.ceil()
        : (minutes + 0.5).floor();
    return DateTime.fromMillisecondsSinceEpoch(
      rounded * 60000,
      isUtc: adjusted.isUtc,
    );
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
    required this.regionalProfile,
    required this.entries,
    required this.isApproximate,
    this.notice,
  });

  final PrayerCalculationProfile profile;
  final RegionalPrayerProfile regionalProfile;
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
