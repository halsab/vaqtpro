import 'package:flutter/widgets.dart';
import 'package:material_ui/material_ui.dart' as m;

import '../../../design_system/components.dart';
import '../../../design_system/tokens.dart';
import '../models/calculation_profile.dart';
import '../view_models/calculation_profile_view_model.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({
    super.key,
    required this.viewModel,
    required this.locationKey,
    required this.countryCode,
    required this.regionCode,
  });

  final CalculationProfileViewModel viewModel;
  final String? locationKey;
  final String? countryCode;
  final String? regionCode;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: viewModel,
    builder: (context, _) {
      final selection = locationKey == null
          ? CalculationProfileSelection.byLocation
          : viewModel.selectionFor(locationKey!);
      final automaticProfile = regionalPrayerProfileLabel(
        profileForRegion(countryCode, regionCode),
      );
      return AppPage(
        title: 'Настройки',
        child: Padding(
          padding: AppTokens.pagePadding,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              m.ListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Профиль расчёта'),
                subtitle: Text(
                  calculationProfileSelectionLabel(
                    selection,
                    automaticProfileLabel: automaticProfile,
                  ),
                ),
                trailing: locationKey == null
                    ? null
                    : const m.Icon(m.Icons.chevron_right),
                onTap: locationKey == null || viewModel.isLoading
                    ? null
                    : () => _chooseProfile(context, selection),
              ),
              if (locationKey == null)
                const Align(
                  alignment: Alignment.centerLeft,
                  child: Text('Сначала выберите место'),
                ),
            ],
          ),
        ),
      );
    },
  );

  Future<void> _chooseProfile(
    BuildContext context,
    CalculationProfileSelection selected,
  ) async {
    final choices = CalculationProfileSelection.values;
    final choice = await m.showModalBottomSheet<CalculationProfileSelection>(
      context: context,
      useSafeArea: true,
      builder: (sheetContext) => ListView(
        shrinkWrap: true,
        padding: AppTokens.pagePadding,
        children: [
          Padding(
            padding: const EdgeInsets.only(bottom: AppTokens.space8),
            child: Text(
              'Профиль расчёта',
              style: m.Theme.of(sheetContext).textTheme.titleLarge,
            ),
          ),
          for (final item in choices)
            m.ListTile(
              title: Text(
                calculationProfileSelectionLabel(
                  item,
                  automaticProfileLabel: regionalPrayerProfileLabel(
                    profileForRegion(countryCode, regionCode),
                  ),
                ),
              ),
              trailing: item == selected ? const m.Icon(m.Icons.check) : null,
              onTap: () => Navigator.of(sheetContext).pop(item),
            ),
        ],
      ),
    );
    if (choice == null || !context.mounted || locationKey == null) return;
    if (!await viewModel.saveForLocation(locationKey!, choice) &&
        context.mounted) {
      InternalNotification.show(
        context,
        'Не удалось сохранить профиль расчёта',
        type: NotificationType.error,
      );
    }
  }
}
