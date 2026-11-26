import 'package:flutter/widgets.dart';
import 'package:material_ui/material_ui.dart' as m;

import '../../../design_system/tokens.dart';

class PrayerTimesCard extends StatelessWidget {
  const PrayerTimesCard({
    super.key,
    required this.times,
    this.isApproximate = false,
    this.notice,
  });

  final List<DateTime?>? times;
  final bool isApproximate;
  final String? notice;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final rowGap = notice != null || constraints.maxHeight < 520
          ? AppTokens.space8
          : AppTokens.space16;
      return Padding(
        padding: AppTokens.pagePadding,
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
                    if (notice != null || isApproximate) ...[
                      Text(
                        notice ?? 'Расчёт приблизительный',
                        textAlign: TextAlign.center,
                        style: m.Theme.of(context).textTheme.bodySmall,
                      ),
                      SizedBox(height: rowGap),
                    ],
                    for (
                      var index = 0;
                      index < _prayerNames.length;
                      index++
                    ) ...[
                      if (index > 0) SizedBox(height: rowGap),
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
      );
    },
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
