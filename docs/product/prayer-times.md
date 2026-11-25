# Prayer times home

## Intent and scope

The initial home screen presents the seven daily prayer-related times in order:
Фаджр, Шурук, Истива, Зухр, Аср, Магриб, Иша. Show the name on the left and
its time on the right in one centered card. Do not add column headings, table
rules, dates, location, navigation, or unrelated actions.

## State and rules

This iteration implements presentation only. Calculation, location, and time
source are intentionally out of scope; no real or sample times may be implied.
Until a time source is connected, each row shows an em dash. Фаджр represents
the beginning of its time; Шурук is shown separately.

## Layout and acceptance

Use a single-column Material 3 card, centered when it fits and scrollable when
text scaling or a short viewport requires it. Keep all seven rows, omit column
headings and visible row/column rules, and align times consistently at the
right edge. At compact, medium, and expanded widths, all labels remain
readable without overflow; resize must not alter row order or values.
