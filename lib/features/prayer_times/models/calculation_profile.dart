import 'package:adhan/adhan.dart';

enum PrayerCalculationMode { automatic, manual }

enum PrayerCalculationProfile {
  tatarstan,
  russia,
  muslimWorldLeague,
  egyptian,
  karachi,
  ummAlQura,
  dubai,
  moonSightingCommittee,
  northAmerica,
  kuwait,
  qatar,
  singapore,
  turkey,
  tehran,
}

enum PrayerHighLatitudeRule {
  middleOfTheNight,
  seventhOfTheNight,
  twilightAngle,
  profileTatarstan,
  profileRussia,
}

class PrayerCalculationConfiguration {
  const PrayerCalculationConfiguration({
    this.mode = PrayerCalculationMode.automatic,
    this.profile = PrayerCalculationProfile.muslimWorldLeague,
    this.madhab = Madhab.shafi,
    this.highLatitudeRule = PrayerHighLatitudeRule.middleOfTheNight,
  });

  final PrayerCalculationMode mode;
  final PrayerCalculationProfile profile;
  final Madhab madhab;
  final PrayerHighLatitudeRule highLatitudeRule;

  PrayerCalculationConfiguration copyWith({
    PrayerCalculationMode? mode,
    PrayerCalculationProfile? profile,
    Madhab? madhab,
    PrayerHighLatitudeRule? highLatitudeRule,
  }) => PrayerCalculationConfiguration(
    mode: mode ?? this.mode,
    profile: profile ?? this.profile,
    madhab: madhab ?? this.madhab,
    highLatitudeRule: highLatitudeRule ?? this.highLatitudeRule,
  );

  PrayerCalculationConfiguration selectingProfile(
    PrayerCalculationProfile value,
  ) {
    final defaults = defaultsForProfile(value);
    return copyWith(
      profile: value,
      madhab: defaults.madhab,
      highLatitudeRule: defaults.highLatitudeRule,
    );
  }

  Map<String, Object> toJson() => {
    'mode': mode.name,
    'profile': profile.name,
    'madhab': madhab.name,
    'highLatitudeRule': highLatitudeRule.name,
  };

  factory PrayerCalculationConfiguration.fromJson(Map<String, dynamic> json) =>
      PrayerCalculationConfiguration(
        mode: PrayerCalculationMode.values.byName(
          json['mode'] as String? ?? PrayerCalculationMode.automatic.name,
        ),
        profile: PrayerCalculationProfile.values.byName(
          json['profile'] as String? ??
              PrayerCalculationProfile.muslimWorldLeague.name,
        ),
        madhab: Madhab.values.byName(json['madhab'] as String),
        highLatitudeRule: PrayerHighLatitudeRule.values.byName(
          json['highLatitudeRule'] as String,
        ),
      );
}

PrayerCalculationConfiguration defaultsForProfile(
  PrayerCalculationProfile profile,
) {
  if (profile == PrayerCalculationProfile.tatarstan) {
    return const PrayerCalculationConfiguration(
      profile: PrayerCalculationProfile.tatarstan,
      madhab: Madhab.hanafi,
      highLatitudeRule: PrayerHighLatitudeRule.profileTatarstan,
    );
  }
  if (profile == PrayerCalculationProfile.russia) {
    return const PrayerCalculationConfiguration(
      profile: PrayerCalculationProfile.russia,
      madhab: Madhab.shafi,
      highLatitudeRule: PrayerHighLatitudeRule.profileRussia,
    );
  }
  final parameters = profile.calculationMethod!.getParameters();
  return PrayerCalculationConfiguration(
    profile: profile,
    madhab: parameters.madhab,
    highLatitudeRule: switch (parameters.highLatitudeRule) {
      HighLatitudeRule.seventh_of_the_night =>
        PrayerHighLatitudeRule.seventhOfTheNight,
      HighLatitudeRule.twilight_angle => PrayerHighLatitudeRule.twilightAngle,
      HighLatitudeRule.automatic => PrayerHighLatitudeRule.middleOfTheNight,
      HighLatitudeRule.middle_of_the_night =>
        PrayerHighLatitudeRule.middleOfTheNight,
    },
  );
}

