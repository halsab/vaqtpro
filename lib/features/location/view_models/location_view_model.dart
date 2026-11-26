import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:timezone/data/latest_all.dart' as timezone_data;
import 'package:timezone/timezone.dart' as timezone;

import '../models/geolocation_state.dart';
import '../models/prayer_location.dart';
import '../repositories/geolocation_repository.dart';
import '../repositories/geonames_repository.dart';
import '../repositories/location_repository.dart';
import '../repositories/offline_place_catalog_repository.dart';

enum LocationLoadState { loading, ready, failed }

enum FavoriteChangeResult { added, removed, failed }

class LocationViewModel extends ChangeNotifier {
  LocationViewModel({
    required this._repository,
    required this._geolocation,
    required this._catalog,
    required this._geonames,
    this.locationOperationTimeout = const Duration(seconds: 35),
  }) {
    _initializeTimeZones();
  }

  final LocationRepository _repository;
  final GeolocationRepository _geolocation;
  final OfflinePlaceCatalogRepository _catalog;
  final GeoNamesRepository _geonames;
  final Duration locationOperationTimeout;
  static const bool _locationDiagnosticsEnabled = bool.fromEnvironment(
    'LOCATION_DIAGNOSTICS',
  );

  static bool _timeZonesInitialized = false;
  SavedLocationState _saved = const SavedLocationState();
  LocationLoadState loadState = LocationLoadState.loading;
  GeoPermissionState permission = GeoPermissionState.unknown;
  bool isResolvingLocation = false;
  bool isSearching = false;
  bool isOnlineSearchPending = false;
  bool isSaving = false;
  bool showAllFavorites = false;
  String? permissionMessage;
  String? storageMessage;
  String searchQuery = '';
  List<PrayerLocation> searchResults = const [];
  List<PrayerLocation> _localSearchResults = const [];
  Timer? _onlineSearchTimer;
  int _locationGeneration = 0;
  int _searchGeneration = 0;
  int _activeWrites = 0;
  Future<void> _saveQueue = Future<void>.value();

  PrayerLocation? get selected => _saved.selected;
  List<PrayerLocation> get favorites => List.unmodifiable(_saved.favorites);
  List<PrayerLocation> get recents => List.unmodifiable(_saved.recents);
  bool get manualSelectionIsPrimary =>
      permission == GeoPermissionState.denied ||
      permission == GeoPermissionState.permanentlyDenied ||
      permission == GeoPermissionState.servicesDisabled;
  bool get hasQuickPlaces => favorites.isNotEmpty || recents.isNotEmpty;
  bool get canOpenSettings => _geolocation.supportsSettingsNavigation;

  List<PrayerLocation> get quickPlaces {
    final visibleFavorites = showAllFavorites
        ? favorites
        : favorites.take(5).toList();
    final favoriteIds = favorites.map((item) => item.identityKey).toSet();
    final visibleRecents = recents
        .where((item) => !favoriteIds.contains(item.identityKey))
        .take(5);
    return [...visibleFavorites, ...visibleRecents];
  }

  bool get hasMoreFavorites => favorites.length > 5 && !showAllFavorites;

  Future<void> initialize() async {
    loadState = LocationLoadState.loading;
    storageMessage = null;
    notifyListeners();
    try {
      _saved = await _repository.load();
      if (_saved.selected == null) {
        try {
          final currentPermission = await _geolocation.checkPermission();
          permission =
              currentPermission == GeoPermissionState.denied &&
                  !_saved.hasAskedLocationPermission
              ? GeoPermissionState.unknown
              : currentPermission;
        } catch (_) {
          permission = GeoPermissionState.unknown;
        }
      } else {
        permission = GeoPermissionState.unknown;
      }
      loadState = LocationLoadState.ready;
    } catch (_) {
      loadState = LocationLoadState.failed;
      storageMessage = 'Не удалось загрузить сохранённые места.';
    }
    notifyListeners();
  }

  Future<void> refreshPermission() async {
    if (selected != null) return;
    try {
      final currentPermission = await _geolocation.checkPermission();
      permission =
          currentPermission == GeoPermissionState.denied &&
              !_saved.hasAskedLocationPermission
          ? GeoPermissionState.unknown
          : currentPermission;
      if (permission == GeoPermissionState.granted) {
        permissionMessage = null;
      }
      notifyListeners();
    } catch (_) {
      // Keep the last known state. A later explicit action can retry.
    }
  }

