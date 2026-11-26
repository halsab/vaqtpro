enum RegionalPrayerProfile { tatarstan, russia, muslimWorldLeague }

enum CalculationProfileSelection {
  byLocation,
  tatarstan,
  russia,
  muslimWorldLeague,
}

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

RegionalPrayerProfile profileForSelection(
  String? countryCode,
  String? regionCode,
  CalculationProfileSelection selection,
) => switch (selection) {
  CalculationProfileSelection.byLocation => profileForRegion(
    countryCode,
    regionCode,
  ),
  CalculationProfileSelection.tatarstan => RegionalPrayerProfile.tatarstan,
  CalculationProfileSelection.russia => RegionalPrayerProfile.russia,
  CalculationProfileSelection.muslimWorldLeague =>
    RegionalPrayerProfile.muslimWorldLeague,
};

String regionalPrayerProfileLabel(RegionalPrayerProfile profile) =>
    switch (profile) {
      RegionalPrayerProfile.tatarstan => 'Татарстан',
      RegionalPrayerProfile.russia => 'Россия',
      RegionalPrayerProfile.muslimWorldLeague => 'Всемирная мусульманская лига',
    };

String calculationProfileSelectionLabel(
  CalculationProfileSelection selection, {
  required String automaticProfileLabel,
}) => switch (selection) {
  CalculationProfileSelection.byLocation => 'По месту · $automaticProfileLabel',
  CalculationProfileSelection.tatarstan => 'Татарстан',
  CalculationProfileSelection.russia => 'Россия',
  CalculationProfileSelection.muslimWorldLeague =>
    'Всемирная мусульманская лига',
};
