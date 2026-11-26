import 'dart:convert';

import '../models/prayer_location.dart';

class OfflinePlaceCatalogRepository {
  OfflinePlaceCatalogRepository({
    Future<String> Function()? loadAsset,
    List<PrayerLocation>? places,
  }) : _loadAsset = loadAsset {
    if (places == null && loadAsset == null) {
      throw ArgumentError('Provide an asset loader or in-memory places.');
    }
    if (places != null) {
      _entries = places
          .map((place) => _CatalogEntry(place, [_normalize(place.displayName)]))
          .toList(growable: false);
      _loading = Future<void>.value();
    }
  }

  static const assetPath = 'assets/geonames/places.json';

  final Future<String> Function()? _loadAsset;
  Future<void>? _loading;
  List<_CatalogEntry> _entries = const [];

  Future<void> load() => _loading ??= _readCatalog();

  Future<void> _readCatalog() async {
    final text = await _loadAsset!();
    final data = jsonDecode(text) as Map<String, dynamic>;
    final countries = Map<String, String>.from(data['countries'] as Map);
    final regions = Map<String, String>.from(data['regions'] as Map);

    _entries = (data['places'] as List<dynamic>)
        .map((value) {
          final row = value as List<dynamic>;
          final countryCode = row[5] as String;
          final adminCode = row[6] as String;
          final aliases = (row[2] as List<dynamic>).cast<String>();
          final location = PrayerLocation(
            geonameId: row[0] as String,
            name: row[1] as String,
            latitude: (row[3] as num).toDouble(),
            longitude: (row[4] as num).toDouble(),
            countryCode: countryCode,
            country: countryCode == 'RU'
                ? 'Россия'
                : countries[countryCode] ?? countryCode,
            region: regions['$countryCode.$adminCode'],
            timeZoneId: (row[7] as String).isEmpty ? null : row[7] as String,
            population: (row[8] as num).toInt(),
            alternateNames: aliases,
          );
          final terms = {
            _normalize(location.name!),
            _normalize(row[1] as String),
            ...aliases.map(_normalize),
          }.where((term) => term.isNotEmpty).toList();
          return _CatalogEntry(location, terms);
        })
        .toList(growable: false);
  }

  Future<List<PrayerLocation>> search(
    String query, {
    PrayerLocation? origin,
    int limit = 20,
  }) async {
    await load();
    final normalized = _normalize(query);
    if (normalized.isEmpty) return const [];

    final matches = <({int rank, double distance, PrayerLocation place})>[];
    for (final entry in _entries) {
      var rank = 3;
      for (final term in entry.searchTerms) {
        if (term == normalized) {
          rank = 0;
          break;
        }
        if (term.startsWith(normalized)) {
          rank = rank > 1 ? 1 : rank;
        } else if (term.contains(normalized)) {
          rank = rank > 2 ? 2 : rank;
        }
      }
      if (rank == 3) continue;
      matches.add((
        rank: rank,
        distance: origin == null
            ? double.infinity
            : entry.place.distanceTo(origin.latitude, origin.longitude),
        place: entry.place,
      ));
    }
    matches.sort((left, right) {
      final byRelevance = left.rank.compareTo(right.rank);
      if (byRelevance != 0) return byRelevance;
      final byDistance = left.distance.compareTo(right.distance);
      if (byDistance != 0) return byDistance;
      final byPopulation = right.place.population.compareTo(
        left.place.population,
      );
      if (byPopulation != 0) return byPopulation;
      return left.place.displayName.compareTo(right.place.displayName);
    });
    return matches.take(limit).map((match) => match.place).toList();
  }

  Future<PrayerLocation?> nearest(
    double latitude,
    double longitude, {
    double maxDistanceKm = 25,
  }) async {
    await load();
    PrayerLocation? nearestPlace;
    var nearestDistance = maxDistanceKm;
    for (final entry in _entries) {
      final distance = entry.place.distanceTo(latitude, longitude);
      if (distance < nearestDistance ||
          (distance == nearestDistance &&
              entry.place.population > (nearestPlace?.population ?? -1))) {
        nearestDistance = distance;
        nearestPlace = entry.place;
      }
    }
    return nearestPlace;
  }
}

class _CatalogEntry {
  const _CatalogEntry(this.place, this.searchTerms);

  final PrayerLocation place;
  final List<String> searchTerms;
}

String _normalize(String value) => value
    .trim()
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replaceAll(_whitespace, ' ');

final _whitespace = RegExp(r'\s+');
