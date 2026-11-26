import 'package:flutter/widgets.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:material_ui/material_ui.dart' as m;
import 'package:shared_preferences/shared_preferences.dart';

import '../design_system/design_system.dart';
import 'home_screen.dart';
import '../features/location/repositories/location_repository.dart';
import '../features/location/repositories/geolocation_repository.dart';
import '../features/location/repositories/geonames_repository.dart';
import '../features/location/repositories/offline_place_catalog_repository.dart';
import '../features/location/services/geolocation_service.dart';
import '../features/location/services/geonames_service.dart';
import '../features/location/view_models/location_view_model.dart';

class App extends StatelessWidget {
  App({super.key})
    : _locationViewModel = LocationViewModel(
        repository: PreferencesLocationRepository(SharedPreferencesAsync()),
        geolocation: PlatformGeolocationRepository(
          PlatformGeolocationService(),
        ),
        catalog: OfflinePlaceCatalogRepository(
          loadAsset: () =>
              rootBundle.loadString(OfflinePlaceCatalogRepository.assetPath),
        ),
        geonames: ServiceGeoNamesRepository(
          HttpGeoNamesService(
            username: const String.fromEnvironment(
              'GEONAMES_USERNAME',
              defaultValue: 'vaqtpro',
            ),
          ),
        ),
      );

  final LocationViewModel _locationViewModel;

  @override
  Widget build(BuildContext context) => AppRoot(
    title: 'Vaqtpro',
    locale: Locale('ru'),
    supportedLocales: [Locale('ru')],
    localizationsDelegates: m.GlobalMaterialLocalizations.delegates,
    home: HomeScreen(viewModel: _locationViewModel),
  );
}
