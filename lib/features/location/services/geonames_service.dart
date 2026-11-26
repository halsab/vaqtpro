import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/prayer_location.dart';

class HttpGeoNamesService {
  HttpGeoNamesService({required String username, http.Client? client})
    : _username = username.trim(),
      _client = client ?? http.Client();

  static const _baseUri = 'https://secure.geonames.org';

  final String _username;
  final http.Client _client;

  bool get isConfigured => _username.isNotEmpty;

  Future<List<PrayerLocation>> search(String query) async {
    if (!isConfigured || query.trim().isEmpty) return const [];
    final uri = Uri.parse('$_baseUri/searchJSON').replace(
      queryParameters: {
        'name': query.trim(),
        'featureClass': 'P',
        'fuzzy': '0.8',
        'isNameRequired': 'true',
        'maxRows': '20',
        'lang': 'ru',
        'orderby': 'relevance',
        'username': _username,
      },
    );
    final response = await _client.get(uri).timeout(const Duration(seconds: 8));
    if (response.statusCode != 200) {
      throw http.ClientException('GeoNames returned ${response.statusCode}.');
    }
    final data = jsonDecode(response.body) as Map<String, dynamic>;
    final rows = data['geonames'] as List<dynamic>? ?? const [];
    return rows
        .whereType<Map<String, dynamic>>()
        .map(_parsePlace)
        .whereType<PrayerLocation>()
        .toList(growable: false);
  }

  Future<PrayerLocation?> reverseGeocode(
    double latitude,
    double longitude,
  ) async {
    if (!isConfigured) return null;
    final uri = Uri.parse('$_baseUri/findNearbyPlaceNameJSON').replace(
      queryParameters: {
        'lat': '$latitude',
        'lng': '$longitude',
        'radius': '25',
        'maxRows': '10',
        'lang': 'ru',
        'username': _username,
      },
    );
    final response = await _client.get(uri).timeout(const Duration(seconds: 8));
    if (response.statusCode != 200) {
      throw http.ClientException('GeoNames returned ${response.statusCode}.');
    }
    final data = jsonDecode(response.body) as Map<String, dynamic>;
    final rows = data['geonames'] as List<dynamic>? ?? const [];
    final candidates =
        rows
            .whereType<Map<String, dynamic>>()
            .map(_parsePlace)
            .whereType<PrayerLocation>()
            .where(
              (place) =>
                  place.distanceTo(latitude, longitude) <= 25 &&
                  place.geonameId != null,
            )
            .toList()
          ..sort(
            (left, right) => left
                .distanceTo(latitude, longitude)
                .compareTo(right.distanceTo(latitude, longitude)),
          );
    return candidates.firstOrNull;
  }

  PrayerLocation? _parsePlace(Map<String, dynamic> row) {
    final latitude = double.tryParse('${row['lat']}');
    final longitude = double.tryParse('${row['lng']}');
    final geonameId = row['geonameId']?.toString();
    final name = row['name']?.toString();
    if (latitude == null ||
        longitude == null ||
        geonameId == null ||
        name == null ||
        name.isEmpty) {
      return null;
    }
    final timezone = row['timezone'];
    final timezoneId = timezone is Map<String, dynamic>
        ? timezone['timeZoneId']?.toString()
        : row['timezoneId']?.toString();
    return PrayerLocation(
      geonameId: geonameId,
      name: name,
      region: row['adminName1']?.toString(),
      countryCode: row['countryCode']?.toString(),
      regionCode: row['adminCode1']?.toString(),
      country: row['countryName']?.toString(),
      latitude: latitude,
      longitude: longitude,
      timeZoneId: timezoneId,
      population: int.tryParse('${row['population']}') ?? 0,
      alternateNames: [
        if (row['toponymName'] case final String toponymName
            when toponymName != name)
          toponymName,
      ],
    );
  }
}
