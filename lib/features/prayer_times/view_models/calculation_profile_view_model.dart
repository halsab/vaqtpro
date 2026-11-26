import 'dart:convert';

import 'package:adhan/adhan.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/calculation_profile.dart';

class CalculationProfileViewModel extends ChangeNotifier {
  CalculationProfileViewModel([this._preferences]);

  static const _storageKey = 'prayer_calculation_settings_v2';
  static const _legacyOverridesKey = 'prayer_calculation_profile_overrides_v1';
  static const _legacyGlobalKey = 'prayer_calculation_profile';
  static const _unplacedKey = '__unplaced__';

  final SharedPreferencesAsync? _preferences;
  final Map<String, PrayerCalculationConfiguration> _configurations = {};
  Future<void> _writeQueue = Future<void>.value();
  bool isLoading = true;

  PrayerCalculationConfiguration configurationFor(
    String? locationKey, {
    required PrayerCalculationProfile automaticProfile,
  }) {
    final key = locationKey ?? _unplacedKey;
    final saved = _configurations[key];
    if (saved != null) return saved;

    if (locationKey != null) {
      final starter = _configurations[_unplacedKey];
      if (starter != null &&
          (starter.mode == PrayerCalculationMode.manual ||
              starter.profile != PrayerCalculationProfile.muslimWorldLeague ||
              starter.madhab != Madhab.shafi ||
              starter.highLatitudeRule !=
                  PrayerHighLatitudeRule.middleOfTheNight)) {
        return starter.copyWith(profile: starter.profile);
      }
    }
    return _automaticConfiguration(automaticProfile);
  }

  PrayerCalculationConfiguration _automaticConfiguration(
    PrayerCalculationProfile profile,
  ) =>
      defaultsForProfile(profile)
          .copyWith(mode: PrayerCalculationMode.automatic);

  Future<void> initialize() async {
    try {
      final encoded = await _preferences?.getString(_storageKey);
      if (encoded != null) {
        final json = jsonDecode(encoded) as Map<String, dynamic>;
        for (final entry in json.entries) {
          try {
            _configurations[entry.key] =
                PrayerCalculationConfiguration.fromJson(
                  entry.value as Map<String, dynamic>,
                );
          } on Object {
            // Ignore an invalid individual place configuration.
          }
        }
      } else {
        await _migrateLegacySettings();
      }
    } on Object {
      // Keep defaults if stored settings are unreadable.
    }
    isLoading = false;
    notifyListeners();
  }

  Future<void> _migrateLegacySettings() async {
    final legacyOverrides = await _preferences?.getString(_legacyOverridesKey);
    if (legacyOverrides != null) {
      final values = jsonDecode(legacyOverrides) as Map<String, dynamic>;
      for (final entry in values.entries) {
        final selection = entry.value;
        if (selection == 'tatarstan' ||
            selection == 'russia' ||
            selection == 'muslimWorldLeague') {
          final profile = switch (selection) {
            'tatarstan' => PrayerCalculationProfile.tatarstan,
            'russia' => PrayerCalculationProfile.russia,
            _ => PrayerCalculationProfile.muslimWorldLeague,
          };
          _configurations[entry.key] = defaultsForProfile(profile)
              .copyWith(mode: PrayerCalculationMode.manual);
        }
      }
    }

    final legacyGlobal = await _preferences?.getString(_legacyGlobalKey);
    if (legacyGlobal != null) {
      try {
        final json = jsonDecode(legacyGlobal) as Map<String, dynamic>;
        final method = CalculationMethod.values.byName(
          json['method'] as String,
        );
        if (method != CalculationMethod.other) {
          final profile = _profileFromMethod(method);
          final defaults = defaultsForProfile(profile);
          final madhab = Madhab.values.byName(json['madhab'] as String);
          final storedHighLatitudeRule = json['highLatitudeRule'] as String;
          final highLatitudeRule = switch (storedHighLatitudeRule) {
            'seventh_of_the_night' => PrayerHighLatitudeRule.seventhOfTheNight,
            'twilight_angle' => PrayerHighLatitudeRule.twilightAngle,
            _ => PrayerHighLatitudeRule.middleOfTheNight,
          };
          _configurations.putIfAbsent(
            _unplacedKey,
            () => defaults.copyWith(
              mode: PrayerCalculationMode.automatic,
              madhab: madhab,
              highLatitudeRule: highLatitudeRule,
            ),
          );
        }
      } on Object {
        // Keep the new defaults if the old configuration is invalid.
      }
    }

    if (_configurations.isNotEmpty) await _persist();
  }

  Future<bool> updateConfiguration(
    String? locationKey,
    PrayerCalculationConfiguration configuration,
  ) async {
    final key = locationKey ?? _unplacedKey;
    final previous = _configurations[key];
    _configurations[key] = configuration;
    notifyListeners();
    try {
      await _persist();
      return true;
    } on Object {
      if (_configurations[key] == configuration) {
        if (previous == null) {
          _configurations.remove(key);
        } else {
          _configurations[key] = previous;
        }
        notifyListeners();
      }
      return false;
    }
  }

  Future<void> _persist() async {
    final encoded = jsonEncode({
      for (final entry in _configurations.entries)
        entry.key: entry.value.toJson(),
    });
    _writeQueue = _writeQueue.then<void>(
      (_) async => _preferences?.setString(_storageKey, encoded),
      onError: (Object _) async =>
          _preferences?.setString(_storageKey, encoded),
    );
    await _writeQueue;
  }

  PrayerCalculationProfile _profileFromMethod(CalculationMethod method) =>
      PrayerCalculationProfile.values.firstWhere(
        (profile) => profile.calculationMethod == method,
      );
}
