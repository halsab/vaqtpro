import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

import '../models/geolocation_state.dart';

class PlatformGeolocationService {
  bool get supportsSettingsNavigation =>
      !kIsWeb &&
      (defaultTargetPlatform == TargetPlatform.android ||
          defaultTargetPlatform == TargetPlatform.iOS);

  Future<GeoPermissionState> checkPermission() async =>
      _mapPermission(await Geolocator.checkPermission());

  Future<GeoPermissionState> requestPermission() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      return GeoPermissionState.servicesDisabled;
    }
    return _mapPermission(await Geolocator.requestPermission());
  }

  Future<DeviceCoordinates> currentCoordinates() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw const LocationServiceDisabledException();
    }
    final position = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.medium,
        timeLimit: Duration(seconds: 25),
      ),
    );
    return DeviceCoordinates(position.latitude, position.longitude);
  }

  Future<bool> openApplicationSettings() =>
      kIsWeb ? Future.value(false) : Geolocator.openAppSettings();

  Future<bool> openLocationSettings() =>
      kIsWeb ? Future.value(false) : Geolocator.openLocationSettings();

  GeoPermissionState _mapPermission(LocationPermission permission) =>
      switch (permission) {
        LocationPermission.always ||
        LocationPermission.whileInUse => GeoPermissionState.granted,
        LocationPermission.denied => GeoPermissionState.denied,
        LocationPermission.deniedForever =>
          GeoPermissionState.permanentlyDenied,
        LocationPermission.unableToDetermine => GeoPermissionState.unknown,
      };
}
