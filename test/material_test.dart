import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart' as m;
import 'package:vaqtpro/design_system/design_system.dart';
import 'package:vaqtpro/app/home_screen.dart';
import 'package:vaqtpro/features/location/models/prayer_location.dart';
import 'package:vaqtpro/features/location/models/geolocation_state.dart';
import 'package:vaqtpro/features/location/repositories/geolocation_repository.dart';
import 'package:vaqtpro/features/location/repositories/geonames_repository.dart';
import 'package:vaqtpro/features/location/repositories/location_repository.dart';
import 'package:vaqtpro/features/location/repositories/offline_place_catalog_repository.dart';
import 'package:vaqtpro/features/location/view_models/location_view_model.dart';
import 'package:vaqtpro/features/prayer_times/widgets/prayer_times_card.dart';

void main() {
  testWidgets(
    'internal notifications suppress duplicates and expire after four seconds',
    (tester) async {
      late BuildContext context;
      await tester.pumpWidget(
        AppRoot(
          title: 'Notification',
          home: Builder(
            builder: (value) {
              context = value;
              return const Text('Home');
            },
          ),
        ),
      );
      InternalNotification.show(context, 'Saved');
      await tester.pump(const Duration(milliseconds: 240));
      InternalNotification.show(context, 'Saved');
      expect(find.text('Saved'), findsOneWidget);

      await tester.pump(const Duration(milliseconds: 3999));
      expect(find.text('Saved'), findsOneWidget);
      await tester.pump(const Duration(milliseconds: 1));
      await tester.pump(const Duration(milliseconds: 201));
      expect(find.text('Saved'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('internal notifications fill width and follow both themes', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(400, 800);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final dispatcher = tester.binding.platformDispatcher;
    addTearDown(dispatcher.clearPlatformBrightnessTestValue);
    late BuildContext context;

    for (final brightness in [Brightness.light, Brightness.dark]) {
      dispatcher.platformBrightnessTestValue = brightness;
      await tester.pumpWidget(
        AppRoot(
          title: 'Notification',
          home: Builder(
            builder: (value) {
              context = value;
              return const Text('Home');
            },
          ),
        ),
      );
      final shortMessage = 'Saved';
      InternalNotification.show(context, shortMessage);
      await tester.pump(const Duration(milliseconds: 240));

      final shortSurface = find.byKey(
        const ValueKey('internal-notification-surface'),
      );
      expect(tester.getSize(shortSurface).width, 368);
      final scheme = m.Theme.of(context).colorScheme;
      expect(tester.widget<m.Material>(shortSurface).color, scheme.surfaceContainerLow);
      expect(tester.widget<Text>(find.text(shortMessage)).style?.color, scheme.onSurface);

      final longMessage = List.filled(12, 'A much longer notification').join(' ');
      InternalNotification.show(context, longMessage);
      await tester.pump(const Duration(milliseconds: 240));
      final longSurface = find.byKey(
        const ValueKey('internal-notification-surface'),
      );
      expect(tester.getSize(longSurface).width, 368);
      expect(tester.getSize(longSurface).height, greaterThan(48));
      expect(
        tester.widget<m.Material>(longSurface).color,
        m.Theme.of(context).colorScheme.surfaceContainerLow,
      );
      expect(
        tester.widget<Text>(find.text(longMessage)).style?.color,
        m.Theme.of(context).colorScheme.onSurface,
      );
    }

    await tester.pumpWidget(const SizedBox());
    expect(tester.takeException(), isNull);
  });

  testWidgets('filled location icon button keeps its shape while loading', (
    tester,
  ) async {
    await tester.pumpWidget(
      AppRoot(
        title: 'Harness',
        home: const AppIconButton(
          tooltip: 'Определить местоположение',
          icon: m.Icon(m.Icons.my_location),
          onPressed: null,
          isLoading: true,
        ),
      ),
    );
    await tester.pump();

    final iconButton = tester.widget<m.IconButton>(find.byType(m.IconButton));
    final buttonStyle = iconButton.style!;
    final colors = m.Theme.of(tester.element(find.byType(m.IconButton)))
        .colorScheme;
    expect(iconButton.onPressed, isNull);
    expect(buttonStyle.shape!.resolve({}), isA<m.CircleBorder>());
    expect(
      buttonStyle.backgroundColor!.resolve({m.WidgetState.disabled}),
      colors.primary,
    );
    expect(
      buttonStyle.foregroundColor!.resolve({m.WidgetState.disabled}),
      colors.onPrimary,
    );
    expect(
      tester.getSize(find.byType(m.CircularProgressIndicator)),
      const Size(24, 24),
    );
    expect(tester.takeException(), isNull);
  });

  for (final platform in [TargetPlatform.android, TargetPlatform.iOS]) {
    testWidgets('Material controls and confirmation on $platform', (
      tester,
    ) async {
      debugDefaultTargetPlatformOverride = platform;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);
      bool? result;
      await tester.pumpWidget(
        AppRoot(
          title: 'Harness',
          home: AppPage(
            title: 'Tasks',
            child: Builder(
              builder: (context) => Column(
                children: [
                  const AppTextField(label: 'Task'),
                  AppButton(
                    label: 'Confirm',
                    onPressed: () async {
                      result = await confirmAction(
                        context,
                        title: 'Delete?',
                        message: 'Confirm deletion',
                        cancelLabel: 'Cancel',
                        confirmLabel: 'Delete',
                        destructive: true,
                      );
                    },
                  ),
                  AppSwitch(value: false, onChanged: (_) {}),
                ],
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(m.MaterialApp), findsOneWidget);
      expect(find.byType(m.TextField), findsOneWidget);
      expect(find.byType(m.Switch), findsOneWidget);
      await tester.tap(find.text('Confirm'));
      await tester.pumpAndSettle();
      expect(find.byType(m.AlertDialog), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(result, false);
      expect(tester.takeException(), isNull);
    });
  }
  for (final platform in [TargetPlatform.android, TargetPlatform.iOS]) {
    testWidgets('system light/dark semantic colors on $platform', (
      tester,
    ) async {
      debugDefaultTargetPlatformOverride = platform;
      final dispatcher = tester.binding.platformDispatcher;
      dispatcher.platformBrightnessTestValue = Brightness.light;
      addTearDown(() {
        dispatcher.clearPlatformBrightnessTestValue();
        debugDefaultTargetPlatformOverride = null;
      });
      const seed = Color(0xFF2563EB);
      expect(AppTokens.materialSeed, seed);
      late BuildContext probe;
      await tester.pumpWidget(
        AppRoot(
          title: 'Theme test',
          home: AppPage(
            title: 'Theme test',
            child: Builder(
              builder: (context) {
                probe = context;
                // Resolve theme roles in build, so the probe subscribes.
                return Text(
                  'Theme probe',
                  style: AppTextStyles.body(context).copyWith(
                    color: AppColors.text(context),
                    backgroundColor: AppColors.background(context),
                  ),
                );
              },
            ),
          ),
        ),
      );
      List<Color> colors(BuildContext context) => [
        AppColors.primary(context),
        AppColors.background(context),
        AppColors.surface(context),
        AppColors.text(context),
        AppColors.muted(context),
        AppColors.error(context),
        AppColors.divider(context),
      ];
      List<Color> expected(BuildContext context, Brightness brightness) {
        final scheme = m.ColorScheme.fromSeed(
          seedColor: seed,
          brightness: brightness,
        );
        expect(m.Theme.of(context).brightness, brightness);
        return [
          scheme.primary,
          scheme.surface,
          scheme.surfaceContainerLow,
          scheme.onSurface,
          scheme.onSurfaceVariant,
          scheme.error,
          scheme.outlineVariant,
        ];
      }

      await tester.pumpAndSettle();
      final light = colors(probe);
      expect(light, expected(probe, Brightness.light));
      expect(
        m.Theme.of(probe).textTheme.bodyMedium?.fontFamily,
        AppTokens.fontFamily,
      );
      expect(
        m.Theme.of(probe).textTheme.titleLarge?.fontFamily,
        AppTokens.fontFamily,
      );
      final lightText = tester.widget<Text>(find.text('Theme probe'));
      expect(lightText.style?.color, light[3]);
      dispatcher.platformBrightnessTestValue = Brightness.dark;
      await tester.pumpAndSettle();
      final dark = colors(probe);
      expect(
        m.Theme.of(probe).textTheme.bodyMedium?.fontFamily,
        AppTokens.fontFamily,
      );
      expect(dark, expected(probe, Brightness.dark));
      // Accent, background and readable foreground must actually change.
      for (final index in [0, 1, 3]) {
        expect(dark[index], isNot(light[index]));
      }
      final darkText = tester.widget<Text>(find.text('Theme probe'));
      expect(darkText.style?.color, dark[3]);
      expect(darkText.style?.backgroundColor, dark[1]);
      dispatcher.platformBrightnessTestValue = Brightness.light;
      await tester.pumpAndSettle();
      expect(colors(probe), light);
      expect(tester.takeException(), isNull);
    });
  }
  test('window classes use exact shared thresholds', () {
    expect(AppWindowClass.fromWidth(599), AppWindowClass.compact);
    expect(AppWindowClass.fromWidth(600), AppWindowClass.medium);
    expect(AppWindowClass.fromWidth(839), AppWindowClass.medium);
    expect(AppWindowClass.fromWidth(840), AppWindowClass.expanded);
  });

  testWidgets('prayer times show seven ordered rows without table headings', (
    tester,
  ) async {
    await tester.pumpWidget(
      AppRoot(
        title: 'Vaqtpro',
        home: HomeScreen(viewModel: _selectedLocationViewModel()),
      ),
    );
    await tester.pumpAndSettle();

    const names = ['Фаджр', 'Шурук', 'Истива', 'Зухр', 'Аср', 'Магриб', 'Иша'];
    expect(find.byType(PrayerTimesCard), findsOneWidget);
    final namePositions = [
      for (final name in names) tester.getTopLeft(find.text(name)).dy,
    ];
    expect(namePositions, orderedEquals(namePositions.toList()..sort()));
    expect(find.text('—'), findsNWidgets(7));
    expect(find.text('Название'), findsNothing);
    expect(find.text('Время'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('prayer times remain readable across window widths', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      AppRoot(
        title: 'Vaqtpro',
        home: HomeScreen(viewModel: _selectedLocationViewModel()),
      ),
    );
    await tester.pumpAndSettle();

    for (final size in [
      const Size(360, 800),
      const Size(768, 1024),
      const Size(1440, 900),
      const Size(320, 600),
    ]) {
      tester.view.physicalSize = size;
      await tester.pumpAndSettle();
      for (final name in [
        'Фаджр',
        'Шурук',
        'Истива',
        'Зухр',
        'Аср',
        'Магриб',
        'Иша',
      ]) {
        expect(find.text(name), findsOneWidget);
      }
      expect(find.text('—'), findsNWidgets(7));
      expect(tester.takeException(), isNull);
    }
  });

  testWidgets('adaptive layout follows resize and retains shared state', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final selected = ValueNotifier<int>(0);
    addTearDown(selected.dispose);
    tester.view.physicalSize = const Size(360, 800);
    await tester.pumpWidget(
      AppRoot(
        title: 'Adaptive',
        home: m.Scaffold(
          body: AppAdaptiveLayout(
            builder: (context, windowClass, constraints) =>
                ValueListenableBuilder<int>(
                  valueListenable: selected,
                  builder: (context, value, child) {
                    final detail = Text('Selected: $value');
                    final action = m.FilledButton(
                      onPressed: () => selected.value = 1,
                      child: const Text('Select'),
                    );
                    return Column(
                      children: [
                        Text(windowClass.name),
                        if (windowClass == AppWindowClass.expanded)
                          Row(children: [action, detail])
                        else ...[
                          action,
                          detail,
                        ],
                      ],
                    );
                  },
                ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Select'));
    await tester.pumpAndSettle();
    for (final size in [
      const Size(360, 800),
      const Size(768, 1024),
      const Size(1440, 900),
      const Size(360, 800),
    ]) {
      tester.view.physicalSize = size;
      await tester.pumpAndSettle();
      expect(
        find.text(AppWindowClass.fromWidth(size.width).name),
        findsOneWidget,
      );
      expect(find.text('Selected: 1'), findsOneWidget);
      expect(find.text('Select'), findsOneWidget);
      expect(tester.takeException(), isNull);
    }
  });
}

LocationViewModel _selectedLocationViewModel() => LocationViewModel(
  repository: _MemoryLocationRepository(
    SavedLocationState(
      selected: const PrayerLocation(
        geonameId: '551487',
        name: 'Казань',
        country: 'Россия',
        region: 'Республика Татарстан',
        latitude: 55.78874,
        longitude: 49.12214,
        timeZoneId: 'Europe/Moscow',
      ),
    ),
  ),
  geolocation: _FakeGeolocation(),
  catalog: OfflinePlaceCatalogRepository(places: const []),
  geonames: _FakeGeoNames(),
);

class _MemoryLocationRepository implements LocationRepository {
  _MemoryLocationRepository(this.state);

  SavedLocationState state;

  @override
  Future<SavedLocationState> load() async => state;

  @override
  Future<void> save(SavedLocationState value) async => state = value;
}

class _FakeGeolocation implements GeolocationRepository {
  @override
  bool get supportsSettingsNavigation => true;

  @override
  Future<GeoPermissionState> checkPermission() async =>
      GeoPermissionState.granted;

  @override
  Future<DeviceCoordinates> currentCoordinates() async =>
      const DeviceCoordinates(55.78874, 49.12214);

  @override
  Future<bool> openApplicationSettings() async => true;

  @override
  Future<bool> openLocationSettings() async => true;

  @override
  Future<GeoPermissionState> requestPermission() async =>
      GeoPermissionState.granted;
}

class _FakeGeoNames implements GeoNamesRepository {
  @override
  bool get isConfigured => false;

  @override
  Future<PrayerLocation?> reverseGeocode(
    double latitude,
    double longitude,
  ) async => null;

  @override
  Future<List<PrayerLocation>> search(String query) async => const [];
}
