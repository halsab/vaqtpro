enum GeoPermissionState {
  unknown,
  granted,
  denied,
  permanentlyDenied,
  servicesDisabled,
}

class DeviceCoordinates {
  const DeviceCoordinates(this.latitude, this.longitude);

  final double latitude;
  final double longitude;
}
