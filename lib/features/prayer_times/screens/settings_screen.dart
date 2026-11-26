import 'package:adhan/adhan.dart';
import 'package:flutter/widgets.dart';
import 'package:material_ui/material_ui.dart' as m;

import '../../../design_system/components.dart';
import '../../../design_system/tokens.dart';
import '../models/calculation_profile.dart';
import '../view_models/calculation_profile_view_model.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key, required this.viewModel});

  final CalculationProfileViewModel viewModel;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: viewModel,
    builder: (context, _) => AppPage(
      title: 'Настройки',
      child: viewModel.isLoading
          ? const Center(child: m.CircularProgressIndicator())
          : ListView(
              padding: AppTokens.pagePadding,
              children: [
                m.ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Профиль расчёта'),
                  subtitle: Text(
                    '${calculationMethodLabel(viewModel.profile.method)} · '
                    '${madhabLabel(viewModel.profile.madhab)} · '
                    '${highLatitudeRuleLabel(viewModel.profile.highLatitudeRule)}',
                  ),
                  trailing: const m.Icon(m.Icons.chevron_right),
                  onTap: () => _editProfile(context),
                ),
              ],
            ),
    ),
  );

  Future<void> _editProfile(BuildContext context) async {
    final initial = viewModel.profile;
    final result = await m.showModalBottomSheet<CalculationProfile>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _ProfileEditor(initial: initial),
    );
    if (result == null || !context.mounted) return;
    if (!await viewModel.save(result) && context.mounted) {
      InternalNotification.show(
        context,
        'Не удалось сохранить профиль расчёта',
        type: NotificationType.error,
      );
    }
  }
}

class _ProfileEditor extends StatefulWidget {
  const _ProfileEditor({required this.initial});

  final CalculationProfile initial;

  @override
  State<_ProfileEditor> createState() => _ProfileEditorState();
}

class _ProfileEditorState extends State<_ProfileEditor> {
  late CalculationMethod _method = widget.initial.method;
  late Madhab _madhab = widget.initial.madhab;
  late HighLatitudeRule _highLatitudeRule = widget.initial.highLatitudeRule;

  @override
  Widget build(BuildContext context) {
    final height = MediaQuery.sizeOf(context).height;
    return SizedBox(
      height: height * 0.88,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppTokens.space24,
              AppTokens.space16,
              AppTokens.space16,
              AppTokens.space8,
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    'Профиль расчёта',
                    style: m.Theme.of(context).textTheme.titleLarge,
                  ),
                ),
                m.IconButton(
                  tooltip: 'Закрыть',
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const m.Icon(m.Icons.close),
                ),
              ],
            ),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.symmetric(
                horizontal: AppTokens.space16,
              ),
              children: [
                _dropdown<CalculationMethod>(
                  label: 'Метод расчёта',
                  value: _method,
                  items: CalculationMethod.values
                      .where((method) => method != CalculationMethod.other)
                      .map(
                        (method) => m.DropdownMenuItem(
                          value: method,
                          child: Text(calculationMethodLabel(method)),
                        ),
                      )
                      .toList(),
                  onChanged: (value) {
                    if (value != null) setState(() => _method = value);
                  },
                ),
                const SizedBox(height: AppTokens.space16),
                _dropdown<Madhab>(
                  label: 'Правило расчёта Асра',
                  value: _madhab,
                  items: Madhab.values
                      .map(
                        (value) => m.DropdownMenuItem(
                          value: value,
                          child: Text(madhabLabel(value)),
                        ),
                      )
                      .toList(),
                  onChanged: (value) {
                    if (value != null) setState(() => _madhab = value);
                  },
                ),
                const SizedBox(height: AppTokens.space16),
                _dropdown<HighLatitudeRule>(
                  label: 'Правило для высоких широт',
                  value: _highLatitudeRule,
                  items: HighLatitudeRule.values
                      .map(
                        (value) => m.DropdownMenuItem(
                          value: value,
                          child: Text(highLatitudeRuleLabel(value)),
                        ),
                      )
                      .toList(),
                  onChanged: (value) {
                    if (value != null) {
                      setState(() => _highLatitudeRule = value);
                    }
                  },
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(AppTokens.space16),
            child: SizedBox(
              width: double.infinity,
              child: m.FilledButton(
                onPressed: () => Navigator.of(context).pop(
                  CalculationProfile(
                    method: _method,
                    madhab: _madhab,
                    highLatitudeRule: _highLatitudeRule,
                  ),
                ),
                child: const Text('Сохранить'),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _dropdown<T>({
    required String label,
    required T value,
    required List<m.DropdownMenuItem<T>> items,
    required ValueChanged<T?> onChanged,
  }) => m.DropdownButtonFormField<T>(
    key: ValueKey(label),
    initialValue: value,
    decoration: m.InputDecoration(
      labelText: label,
      border: const m.OutlineInputBorder(),
    ),
    items: items,
    onChanged: onChanged,
  );
}