  Future<bool> determineLocation() async {
    if (isResolvingLocation || loadState != LocationLoadState.ready) {
      return false;
    }
    final generation = ++_locationGeneration;
    permissionMessage = null;
    storageMessage = null;

    if (permission == GeoPermissionState.permanentlyDenied) {
      permissionMessage = _permissionDeniedMessage;
      notifyListeners();
      return false;
    }

    isResolvingLocation = true;
    notifyListeners();
    final deadline = DateTime.now().add(locationOperationTimeout);
    var step = 'сохранение состояния разрешения';
    try {
      _saved = _saved.markLocationPermissionAsked();
      try {
        await _repository.save(_saved).timeout(_remaining(deadline));
      } on TimeoutException {
        rethrow;
      } catch (_) {
        storageMessage =
            'Не удалось сохранить состояние разрешения геолокации.';
      }
      if (generation != _locationGeneration) return false;
      step = 'запрос разрешения';
      _locationDiagnostic('requesting permission');
      permission = await _geolocation.requestPermission().timeout(
        _remaining(deadline),
      );
      _locationDiagnostic('permission resolved: ${permission.name}');
      if (generation != _locationGeneration) return false;
      if (permission != GeoPermissionState.granted) {
        permissionMessage = switch (permission) {
          GeoPermissionState.permanentlyDenied => _permissionDeniedMessage,
          GeoPermissionState.servicesDisabled => 'Включите службы геолокации в настройках устройства или выберите место вручную.',
          GeoPermissionState.denied =>
            'Нет доступа к геолокации. Можно выбрать место вручную.',
          _ => 'Не удалось получить доступ к геолокации. Попробуйте ещё раз.',
        };
        return false;
      }

      step = 'получение координат';
      _locationDiagnostic('requesting coordinates');
      final coordinates = await _geolocation.currentCoordinates().timeout(
        _remaining(deadline),
      );
      _locationDiagnostic(
        'coordinates received: ${coordinates.latitude}, ${coordinates.longitude}',
      );
      if (generation != _locationGeneration) return false;
      step = 'определение населённого пункта';
      final place = await _resolvePlace(coordinates)
          .timeout(_remaining(deadline));
      _locationDiagnostic('resolved place: ${place.displayName}');
      if (generation != _locationGeneration) return false;
      step = 'сохранение места';
      return await _commit(
        (state) => state.select(place),
        timeout: _remaining(deadline),
        locationGeneration: generation,
      );
    } on TimeoutException {
      if (generation == _locationGeneration) {
        _locationDiagnostic('timed out at $step');
        ++_locationGeneration;
        permissionMessage =
            'Не удалось завершить $step вовремя. Проверьте геолокацию устройства и попробуйте снова.';
        isResolvingLocation = false;
        notifyListeners();
      }
      return false;
    } catch (error) {
      if (generation == _locationGeneration) {
        _locationDiagnostic('failed at $step: ${error.runtimeType} $error');
        permissionMessage = 'Не удалось определить местоположение. Проверьте доступ и попробуйте ещё раз.';
      }
      return false;
    } finally {
      if (generation == _locationGeneration) {
        isResolvingLocation = false;
        notifyListeners();
      }
    }
  }

  Duration _remaining(DateTime deadline) => deadline.difference(DateTime.now());

  void _locationDiagnostic(String message) {
    if (kDebugMode && _locationDiagnosticsEnabled) {
      debugPrint('[location] $message');
    }
  }

  void cancelLocationDetection() {
    if (!isResolvingLocation) return;
    ++_locationGeneration;
    isResolvingLocation = false;
    permissionMessage = null;
    notifyListeners();
  }

  String get _permissionDeniedMessage => canOpenSettings
      ? 'Доступ к геолокации запрещён. Включите его в настройках приложения или выберите место вручную.'
      : 'Доступ к геолокации запрещён. Разрешите его в настройках сайта в браузере или выберите место вручную.';

