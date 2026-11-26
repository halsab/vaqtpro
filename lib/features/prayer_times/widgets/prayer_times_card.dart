import 'package:flutter/widgets.dart';
import 'package:material_ui/material_ui.dart' as m;

import '../../../design_system/tokens.dart';

class PrayerTimesCard extends StatelessWidget {
  const PrayerTimesCard({
    super.key,
    required this.times,
    this.isApproximate = false,
  });

  final List<DateTime?>? times;
  final bool isApproximate;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
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
                    if (isApproximate) ...[
                      Text(
                        'Расчёт приблизительный',
                        style: m.Theme.of(context).textTheme.bodySmall,
                      ),
                      const SizedBox(height: AppTokens.space16),
                    ],
                    for (
                      var index = 0;
                      index < _prayerNames.length;
                      index++
                    ) ...[
                      if (index > 0) const SizedBox(height: AppTokens.space16),
                      _PrayerTimeRow(
                        name: _prayerNames[index],
                        time: times != null && index < times!.length
                            ? times![index]
                            : null,
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

const _prayerNames = [
  'Фаджр',
  'Шурук',
  'Истива',
  'Зухр',
  'Аср',
  'Магриб',
  'Иша',
];

class _PrayerTimeRow extends StatelessWidget {
  const _PrayerTimeRow({required this.name, this.time});

  final String name;
  final DateTime? time;

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
          time == null
              ? '—'
              : '${time!.hour.toString().padLeft(2, '0')}:'
                    '${time!.minute.toString().padLeft(2, '0')}',
          textAlign: TextAlign.end,
          style: m.Theme.of(context).textTheme.bodyLarge,
          semanticsLabel: time == null
              ? '$name: время пока не рассчитано'
              : '$name: ${time!.hour.toString().padLeft(2, '0')}:'
                    '${time!.minute.toString().padLeft(2, '0')}',
        ),
      ),
    ],
  );
}
