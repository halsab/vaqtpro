import 'package:adhan/adhan.dart';

enum RegionalPrayerProfile { tatarstan, russia, muslimWorldLeague }

RegionalPrayerProfile profileForRegion(
  String? countryCode,
  String? regionCode,
) {
  if (countryCode != 'RU') {
    return RegionalPrayerProfile.muslimWorldLeague;
  }
  return regionCode == '73'
      ? RegionalPrayerProfile.tatarstan
      : RegionalPrayerProfile.russia;
}

String regionalPrayerProfileLabel(RegionalPrayerProfile profile) =>
    switch (profile) {
      RegionalPrayerProfile.tatarstan => 'ДУМ Республики Татарстан',
      RegionalPrayerProfile.russia => 'ДУМ РФ (московский профиль)',
      RegionalPrayerProfile.muslimWorldLeague => 'Всемирная мусульманская лига',
    };

/// Retained to read older saved settings while the location selects the
/// effective regional profile.
class CalculationProfile {
  const CalculationProfile({
    this.method = CalculationMethod.muslim_world_league,
    this.madhab = Madhab.shafi,
    this.highLatitudeRule = HighLatitudeRule.middle_of_the_night,
  });

  final CalculationMethod method;
  final Madhab madhab;
  final HighLatitudeRule highLatitudeRule;

  Map<String, Object> toJson() => {
    'method': method.name,
    'madhab': madhab.name,
    'highLatitudeRule': highLatitudeRule.name,
  };

  factory CalculationProfile.fromJson(Map<String, dynamic> json) =>
      CalculationProfile(
        method: CalculationMethod.values.byName(json['method'] as String),
        madhab: Madhab.values.byName(json['madhab'] as String),
        highLatitudeRule: HighLatitudeRule.values.byName(
          json['highLatitudeRule'] as String,
        ),
      );
}

String calculationMethodLabel(CalculationMethod method) => switch (method) {
  CalculationMethod.muslim_world_league => 'Всемирная мусульманская лига',
  CalculationMethod.egyptian => 'Египетский геодезический институт',
  CalculationMethod.karachi => 'Карачи',
  CalculationMethod.umm_al_qura => 'Умм аль-Кура',
  CalculationMethod.dubai => 'Дубай',
  CalculationMethod.moon_sighting_committee => 'Комитет наблюдения луны',
  CalculationMethod.north_america => 'Северная Америка (ISNA)',
  CalculationMethod.kuwait => 'Кувейт',
  CalculationMethod.qatar => 'Катар',
  CalculationMethod.singapore => 'Сингапур',
  CalculationMethod.turkey => 'Турция (Diyanet)',
  CalculationMethod.tehran => 'Тегеран',
  CalculationMethod.other => 'Другой',
};

String madhabLabel(Madhab madhab) => switch (madhab) {
  Madhab.shafi => 'Шафиитский (одинарная тень)',
  Madhab.hanafi => 'Ханафитский (двойная тень)',
};

String highLatitudeRuleLabel(HighLatitudeRule rule) => switch (rule) {
  HighLatitudeRule.automatic => 'Автоматически',
  HighLatitudeRule.middle_of_the_night => 'Середина ночи',
  HighLatitudeRule.seventh_of_the_night => 'Седьмая часть ночи',
  HighLatitudeRule.twilight_angle => 'Угол сумерек',
};