  Future<void> openSettings() async {
    var opened = false;
    try {
      opened = permission == GeoPermissionState.servicesDisabled
          ? await _geolocation.openLocationSettings()
          : await _geolocation.openApplicationSettings();
    } catch (_) {
      opened = false;
    }
    if (!opened) {
      permissionMessage =
          'Откройте настройки разрешений для Vaqtpro и включите геолокацию.';
      notifyListeners();
    }
  }

  Future<void> selectLocation(PrayerLocation location) async {
    ++_locationGeneration;
    ++_searchGeneration;
    _onlineSearchTimer?.cancel();
    searchQuery = '';
    searchResults = const [];
    _localSearchResults = const [];
    isSearching = false;
    isOnlineSearchPending = false;
    isResolvingLocation = false;
    permissionMessage = null;
    storageMessage = null;
    notifyListeners();
    await _commit((state) => state.select(location));
  }

  Future<FavoriteChangeResult> toggleFavorite(PrayerLocation location) async {
    storageMessage = null;
    var isFavorite = false;
    final saved = await _commit((state) {
      final next = state.toggleFavorite(location);
      isFavorite = next.favorites.any(
        (item) => item.identityKey == location.identityKey,
      );
      return next;
    }, reportStorageError: false);
    if (!saved) return FavoriteChangeResult.failed;
    return isFavorite
        ? FavoriteChangeResult.added
        : FavoriteChangeResult.removed;
  }

  bool isFavorite(PrayerLocation location) =>
      favorites.any((favorite) => favorite.identityKey == location.identityKey);

  void showAllSavedFavorites() {
    showAllFavorites = true;
    notifyListeners();
  }

  void collapseFavoriteList() {
    showAllFavorites = false;
  }

  Future<void> search(String query) async {
    searchQuery = query;
    final generation = ++_searchGeneration;
    _onlineSearchTimer?.cancel();
    _localSearchResults = const [];
    searchResults = const [];
    isOnlineSearchPending = false;
    final trimmed = query.trim();
    if (trimmed.isEmpty) {
      isSearching = false;
      notifyListeners();
      return;
    }

    isSearching = true;
    final canSearchOnline = _geonames.isConfigured && trimmed.runes.length >= 2;
    isOnlineSearchPending = canSearchOnline;
    notifyListeners();
    if (canSearchOnline) {
      _onlineSearchTimer = Timer(const Duration(milliseconds: 280), () {
        _searchOnline(trimmed, generation);
      });
    }

    try {
      final local = await _catalog.search(trimmed, origin: selected, limit: 20);
      if (generation != _searchGeneration) return;
      _localSearchResults = local;
      searchResults = _rankResults(local, trimmed);
      isSearching = false;
      notifyListeners();
    } catch (_) {
      if (generation != _searchGeneration) return;
      isSearching = false;
      notifyListeners();
    }
  }

  Future<void> _searchOnline(String query, int generation) async {
    if (!_geonames.isConfigured) return;
    try {
      final online = await _geonames.search(query);
      if (generation != _searchGeneration) return;
      final byId = <String, PrayerLocation>{
        for (final place in _localSearchResults)
          if (place.geonameId != null) place.geonameId!: place,
      };
      final withoutId = <PrayerLocation>[];
      for (final place in online) {
        final id = place.geonameId;
        if (id == null) {
          withoutId.add(place);
        } else {
          byId.putIfAbsent(id, () => place);
        }
      }
      searchResults = _rankResults([...byId.values, ...withoutId], query);
    } catch (_) {
      // Online search is additive; retain the local results on any failure.
    } finally {
      if (generation == _searchGeneration) {
        isOnlineSearchPending = false;
        notifyListeners();
      }
    }
  }

  List<PrayerLocation> _rankResults(List<PrayerLocation> places, String query) {
    final normalizedQuery = _normalize(query);
    final origin = selected;
    final indexed = places.map((place) {
      final terms = [
        place.displayName,
        ...place.alternateNames,
      ].map(_normalize);
      var rank = 3;
      for (final name in terms) {
        if (name == normalizedQuery) {
          rank = 0;
          break;
        }
        if (name.startsWith(normalizedQuery)) {
          rank = rank > 1 ? 1 : rank;
        } else if (name.contains(normalizedQuery)) {
          rank = rank > 2 ? 2 : rank;
        }
      }
      return (
        place: place,
        rank: rank,
        distance: origin == null
            ? double.infinity
            : place.distanceTo(origin.latitude, origin.longitude),
      );
    }).toList();
    indexed.sort((left, right) {
      final byRank = left.rank.compareTo(right.rank);
      if (byRank != 0) return byRank;
      final byDistance = left.distance.compareTo(right.distance);
      if (byDistance != 0) return byDistance;
      return right.place.population.compareTo(left.place.population);
    });
    return indexed.map((item) => item.place).toList(growable: false);
  }

