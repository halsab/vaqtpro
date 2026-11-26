import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:material_ui/material_ui.dart' as m;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:shared_preferences_platform_interface/shared_preferences_async_platform_interface.dart';
import 'package:vaqtpro/design_system/design_system.dart';
import 'package:vaqtpro/features/location/models/geolocation_state.dart';
import 'package:vaqtpro/features/location/models/prayer_location.dart';
import 'package:vaqtpro/features/location/repositories/geolocation_repository.dart';
import 'package:vaqtpro/features/location/repositories/geonames_repository.dart';
import 'package:vaqtpro/features/location/repositories/location_repository.dart';
import 'package:vaqtpro/features/location/services/geonames_service.dart';
import 'package:vaqtpro/features/location/repositories/offline_place_catalog_repository.dart';
import 'package:vaqtpro/features/location/view_models/location_view_model.dart';
import 'package:vaqtpro/app/home_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'selected places, favorites, recents and permission history persist',
    () async {
      final previousPlatform = SharedPreferencesAsyncPlatform.instance;
      SharedPreferencesAsyncPlatform.instance = _InMemoryPreferences();
      addTearDown(
        () => SharedPreferencesAsyncPlatform.instance = previousPlatform,
      );
      final repository = PreferencesLocationRepository(
        SharedPreferencesAsync(),
      );
      final kazan = _place('1', 'Казань');
      final moscow = _place('2', 'Москва');
      final saved = SavedLocationState()
          .markLocationPermissionAsked()
          .select(kazan)
          .toggleFavorite(kazan)
          .select(moscow);

      await repository.save(saved);
      final loaded = await PreferencesLocationRepository(
        SharedPreferencesAsync(),
      ).load();

      expect(loaded.selected?.geonameId, '2');
      expect(loaded.favorites.single.geonameId, '1');
      expect(loaded.recents.map((place) => place.geonameId), ['2', '1']);
      expect(loaded.hasAskedLocationPermission, isTrue);
    },
  );

  test('offline GeoNames catalog contains Russian priority places', () async {
    final catalog = OfflinePlaceCatalogRepository(
      loadAsset: () =>
          rootBundle.loadString(OfflinePlaceCatalogRepository.assetPath),
    );
    final matches = await catalog.search('Казань');
    expect(matches.first.name, 'Казань');
    expect(matches.first.region, 'Республика Татарстан');
    expect(matches.first.timeZoneId, 'Europe/Moscow');
  });

  test(
    'GeoNames endpoints filter populated places and retain timezone',
    () async {
      final client = MockClient((request) async {
        expect(request.url.scheme, 'https');
        expect(request.url.host, 'secure.geonames.org');
        expect(request.url.queryParameters['username'], 'test-user');
        if (request.url.path.endsWith('/searchJSON')) {
          expect(request.url.queryParameters['featureClass'], 'P');
          expect(request.url.queryParameters['lang'], 'ru');
          return http.Response(
            '{"geonames":[{"geonameId":551487,"name":"Казань","toponymName":"Kazan","lat":"55.78874","lng":"49.12214","countryCode":"RU","countryName":"Россия","adminName1":"Республика Татарстан","timezone":{"timeZoneId":"Europe/Moscow"}}]}',
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }
        expect(request.url.path.endsWith('/findNearbyPlaceNameJSON'), isTrue);
        expect(request.url.queryParameters['radius'], '25');
        return http.Response(
          '{"geonames":[{"geonameId":551487,"name":"Казань","lat":"55.78874","lng":"49.12214","timezone":{"timeZoneId":"Europe/Moscow"}}]}',
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      });
      final service = HttpGeoNamesService(
        username: 'test-user',
        client: client,
      );

      final results = await service.search('Казань');
      final nearby = await service.reverseGeocode(55.79, 49.12);

      expect(results.single.geonameId, '551487');
      expect(results.single.alternateNames, ['Kazan']);
      expect(nearby?.timeZoneId, 'Europe/Moscow');
    },
  );

  test('offline reverse lookup uses only the 25 km radius', () async {
    final catalog = OfflinePlaceCatalogRepository(
      places: [_place('kazan', 'Казань')],
    );

    final nearby = await catalog.nearest(0.18, 0);
    final farAway = await catalog.nearest(0.23, 0);

    expect(nearby?.geonameId, 'kazan');
    expect(farAway, isNull);
  });

  test(
    'automatic location selects nearby place coordinates, otherwise raw',
    () async {
      final repo = _MemoryLocationRepository();
      final geo = _FakeGeolocation()
        ..coordinates = const DeviceCoordinates(0.18, 0);
      final viewModel = _viewModel(
        repository: repo,
        geolocation: geo,
        catalog: OfflinePlaceCatalogRepository(
          places: [_place('kazan', 'Казань')],
        ),
      );
      addTearDown(viewModel.dispose);
      await viewModel.initialize();

      await viewModel.determineLocation();
      expect(viewModel.selected?.geonameId, 'kazan');
      expect(viewModel.selected?.latitude, 0);
      expect(viewModel.selected?.longitude, 0);

      final rawViewModel = _viewModel(
        repository: _MemoryLocationRepository(),
        geolocation: _FakeGeolocation()
          ..coordinates = const DeviceCoordinates(0.23, 0),
        catalog: OfflinePlaceCatalogRepository(
          places: [_place('kazan', 'Казань')],
        ),
      );
      addTearDown(rawViewModel.dispose);
      await rawViewModel.initialize();
      await rawViewModel.determineLocation();
      expect(rawViewModel.selected?.geonameId, isNull);
      expect(rawViewModel.selected?.latitude, 0.23);
      expect(rawViewModel.selected?.displayName, '0.230, 0.000');
    },
  );

  test(
    'location detection replaces an already saved city after success',
    () async {
      final initial = _place('old', 'Старое место');
      final repository = _MemoryLocationRepository(
        SavedLocationState(selected: initial),
      );
      final viewModel = _viewModel(
        repository: repository,
        geolocation: _FakeGeolocation()
          ..coordinates = const DeviceCoordinates(0.18, 0),
        catalog: OfflinePlaceCatalogRepository(
          places: [_place('kazan', 'Казань')],
        ),
      );
      addTearDown(viewModel.dispose);
      await viewModel.initialize();

      expect(await viewModel.determineLocation(), isTrue);
      expect(viewModel.selected?.geonameId, 'kazan');
      expect(repository.state.selected?.geonameId, 'kazan');
    },
  );

  test(
    'location denial preserves the saved city and exposes its reason',
    () async {
      final initial = _place('saved', 'Сохранённое место');
      final viewModel = _viewModel(
        repository: _MemoryLocationRepository(
          SavedLocationState(selected: initial),
        ),
        geolocation: _FakeGeolocation()..permission = GeoPermissionState.denied,
      );
      addTearDown(viewModel.dispose);
      await viewModel.initialize();

      expect(await viewModel.determineLocation(), isFalse);
      expect(viewModel.selected?.geonameId, 'saved');
      expect(viewModel.permissionMessage, contains('Нет доступа'));
    },
  );

  test('failed geolocation save preserves the current city', () async {
    final initial = _place('saved', 'Сохранённое место');
    final repository = _MemoryLocationRepository(
      SavedLocationState(selected: initial),
    );
    final viewModel = _viewModel(
      repository: repository,
      geolocation: _FakeGeolocation()
        ..coordinates = const DeviceCoordinates(0.18, 0),
      catalog: OfflinePlaceCatalogRepository(
        places: [_place('kazan', 'Казань')],
      ),
    );
    addTearDown(viewModel.dispose);
    await viewModel.initialize();
    repository.rejectWrites = true;

    expect(await viewModel.determineLocation(), isFalse);
    expect(viewModel.selected?.geonameId, 'saved');
    expect(repository.state.selected?.geonameId, 'saved');
    expect(viewModel.storageMessage, contains('Не удалось сохранить'));
  });

  test('manual selection wins over a pending geolocation response', () async {
    final geo = _FakeGeolocation()
      ..pendingPermission = Completer<GeoPermissionState>();
    final repository = _MemoryLocationRepository();
    final viewModel = _viewModel(repository: repository, geolocation: geo);
    addTearDown(viewModel.dispose);
    await viewModel.initialize();

    final detection = viewModel.determineLocation();
    await Future<void>.delayed(Duration.zero);
    await viewModel.selectLocation(_place('manual', 'Выбранный вручную'));
    geo.pendingPermission!.complete(GeoPermissionState.granted);

    expect(await detection, isFalse);
    expect(viewModel.selected?.geonameId, 'manual');
    expect(repository.state.selected?.geonameId, 'manual');
  });

  test('permission timeout ends loading and ignores a late response', () async {
    final geo = _FakeGeolocation()
      ..pendingPermission = Completer<GeoPermissionState>();
    final viewModel = _viewModel(
      repository: _MemoryLocationRepository(),
      geolocation: geo,
      locationOperationTimeout: const Duration(milliseconds: 10),
    );
    addTearDown(viewModel.dispose);
    await viewModel.initialize();

    expect(await viewModel.determineLocation(), isFalse);
    expect(viewModel.isResolvingLocation, isFalse);
    expect(viewModel.permissionMessage, contains('запрос разрешения'));

    geo.pendingPermission!.complete(GeoPermissionState.granted);
    await Future<void>.delayed(Duration.zero);
    expect(viewModel.selected, isNull);
    expect(viewModel.isResolvingLocation, isFalse);
  });

  test(
    'coordinate timeout ends loading and reports the failing step',
    () async {
      final geo = _FakeGeolocation()
        ..pendingCoordinates = Completer<DeviceCoordinates>();
      final viewModel = _viewModel(
        repository: _MemoryLocationRepository(),
        geolocation: geo,
        locationOperationTimeout: const Duration(milliseconds: 10),
      );
      addTearDown(viewModel.dispose);
      await viewModel.initialize();

      expect(await viewModel.determineLocation(), isFalse);
      expect(viewModel.isResolvingLocation, isFalse);
      expect(viewModel.permissionMessage, contains('получение координат'));

      geo.pendingCoordinates!.complete(const DeviceCoordinates(51.5, -0.12));
      await Future<void>.delayed(Duration.zero);
      expect(viewModel.selected, isNull);
    },
  );

  test('closing picker cancels its pending location result', () async {
    final geo = _FakeGeolocation()
      ..pendingPermission = Completer<GeoPermissionState>();
    final viewModel = _viewModel(
      repository: _MemoryLocationRepository(),
      geolocation: geo,
    );
    addTearDown(viewModel.dispose);
    await viewModel.initialize();

    final detection = viewModel.determineLocation();
    await Future<void>.delayed(Duration.zero);
    expect(viewModel.isResolvingLocation, isTrue);
    viewModel.cancelLocationDetection();

    expect(viewModel.isResolvingLocation, isFalse);
    geo.pendingPermission!.complete(GeoPermissionState.granted);
    expect(await detection, isFalse);
    expect(viewModel.selected, isNull);
  });

  test('failed location write preserves persisted selection, favorites and recents', () async {
    final previousPlatform = SharedPreferencesAsyncPlatform.instance;
    final preferences = _InMemoryPreferences();
    SharedPreferencesAsyncPlatform.instance = preferences;
    addTearDown(
      () => SharedPreferencesAsyncPlatform.instance = previousPlatform,
    );

    final repository = PreferencesLocationRepository(SharedPreferencesAsync());
    final kazan = _place('1', 'Казань');
    final moscow = _place('2', 'Москва');
    final saved = SavedLocationState()
        .markLocationPermissionAsked()
        .select(kazan)
        .toggleFavorite(moscow);
    await repository.save(saved);

    final viewModel = _viewModel(repository: repository);
    addTearDown(viewModel.dispose);
    await viewModel.initialize();
    preferences.rejectWrites = true;

    await viewModel.selectLocation(moscow);

    expect(viewModel.selected?.geonameId, '1');
    expect(viewModel.favorites.single.geonameId, '2');
    expect(viewModel.recents.map((place) => place.geonameId), ['1']);
    expect(viewModel.storageMessage, isNotNull);

    final reloaded = await PreferencesLocationRepository(
      SharedPreferencesAsync(),
    ).load();
    expect(reloaded.selected?.geonameId, '1');
    expect(reloaded.favorites.single.geonameId, '2');
    expect(reloaded.recents.map((place) => place.geonameId), ['1']);
    expect(reloaded.hasAskedLocationPermission, isTrue);
  });

  test(
    'overlapping selection and favorite writes preserve both changes',
    () async {
      final repository = _MemoryLocationRepository();
      final viewModel = _viewModel(repository: repository);
      addTearDown(viewModel.dispose);
      await viewModel.initialize();
      final kazan = _place('1', 'Казань');

      await Future.wait([
        viewModel.selectLocation(kazan),
        viewModel.toggleFavorite(kazan),
      ]);

      expect(viewModel.selected?.geonameId, '1');
      expect(viewModel.favorites.single.geonameId, '1');
      expect(repository.state.selected?.geonameId, '1');
      expect(repository.state.favorites.single.geonameId, '1');
    },
  );

  test(
    'first permission check does not mistake prompt state for a denial',
    () async {
      final geo = _FakeGeolocation()..permission = GeoPermissionState.denied;
      final repository = _MemoryLocationRepository();
      final viewModel = _viewModel(repository: repository, geolocation: geo);
      addTearDown(viewModel.dispose);

      await viewModel.initialize();
      expect(viewModel.manualSelectionIsPrimary, isFalse);
      expect(geo.requestCount, 0);

      await viewModel.determineLocation();
      expect(viewModel.manualSelectionIsPrimary, isTrue);
      expect(geo.requestCount, 1);
      expect(repository.state.hasAskedLocationPermission, isTrue);
    },
  );

  test(
    'timezone difference includes half-hour offsets and hides equal offsets',
    () async {
      final viewModel = _viewModel(
        repository: _MemoryLocationRepository(
          SavedLocationState(
            selected: PrayerLocation(
              latitude: 28.6,
              longitude: 77.2,
              timeZoneId: 'Asia/Kolkata',
            ),
          ),
        ),
      );
      addTearDown(viewModel.dispose);
      await viewModel.initialize();

      expect(
        viewModel.timezoneDifferenceLabel(
          now: DateTime.utc(2026, 1, 1),
          deviceOffset: Duration.zero,
        ),
        '+5:30',
      );
      expect(
        viewModel.timezoneDifferenceLabel(
          now: DateTime.utc(2026, 1, 1),
          deviceOffset: const Duration(hours: 5, minutes: 30),
        ),
        isNull,
      );
    },
  );

  test('online and local search results merge without duplicate IDs', () async {
    final online = _FakeGeoNames()
      ..configured = true
      ..results = [_place('1', 'Казань'), _place('2', 'Казань Новая')];
    final viewModel = _viewModel(
      repository: _MemoryLocationRepository(
        SavedLocationState(selected: _place('9', 'Дом')),
      ),
      catalog: OfflinePlaceCatalogRepository(places: [_place('1', 'Казань')]),
      geonames: online,
    );
    addTearDown(viewModel.dispose);
    await viewModel.initialize();

    await viewModel.search('Казань');
    await Future<void>.delayed(const Duration(milliseconds: 350));

    expect(viewModel.searchResults.map((place) => place.geonameId).toSet(), {
      '1',
      '2',
    });
    expect(viewModel.isOnlineSearchPending, isFalse);
  });

  test(
    'a slow response for an old query cannot replace current results',
    () async {
      final online = _FakeGeoNames()
        ..configured = true
        ..pending['Казань'] = Completer<List<PrayerLocation>>()
        ..pending['Москва'] = Completer<List<PrayerLocation>>();
      final viewModel = _viewModel(
        repository: _MemoryLocationRepository(),
        catalog: OfflinePlaceCatalogRepository(places: const []),
        geonames: online,
      );
      addTearDown(viewModel.dispose);
      await viewModel.initialize();

      await viewModel.search('Казань');
      await Future<void>.delayed(const Duration(milliseconds: 300));
      await viewModel.search('Москва');
      await Future<void>.delayed(const Duration(milliseconds: 300));
      online.pending['Казань']!.complete([_place('1', 'Казань')]);
      await Future<void>.delayed(Duration.zero);
      expect(viewModel.searchResults, isEmpty);

      online.pending['Москва']!.complete([_place('2', 'Москва')]);
      await Future<void>.delayed(Duration.zero);
      expect(viewModel.searchResults.single.geonameId, '2');
    },
  );

  testWidgets('first run offers automatic and manual location actions', (
    tester,
  ) async {
    final viewModel = _viewModel(
      repository: _MemoryLocationRepository(),
      geolocation: _FakeGeolocation()..permission = GeoPermissionState.unknown,
    );
    await tester.pumpWidget(
      AppRoot(
        title: 'Vaqtpro',
        home: HomeScreen(viewModel: viewModel),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Определить местоположение'), findsOneWidget);
    expect(find.text('Выбрать вручную'), findsOneWidget);
    expect(
      tester.widget<m.FilledButton>(
        find.ancestor(
          of: find.text('Определить местоположение'),
          matching: find.byType(m.FilledButton),
        ),
      ),
      isNotNull,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('selected location button stays left-aligned in the app bar', (
    tester,
  ) async {
    final viewModel = _viewModel(
      repository: _MemoryLocationRepository(
        SavedLocationState(selected: _place('551487', 'Казань')),
      ),
    );
    await tester.pumpWidget(
      AppRoot(
        title: 'Vaqtpro',
        home: HomeScreen(viewModel: viewModel),
      ),
    );
    await tester.pumpAndSettle();

    expect(tester.widget<m.AppBar>(find.byType(m.AppBar)).centerTitle, isFalse);
    final locationButton = find.ancestor(
      of: find.text('Казань'),
      matching: find.byType(m.FilledButton),
    );
    expect(locationButton, findsOneWidget);
    expect(
      tester.getTopLeft(locationButton).dx,
      lessThan(tester.getSize(find.byType(m.AppBar)).width / 2),
    );
  });

  testWidgets(
    'permanent denial promotes manual selection and explains settings',
    (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.android;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);
      final viewModel = _viewModel(
        repository: _MemoryLocationRepository(),
        geolocation: _FakeGeolocation()
          ..permission = GeoPermissionState.permanentlyDenied,
      );
      await tester.pumpWidget(
        AppRoot(
          title: 'Vaqtpro',
          home: HomeScreen(viewModel: viewModel),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Выбрать вручную'), findsOneWidget);
      await tester.tap(find.text('Определить местоположение'));
      await tester.pumpAndSettle();
      expect(
        find.textContaining('Доступ к геолокации запрещён'),
        findsOneWidget,
      );
      expect(find.text('Открыть настройки приложения'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('manual search can favorite and select an offline place', (
    tester,
  ) async {
    final viewModel = _viewModel(
      repository: _MemoryLocationRepository(),
      catalog: OfflinePlaceCatalogRepository(
        places: [_place('551487', 'Казань')],
      ),
    );
    await tester.pumpWidget(
      AppRoot(
        title: 'Vaqtpro',
        home: HomeScreen(viewModel: viewModel),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Выбрать вручную'));
    await tester.pumpAndSettle();
    expect(find.text('Выбрать местоположение'), findsOneWidget);
    expect(find.byType(m.TextField), findsOneWidget);

    await tester.enterText(find.byType(m.TextField), 'Казань');
    await tester.pumpAndSettle();
    expect(viewModel.searchQuery, 'Казань');
    expect(viewModel.searchResults.single.name, 'Казань');
    expect(find.byType(m.ListTile), findsOneWidget);

    await tester.tap(find.byTooltip('Добавить в избранное'));
    await tester.pumpAndSettle();
    expect(viewModel.favorites.single.name, 'Казань');
    expect(viewModel.selected, isNull);

    await tester.tap(find.byType(m.ListTile).first);
    await tester.pumpAndSettle();
    expect(viewModel.selected?.geonameId, '551487');
    expect(find.text('Выбрать местоположение'), findsNothing);
    expect(find.text('—'), findsNWidgets(7));
    expect(tester.takeException(), isNull);
  });

  testWidgets('location denial reason stays visible in the picker', (
    tester,
  ) async {
    final viewModel = _viewModel(
      repository: _MemoryLocationRepository(),
      geolocation: _FakeGeolocation()..permission = GeoPermissionState.denied,
    );
    await tester.pumpWidget(
      AppRoot(
        title: 'Vaqtpro',
        home: HomeScreen(viewModel: viewModel),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Выбрать вручную'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Определить местоположение'));
    await tester.pumpAndSettle();

    expect(
      find.textContaining('Нет доступа к геолокации').last,
      findsOneWidget,
    );
    expect(find.byType(m.TextField), findsOneWidget);
    expect(find.byTooltip('Определить местоположение'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

PrayerLocation _place(String id, String name) => PrayerLocation(
  geonameId: id,
  name: name,
  region: 'Республика Татарстан',
  countryCode: 'RU',
  country: 'Россия',
  latitude: 0,
  longitude: 0,
  timeZoneId: 'Europe/Moscow',
);

LocationViewModel _viewModel({
  required LocationRepository repository,
  GeolocationRepository? geolocation,
  OfflinePlaceCatalogRepository? catalog,
  GeoNamesRepository? geonames,
  Duration locationOperationTimeout = const Duration(seconds: 35),
}) => LocationViewModel(
  repository: repository,
  geolocation: geolocation ?? _FakeGeolocation(),
  catalog: catalog ?? OfflinePlaceCatalogRepository(places: const []),
  geonames: geonames ?? _FakeGeoNames(),
  locationOperationTimeout: locationOperationTimeout,
);

class _MemoryLocationRepository implements LocationRepository {
  _MemoryLocationRepository([this.state = const SavedLocationState()]);

  SavedLocationState state;
  bool rejectWrites = false;

  @override
  Future<SavedLocationState> load() async => state;

  @override
  Future<void> save(SavedLocationState value) async {
    if (rejectWrites) throw StateError('storage unavailable');
    state = value;
  }
}

class _FakeGeolocation implements GeolocationRepository {
  GeoPermissionState permission = GeoPermissionState.granted;
  DeviceCoordinates coordinates = const DeviceCoordinates(0.18, 0);
  int requestCount = 0;
  Completer<GeoPermissionState>? pendingPermission;
  Completer<DeviceCoordinates>? pendingCoordinates;

  @override
  bool get supportsSettingsNavigation => true;

  @override
  Future<GeoPermissionState> checkPermission() async => permission;

  @override
  Future<DeviceCoordinates> currentCoordinates() =>
      pendingCoordinates?.future ?? Future.value(coordinates);

  @override
  Future<bool> openApplicationSettings() async => true;

  @override
  Future<bool> openLocationSettings() async => true;

  @override
  Future<GeoPermissionState> requestPermission() async {
    requestCount++;
    if (pendingPermission case final pending?) return pending.future;
    return permission;
  }
}

class _FakeGeoNames implements GeoNamesRepository {
  bool configured = false;
  List<PrayerLocation> results = const [];
  final Map<String, Completer<List<PrayerLocation>>> pending = {};

  @override
  bool get isConfigured => configured;

  @override
  Future<PrayerLocation?> reverseGeocode(
    double latitude,
    double longitude,
  ) async => null;

  @override
  Future<List<PrayerLocation>> search(String query) =>
      pending[query]?.future ?? Future.value(results);
}

final class _InMemoryPreferences extends SharedPreferencesAsyncPlatform {
  final Map<String, String> _values = {};
  bool rejectWrites = false;

  @override
  Future<String?> getString(
    String key,
    SharedPreferencesOptions options,
  ) async => _values[key];

  @override
  Future<void> setString(
    String key,
    String value,
    SharedPreferencesOptions options,
  ) async {
    if (rejectWrites) throw StateError('storage unavailable');
    _values[key] = value;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
