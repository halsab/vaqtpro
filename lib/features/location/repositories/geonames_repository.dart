import '../models/prayer_location.dart';
import '../services/geonames_service.dart';

abstract interface class GeoNamesRepository {
  bool get isConfigured;
  Future<List<PrayerLocation>> search(String query);
  Future<PrayerLocation?> reverseGeocode(double latitude, double longitude);
}

class ServiceGeoNamesRepository implements GeoNamesRepository {
  ServiceGeoNamesRepository(this._service);

  final HttpGeoNamesService _service;

  @override
  bool get isConfigured => _service.isConfigured;

  @override
  Future<List<PrayerLocation>> search(String query) => _service.search(query);

  @override
  Future<PrayerLocation?> reverseGeocode(double latitude, double longitude) =>
      _service.reverseGeocode(latitude, longitude);
}
