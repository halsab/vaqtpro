import 'dart:async';
import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/prayer_location.dart';

class SavedLocationState {
  const SavedLocationState({
    this.selected,
    this.favorites = const [],
    this.recents = const [],
    this.hasAskedLocationPermission = false,
  });

  final PrayerLocation? selected;
  final List<PrayerLocation> favorites;
  final List<PrayerLocation> recents;
  final bool hasAskedLocationPermission;

  SavedLocationState markLocationPermissionAsked() => SavedLocationState(
    selected: selected,
    favorites: favorites,
    recents: recents,
    hasAskedLocationPermission: true,
  );

  SavedLocationState select(PrayerLocation location) {
    final updatedRecents = [
      location,
      ...recents.where((item) => item.identityKey != location.identityKey),
    ].take(5).toList();
    return SavedLocationState(
      selected: location,
      favorites: favorites,
      recents: updatedRecents,
      hasAskedLocationPermission: hasAskedLocationPermission,
    );
  }

  SavedLocationState toggleFavorite(PrayerLocation location) {
    final exists = favorites.any(
      (item) => item.identityKey == location.identityKey,
    );
    final updatedFavorites = exists
        ? favorites
              .where((item) => item.identityKey != location.identityKey)
              .toList()
        : [location, ...favorites];
    return SavedLocationState(
      selected: selected,
      favorites: updatedFavorites,
      recents: recents,
      hasAskedLocationPermission: hasAskedLocationPermission,
    );
  }

  Map<String, Object?> toJson() => {
    'selected': selected?.toJson(),
    'favorites': favorites.map((item) => item.toJson()).toList(),
    'recents': recents.map((item) => item.toJson()).toList(),
    'hasAskedLocationPermission': hasAskedLocationPermission,
  };

  factory SavedLocationState.fromJson(Map<String, Object?> json) {
    PrayerLocation? location(Object? value) => value == null
        ? null
        : PrayerLocation.fromJson(value as Map<String, Object?>);
    List<PrayerLocation> locations(Object? value) =>
        ((value as List<dynamic>?) ?? const [])
            .map(
              (item) => PrayerLocation.fromJson(item as Map<String, Object?>),
            )
            .toList();

    return SavedLocationState(
      selected: location(json['selected']),
      favorites: locations(json['favorites']),
      recents: locations(json['recents']),
      hasAskedLocationPermission:
          json['hasAskedLocationPermission'] as bool? ?? false,
    );
  }
}

abstract interface class LocationRepository {
  Future<SavedLocationState> load();
  Future<void> save(SavedLocationState state);
}

class PreferencesLocationRepository implements LocationRepository {
  PreferencesLocationRepository(this._preferences);

  static const _storageKey = 'saved_location_state_v1';
  final SharedPreferencesAsync _preferences;
  Future<void> _writeQueue = Future<void>.value();

  @override
  Future<SavedLocationState> load() async {
    final value = await _preferences.getString(_storageKey);
    if (value == null) return const SavedLocationState();
    final decoded = jsonDecode(value);
    if (decoded is! Map<String, dynamic>) {
      throw const FormatException('Saved location data is not an object.');
    }
    return SavedLocationState.fromJson(decoded);
  }

  @override
  Future<void> save(SavedLocationState state) {
    final encoded = jsonEncode(state.toJson());
    final completer = Completer<void>();
    _writeQueue = _writeQueue.then((_) async {
      try {
        await _preferences.setString(_storageKey, encoded);
        completer.complete();
      } catch (error, stackTrace) {
        completer.completeError(error, stackTrace);
      }
    });
    return completer.future;
  }
}
