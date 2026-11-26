# Location and prayer times home

## Intent and scope

Help the user identify and select a place quickly, then retain it between
launches. This iteration implements device location, place search, recent
places, favorites, persistent selection, and location-based prayer-time
calculation.

## State and rules

- Restore the selected place, favorites, and up to five recent places before
  presenting the first-run state. Never request location permission on launch.
- With no selected place, show “Определить местоположение” and
  “Выбрать вручную”. Once permission is denied, make manual selection primary.
  A permanently denied permission explains how to enable it; offer an app
  settings action only where supported.
- Device coordinates are reverse-geocoded while showing a progress indicator.
  Prefer a nearby named populated place. Offline matching chooses the nearest
  catalog place no farther than 25 km; do not expand the radius. If no
  trustworthy result exists, show coordinates to three decimal places while
  retaining their full precision.
- When a populated place is displayed, persist and use that place's coordinates
  and timezone, not the device's raw coordinates. A coordinate-only selection
  retains its original coordinates and an optional known timezone. Retain the
  GeoNames country and first-level region codes with each place.
- When restoring an older saved place with a GeoNames ID and missing regional
  metadata, enrich it from the bundled catalog and persist the result. If its
  timezone is still unknown, use the device's current offset and label the
  schedule as approximate.
- Show the short place name in the app bar. Show the difference from the
  device's current timezone offset only when both offsets are known and differ.
  Tapping the place opens the selection sheet.
- The selection sheet shows up to five favorites and up to five non-duplicate
  recent places when the query is empty. Search results appear locally
  immediately; an online GeoNames search follows a 250–300 ms debounce.
  Merge results by GeoNames ID and ignore stale responses. Rank exact matches,
  prefix matches, then other matches; distance breaks ties only when a current
  location is already available. No permission prompt is needed for search.
- A star adds/removes a favorite without changing the selected place. Retain
  favorite records beyond the five shown initially and provide access to all.
  A new selection becomes the most recent place. Preserve saved data when a
  read or write fails; stale asynchronous location/search work cannot overwrite
  a later user choice.
- GeoNames catalog data is bundled for offline use: worldwide `cities15000`
  plus populated places in Tatarstan, Moscow and Moscow Oblast, St Petersburg
  and Leningrad Oblast, Dagestan, and Chechnya. Attribute the dataset.
- Online GeoNames requests use the `vaqtpro` username by default. Override it
  at build time with `--dart-define=GEONAMES_USERNAME=...`. If the configured
  username is unavailable, all offline selection and lookup behavior remains
  available.
- The PWA caches its application shell and place catalog after the first
  successful online load; location search can then be reopened without network.
- Prayer times are calculated for the selected place and its timezone. Select
  the Tatarstan profile only for GeoNames `countryCode=RU` and
  `regionCode=73`; other Russian places use the Russia profile; places outside
  Russia or with unknown country use MWL. Never infer Tatarstan from a localized
  region name.
- Tatarstan uses Fajr/Isha angles 18°/15°, Hanafi Asr, sunrise and sunset as
  calculated by Adhan Dart, and Dhuhr at the later of local 12:00 or solar noon
  +1 minute rounded up. If the 18° twilight is unavailable for a night, use
  sunset +90 minutes for Isha and sunrise −120 minutes for the following Fajr.
- Russia uses Fajr/Isha 18°/15°, standard Asr, sunrise −5 minutes, Dhuhr
  +5 minutes, and sunset +5 minutes. Preserve each astronomical angle whenever
  it is reachable. Only when 18° Fajr is unreachable, estimate Fajr at 30% of
  the preceding raw solar night; only when 15° Isha is unreachable, estimate
  Isha at 25% of the current raw solar night. Apply this in either hemisphere
  only on affected nights; do not use a fixed latitude cutoff.
- If sunrise or sunset does not occur, use Adhan Dart's nearest-latitude polar
  resolution and treat the resulting times as approximate. Use solar events
  without regional minute offsets to determine night length.
- Settings provide automatic/manual mode. Automatic mode hides the editable
  fields and shows the active profile, Asr rule, and “Высокие широты: По
  профилю”. Without a selected place, the summary uses MWL; prayer times remain
  unavailable until coordinates are selected.
- Manual mode exposes all 14 profiles: the 12 Adhan methods except “Other”,
  plus Татарстан and Россия, along with independent Asr and high-latitude
  controls. Choosing a profile immediately replaces both controls with that
  profile's defaults; either can then be changed without changing the profile.
  High-latitude choices are “Середина ночи”, “Седьмая часть ночи”, “Угол
  сумерек”, “По правилам профиля Татарстан”, and “По правилам профиля Россия”.
- Settings apply immediately without a save button and remain associated with
  each place. A manual configuration made before choosing a place is used as the
  starter for places that have no saved configuration. Returning to automatic
  mode preserves the manual values. Existing per-place regional overrides are
  migrated to manual configurations; an older global method configuration is
  retained as the unplaced starter without disabling automatic mode.
- The centered seven-row Material 3 prayer card shows calculated times for the
  selected location without a scroll container. Without a selected place it
  remains uncalculated.

## Layout and acceptance

Keep the existing centered seven-row Material 3 prayer card without
unnecessary scrolling. With no place, center the two location actions and any
permission explanation in the available body. The app-bar place
name is a clearly actionable control. The bottom sheet uses a persistent search
field, favorite stars, and an empty-query quick list; auto-focus search only
when there are no favorites or recent places. Support keyboard insets, large
text, narrow widths, and scrollable results.

## Acceptance examples

- Fresh install: no permission prompt, two location actions; tap automatic
  detection to request permission.
- Permanently denied: manual action is primary; automatic action explains the
  restriction and offers settings navigation only on supported platforms.
- Offline coordinates 20 km from a catalog place select that place and its
  catalog coordinates; 26 km away falls back to the full-precision coordinates
  formatted to three decimals.
- Search shows local results before online results, contains no duplicate
  GeoNames IDs, and a late response for an older query does not replace current
  results.
- Select a place, favorite it, restart offline: the selected short name and
  favorite are restored; selecting it again does not duplicate recents.
- With a selected place, show seven ordered rows of calculated local times.
- GeoNames `RU.73` selects Tatarstan; other `RU` places select Russia; unknown
  and non-RU countries select MWL.
- Automatic settings hide editable fields and show the active profile summary.
  Manual settings are available with no selected place; switching mode or
  changing any field applies immediately without a save action.
- Selecting a manual profile sets its Asr and high-latitude defaults; editing
  either field keeps the selected profile and applies the override to the
  calculation.
- Manual configuration persists across launches per place. A no-place manual
  configuration acts as the starter for places without an existing config;
  existing per-place configs take precedence.
- A previously saved Kazan without `regionCode` is migrated from its GeoNames ID
  and selects the Tatarstan profile automatically.
