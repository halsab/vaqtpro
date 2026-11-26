import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/calculation_profile.dart';

class CalculationProfileViewModel extends ChangeNotifier {
  CalculationProfileViewModel([this._preferences]);

  static const _storageKey = 'prayer_calculation_profile_overrides_v1';
  final SharedPreferencesAsync? _preferences;
  final Map<String, CalculationProfileSelection> _overrides = {};
  bool isLoading = true;

  CalculationProfileSelection selectionFor(String locationKey) =>
      _overrides[locationKey] ?? CalculationProfileSelection.byLocation;

  Future<void> initialize() async {
    try {
      final encoded = await _preferences?.getString(_storageKey);
      if (encoded != null) {
        final values = jsonDecode(encoded) as Map<String, dynamic>;
        _overrides
          ..clear()
          ..addEntries(
            values.entries.map((entry) {
              try {
                return MapEntry(
                  entry.key,
                  CalculationProfileSelection.values.byName(
                    entry.value as String,
                  ),
                );
              } on Object {
                return null;
              }
            }).whereType<MapEntry<String, CalculationProfileSelection>>(),
          );
      }
    } on Object {
      _overrides.clear();
    }
    isLoading = false;
    notifyListeners();
  }

  Future<bool> saveForLocation(
    String locationKey,
    CalculationProfileSelection selection,
  ) async {
    final updated = Map<String, CalculationProfileSelection>.from(_overrides);
    if (selection == CalculationProfileSelection.byLocation) {
      updated.remove(locationKey);
    } else {
      updated[locationKey] = selection;
    }
    try {
      await _preferences?.setString(
        _storageKey,
        jsonEncode({
          for (final entry in updated.entries) entry.key: entry.value.name,
        }),
      );
      _overrides
        ..clear()
        ..addAll(updated);
      notifyListeners();
      return true;
    } on Object {
      return false;
    }
  }
}
