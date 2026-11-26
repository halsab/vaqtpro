import 'package:flutter/widgets.dart';
import 'package:material_ui/material_ui.dart' as m;

import '../../../design_system/components.dart';
import '../../../design_system/tokens.dart';

class PrayerTimesScreen extends StatelessWidget {
  const PrayerTimesScreen({super.key});

  static const _prayerNames = [
    'Фаджр',
    'Шурук',
    'Истива',
    'Зухр',
    'Аср',
    'Магриб',
    'Иша',
  ];

  @override
  Widget build(BuildContext context) => AppPage(
    title: 'Времена намаза',
    child: LayoutBuilder(
      builder: (context, constraints) => SingleChildScrollView(
        padding: AppTokens.pagePadding,
        child: ConstrainedBox(
          constraints: BoxConstraints(minHeight: constraints.maxHeight),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: m.Card(
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppTokens.space24,
                    vertical: AppTokens.space16,
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      for (
                        var index = 0;
                        index < _prayerNames.length;
                        index++
                      ) ...[
                        if (index > 0)
                          const SizedBox(height: AppTokens.space16),
                        _PrayerTimeRow(name: _prayerNames[index]),
                      ],
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

class _PrayerTimeRow extends StatelessWidget {
  const _PrayerTimeRow({required this.name});

  final String name;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(
        child: Text(name, style: m.Theme.of(context).textTheme.bodyLarge),
      ),
      const SizedBox(width: AppTokens.space16),
      SizedBox(
        width: 56,
        child: Text(
          '—',
          textAlign: TextAlign.end,
          style: m.Theme.of(context).textTheme.bodyLarge,
          semanticsLabel: '$name: время пока не задано',
        ),
      ),
    ],
  );
}