  Future<PrayerLocation> _resolvePlace(DeviceCoordinates coordinates) async {
    final offlineLookup = _catalog
        .nearest(coordinates.latitude, coordinates.longitude, maxDistanceKm: 25)
        .catchError((_) => null);
    if (_geonames.isConfigured) {
      try {
        final online = await _geonames
            .reverseGeocode(coordinates.latitude, coordinates.longitude)
            .timeout(const Duration(milliseconds: 1200));
        if (online != null) return online;
      } catch (_) {
        // Use the bundled catalog when the network cannot resolve the place.
      }
    }

    final nearby = await offlineLookup;
    return nearby ??
        PrayerLocation(
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
        );
  }

  Future<bool> _commit(
    SavedLocationState Function(SavedLocationState current) transition, {
    Duration? timeout,
    int? locationGeneration,
    bool reportStorageError = true,
  }) {
    final completer = Completer<bool>();
    _activeWrites++;
    isSaving = true;
    notifyListeners();
    _saveQueue = _saveQueue.then((_) async {
      if (locationGeneration != null &&
          locationGeneration != _locationGeneration) {
        completer.complete(false);
        _activeWrites--;
        isSaving = _activeWrites > 0;
        notifyListeners();
        return;
      }
      final next = transition(_saved);
      try {
        final save = _repository.save(next);
        if (timeout == null) {
          await save;
        } else {
          await save.timeout(timeout);
        }
        if (locationGeneration != null &&
            locationGeneration != _locationGeneration) {
          try {
            await _repository.save(_saved);
          } catch (_) {
            if (reportStorageError) {
              storageMessage =
                  'Не удалось сохранить изменения. Попробуйте ещё раз.';
            }
          }
          completer.complete(false);
        } else {
          _saved = next;
          storageMessage = null;
          completer.complete(true);
        }
      } catch (error) {
        if (reportStorageError) {
          storageMessage =
              'Не удалось сохранить изменения. Попробуйте ещё раз.';
        }
        if (error is TimeoutException) {
          completer.completeError(error);
        } else {
          completer.complete(false);
        }
      } finally {
        _activeWrites--;
        isSaving = _activeWrites > 0;
        notifyListeners();
      }
    });
    return completer.future;
  }

  String? timezoneDifferenceLabel({DateTime? now, Duration? deviceOffset}) {
    final timezoneId = selected?.timeZoneId;
    if (timezoneId == null || timezoneId.isEmpty) return null;
    try {
      final location = timezone.getLocation(timezoneId);
      final instant = now ?? DateTime.now();
      final offset = timezone.TZDateTime.from(instant, location).timeZoneOffset;
      final difference = offset - (deviceOffset ?? instant.timeZoneOffset);
      final minutes = difference.inMinutes;
      if (minutes == 0) return null;
      final sign = minutes < 0 ? '−' : '+';
      final absoluteMinutes = minutes.abs();
      final hours = absoluteMinutes ~/ 60;
      final remainingMinutes = absoluteMinutes % 60;
      return remainingMinutes == 0
          ? '$sign$hours'
          : '$sign$hours:${remainingMinutes.toString().padLeft(2, '0')}';
    } on Object {
      return null;
    }
  }

  void _initializeTimeZones() {
    if (_timeZonesInitialized) return;
    timezone_data.initializeTimeZones();
    _timeZonesInitialized = true;
  }

  @override
  void dispose() {
    _onlineSearchTimer?.cancel();
    ++_searchGeneration;
    ++_locationGeneration;
    super.dispose();
  }
}

String _normalize(String value) => value
    .trim()
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replaceAll(_whitespace, ' ');

final _whitespace = RegExp(r'\s+');
