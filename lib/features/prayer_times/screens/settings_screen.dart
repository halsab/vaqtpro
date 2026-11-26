import 'package:flutter/widgets.dart';
import 'package:material_ui/material_ui.dart' as m;

import '../../../design_system/components.dart';
import '../../../design_system/tokens.dart';
import '../models/calculation_profile.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({
    super.key,
    required this.countryCode,
    required this.regionCode,
  });

  final String? countryCode;
  final String? regionCode;

  @override
  Widget build(BuildContext context) {
    final profile = profileForRegion(countryCode, regionCode);
    return AppPage(
      title: 'Настройки',
      child: ListView(
        padding: AppTokens.pagePadding,
        children: [
          m.ListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Профиль расчёта'),
            subtitle: Text(regionalPrayerProfileLabel(profile)),
          ),
        ],
      ),
    );
  }
}
