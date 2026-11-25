import 'package:flutter/widgets.dart';
import 'package:material_ui/material_ui.dart' as m;

import 'tokens.dart';

class AppRoot extends StatelessWidget {
  const AppRoot({
    super.key,
    required this.title,
    required this.home,
    this.locale,
    this.supportedLocales = const [Locale('en')],
    this.localizationsDelegates,
  });

  final String title;
  final Widget home;
  final Locale? locale;
  final Iterable<Locale> supportedLocales;
  final Iterable<LocalizationsDelegate<dynamic>>? localizationsDelegates;

  @override
  Widget build(BuildContext context) => m.MaterialApp(
    title: title,
    debugShowCheckedModeBanner: false,
    themeMode: m.ThemeMode.system,
    theme: m.ThemeData(
      colorScheme: m.ColorScheme.fromSeed(seedColor: AppTokens.materialSeed),
      useMaterial3: true,
    ),
    darkTheme: m.ThemeData(
      colorScheme: m.ColorScheme.fromSeed(
        seedColor: AppTokens.materialSeed,
        brightness: Brightness.dark,
      ),
      useMaterial3: true,
    ),
    home: home,
    locale: locale,
    supportedLocales: supportedLocales,
    localizationsDelegates: localizationsDelegates,
  );
}
