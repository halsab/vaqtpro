import '../models/geolocation_state.dart';
import '../services/geolocation_service.dart';

abstract interface class GeolocationRepository {
  bool get supportsSettingsNavigation;
  Future<GeoPermissionState> checkPermission();
  Future<GeoPermissionState> requestPermission();
  Future<DeviceCoordinates> currentCoordinates();
  Future<bool> openApplicationSettings();
  Future<bool> openLocationSettings();
}

class PlatformGeolocationRepository implements GeolocationRepository {
  PlatformGeolocationRepository(this._service);

  final PlatformGeolocationService _service;

  @override
  bool get supportsSettingsNavigation => _service.supportsSettingsNavigation;

  @override
  Future<GeoPermissionState> checkPermission() => _service.checkPermission();

  @override
  Future<GeoPermissionState> requestPermission() =>
      _service.requestPermission();

  @override
  Future<DeviceCoordinates> currentCoordinates() =>
      _service.currentCoordinates();

  @override
  Future<bool> openApplicationSettings() => _service.openApplicationSettings();

  @override
  Future<bool> openLocationSettings() => _service.openLocationSettings();
}