extension PrayerCalculationProfileDetails on PrayerCalculationProfile {
  CalculationMethod? get calculationMethod => switch (this) {
    PrayerCalculationProfile.tatarstan ||
    PrayerCalculationProfile.russia => null,
    PrayerCalculationProfile.muslimWorldLeague =>
      CalculationMethod.muslim_world_league,
    PrayerCalculationProfile.egyptian => CalculationMethod.egyptian,
    PrayerCalculationProfile.karachi => CalculationMethod.karachi,
    PrayerCalculationProfile.ummAlQura => CalculationMethod.umm_al_qura,
    PrayerCalculationProfile.dubai => CalculationMethod.dubai,
    PrayerCalculationProfile.moonSightingCommittee =>
      CalculationMethod.moon_sighting_committee,
    PrayerCalculationProfile.northAmerica => CalculationMethod.north_america,
    PrayerCalculationProfile.kuwait => CalculationMethod.kuwait,
    PrayerCalculationProfile.qatar => CalculationMethod.qatar,
    PrayerCalculationProfile.singapore => CalculationMethod.singapore,
    PrayerCalculationProfile.turkey => CalculationMethod.turkey,
    PrayerCalculationProfile.tehran => CalculationMethod.tehran,
  };

  String get label => switch (this) {
    PrayerCalculationProfile.tatarstan => 'Татарстан',
    PrayerCalculationProfile.russia => 'Россия',
    PrayerCalculationProfile.muslimWorldLeague =>
      'Всемирная мусульманская лига',
    PrayerCalculationProfile.egyptian => 'Египетский геодезический институт',
    PrayerCalculationProfile.karachi => 'Карачи',
    PrayerCalculationProfile.ummAlQura => 'Умм аль-Кура',
    PrayerCalculationProfile.dubai => 'Дубай',
    PrayerCalculationProfile.moonSightingCommittee => 'Комитет наблюдения луны',
    PrayerCalculationProfile.northAmerica => 'Северная Америка (ISNA)',
    PrayerCalculationProfile.kuwait => 'Кувейт',
    PrayerCalculationProfile.qatar => 'Катар',
    PrayerCalculationProfile.singapore => 'Сингапур',
    PrayerCalculationProfile.turkey => 'Турция (Diyanet)',
    PrayerCalculationProfile.tehran => 'Тегеран',
  };
}

String madhabLabel(Madhab madhab) => switch (madhab) {
  Madhab.shafi => 'Шафиитский (одинарная тень)',
  Madhab.hanafi => 'Ханафитский (двойная тень)',
};

String prayerHighLatitudeRuleLabel(PrayerHighLatitudeRule rule) =>
    switch (rule) {
      PrayerHighLatitudeRule.middleOfTheNight => 'Середина ночи',
      PrayerHighLatitudeRule.seventhOfTheNight => 'Седьмая часть ночи',
      PrayerHighLatitudeRule.twilightAngle => 'Угол сумерек',
      PrayerHighLatitudeRule.profileTatarstan =>
        'По правилам профиля Татарстан',
      PrayerHighLatitudeRule.profileRussia => 'По правилам профиля Россия',
    };

PrayerCalculationProfile prayerCalculationProfileForRegion(
  String? countryCode,
  String? regionCode,
) {
  if (countryCode != 'RU') return PrayerCalculationProfile.muslimWorldLeague;
  return regionCode == '73'
      ? PrayerCalculationProfile.tatarstan
      : PrayerCalculationProfile.russia;
}

String automaticProfileSummary(PrayerCalculationProfile profile) {
  final defaults = defaultsForProfile(profile);
  return '${profile.label} · Аср: ${madhabLabel(defaults.madhab)} · '
      'Высокие широты: По профилю';
}
