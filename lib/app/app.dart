import 'package:flutter/widgets.dart';
import 'package:material_ui/material_ui.dart' as m;

import '../design_system/design_system.dart';
import '../features/prayer_times/screens/prayer_times_screen.dart';

class App extends StatelessWidget {
  const App({super.key});

  @override
  Widget build(BuildContext context) => const AppRoot(
    title: 'Vaqtpro',
    locale: Locale('ru'),
    supportedLocales: [Locale('ru')],
    localizationsDelegates: m.GlobalMaterialLocalizations.delegates,
    home: PrayerTimesScreen(),
  );
}
