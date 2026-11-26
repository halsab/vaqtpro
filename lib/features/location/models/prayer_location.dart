import 'dart:math' as math;

class PrayerLocation {
  const PrayerLocation({
    required this.latitude,
    required this.longitude,
    this.geonameId,
    this.name,
    this.region,
    this.countryCode,
    this.country,
    this.timeZoneId,
    this.population = 0,
    this.alternateNames = const [],
  });

  final String? geonameId;
  final String? name;
  final String? region;
  final String? countryCode;
  final String? country;
  final double latitude;
  final double longitude;
  final String? timeZoneId;
  final int population;
  final List<String> alternateNames;

  bool get isNamedPlace => geonameId != null && name != null;

  String get displayName =>
      name ?? '${latitude.toStringAsFixed(3)}, ${longitude.toStringAsFixed(3)}';

  String get identityKey => geonameId == null
      ? 'coordinates:${latitude.toStringAsPrecision(12)}:${longitude.toStringAsPrecision(12)}'
      : 'geoname:$geonameId';

  String? get subtitle {
    final parts = [
      if (region != null && region!.isNotEmpty) region!,
      if (country != null && country!.isNotEmpty) country!,
    ];
    return parts.isEmpty ? null : parts.join(', ');
  }

  double distanceTo(double otherLatitude, double otherLongitude) {
    const earthRadiusKm = 6371.0088;
    final latitudeDelta = _radians(otherLatitude - latitude);
    final longitudeDelta = _radians(otherLongitude - longitude);
    final rawA =
        math.pow(math.sin(latitudeDelta / 2), 2) +
        math.cos(_radians(latitude)) *
            math.cos(_radians(otherLatitude)) *
            math.pow(math.sin(longitudeDelta / 2), 2);
    final a = rawA.clamp(0, 1);
    return earthRadiusKm * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
  }

  PrayerLocation withLocalizedNames({
    String? regionName,
    String? countryName,
  }) => PrayerLocation(
    geonameId: geonameId,
    name: name,
    region: regionName ?? region,
    countryCode: countryCode,
    country: countryName ?? country,
    latitude: latitude,
    longitude: longitude,
    timeZoneId: timeZoneId,
    population: population,
    alternateNames: alternateNames,
  );

  Map<String, Object?> toJson() => {
    'geonameId': geonameId,
    'name': name,
    'region': region,
    'countryCode': countryCode,
    'country': country,
    'latitude': latitude,
    'longitude': longitude,
    'timeZoneId': timeZoneId,
    'population': population,
    'alternateNames': alternateNames,
  };

  factory PrayerLocation.fromJson(Map<String, Object?> json) => PrayerLocation(
    geonameId: json['geonameId'] as String?,
    name: json['name'] as String?,
    region: json['region'] as String?,
    countryCode: json['countryCode'] as String?,
    country: json['country'] as String?,
    latitude: (json['latitude'] as num).toDouble(),
    longitude: (json['longitude'] as num).toDouble(),
    timeZoneId: json['timeZoneId'] as String?,
    population: (json['population'] as num?)?.toInt() ?? 0,
    alternateNames:
        (json['alternateNames'] as List<dynamic>?)?.cast<String>() ?? const [],
  );

  static double _radians(double degrees) => degrees * math.pi / 180;
}
