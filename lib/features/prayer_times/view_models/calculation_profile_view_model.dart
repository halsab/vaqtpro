import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/calculation_profile.dart';

class CalculationProfileViewModel extends ChangeNotifier {
  CalculationProfileViewModel([this._preferences]);

  static const _storageKey = 'prayer_calculation_profile';
  final SharedPreferencesAsync? _preferences;
  CalculationProfile profile = const CalculationProfile();
  bool isLoading = true;

  Future<void> initialize() async {
    try {
      final encoded = await _preferences?.getString(_storageKey);
      if (encoded != null) {
        profile = CalculationProfile.fromJson(
          jsonDecode(encoded) as Map<String, dynamic>,
        );
      }
    } on Object {
      // Keep the defaults if a saved profile is missing or no longer valid.
    }
    isLoading = false;
    notifyListeners();
  }

  Future<bool> save(CalculationProfile value) async {
    try {
      await _preferences?.setString(_storageKey, jsonEncode(value.toJson()));
      profile = value;
      notifyListeners();
      return true;
    } on Object {
      return false;
    }
  }
}
