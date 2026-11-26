import 'package:adhan/adhan.dart';
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
      final automaticProfile = prayerCalculationProfileForRegion(
        countryCode,
        regionCode,
      );
      final configuration = viewModel.configurationFor(
        locationKey,
        automaticProfile: automaticProfile,
      );
      return AppPage(
        title: 'Настройки',
        child: ListView(
          padding: AppTokens.pagePadding,
          children: [
            Padding(
              padding: const EdgeInsets.only(bottom: AppTokens.space8),
              child: Text(
                'Параметры расчета времени намаза',
                style: m.Theme.of(context).textTheme.titleLarge,
              ),
            ),
            m.SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: configuration.mode == PrayerCalculationMode.automatic,
              title: Text(
                configuration.mode == PrayerCalculationMode.automatic
                    ? 'Автоматически'
                    : 'Вручную',
              ),
              onChanged: viewModel.isLoading
                  ? null
                  : (automatic) => _update(
                      context,
                      configuration.copyWith(
                        mode: automatic
                            ? PrayerCalculationMode.automatic
                            : PrayerCalculationMode.manual,
                      ),
                    ),
            ),
            if (configuration.mode == PrayerCalculationMode.automatic)
              Padding(
                padding: const EdgeInsets.only(top: AppTokens.space8),
                child: Text(automaticProfileSummary(automaticProfile)),
              )
            else ...[
              const SizedBox(height: AppTokens.space16),
              _dropdown<PrayerCalculationProfile>(
                label: 'Профиль расчёта',
                value: configuration.profile,
                items: PrayerCalculationProfile.values
                    .map(
                      (profile) => m.DropdownMenuItem(
                        value: profile,
                        child: Text(profile.label),
                      ),
                    )
                    .toList(),
                onChanged: (profile) {
                  if (profile != null) {
                    _update(
                      context,
                      configuration
                          .selectingProfile(profile)
                          .copyWith(mode: PrayerCalculationMode.manual),
                    );
                  }
                },
              ),
              const SizedBox(height: AppTokens.space16),
              _dropdown<Madhab>(
                label: 'Правило расчёта Асра',
                value: configuration.madhab,
                items: Madhab.values
                    .map(
                      (madhab) => m.DropdownMenuItem(
                        value: madhab,
                        child: Text(madhabLabel(madhab)),
                      ),
                    )
                    .toList(),
                onChanged: (madhab) {
                  if (madhab != null) {
                    _update(context, configuration.copyWith(madhab: madhab));
                  }
                },
              ),
              const SizedBox(height: AppTokens.space16),
              _dropdown<PrayerHighLatitudeRule>(
                label: 'Правило для высоких широт',
                value: configuration.highLatitudeRule,
                items: PrayerHighLatitudeRule.values
                    .map(
                      (rule) => m.DropdownMenuItem(
                        value: rule,
                        child: Text(prayerHighLatitudeRuleLabel(rule)),
                      ),
                    )
                    .toList(),
                onChanged: (rule) {
                  if (rule != null) {
                    _update(
                      context,
                      configuration.copyWith(highLatitudeRule: rule),
                    );
                  }
                },
              ),
            ],
          ],
        ),
      );
    },
  );

  Widget _dropdown<T>({
    required String label,
    required T value,
    required List<m.DropdownMenuItem<T>> items,
    required ValueChanged<T?> onChanged,
  }) => m.DropdownButtonFormField<T>(
    key: ValueKey((label, value)),
    initialValue: value,
    decoration: m.InputDecoration(
      labelText: label,
      border: const m.OutlineInputBorder(),
    ),
    items: items,
    onChanged: onChanged,
  );

  Future<void> _update(
    BuildContext context,
    PrayerCalculationConfiguration configuration,
  ) async {
    if (await viewModel.updateConfiguration(locationKey, configuration) ||
        !context.mounted) {
      return;
    }
    InternalNotification.show(
      context,
      'Не удалось сохранить настройки расчёта',
      type: NotificationType.error,
    );
  }
}
