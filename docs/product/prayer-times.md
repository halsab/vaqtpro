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
- Russia follows the Moscow DUM RF calendar parameters: Fajr/Isha 18°/15°,
  standard Asr, sunrise −5 minutes, Dhuhr +5 minutes, and sunset +5 minutes.
  For each selected night and prayer independently, if its angle is unreachable,
  estimate Fajr at 30% of the night before sunrise or Isha at 25% after sunset.
  Apply this in either hemisphere only on affected nights; do not use a fixed
  latitude cutoff.
- If sunrise or sunset does not occur, use Adhan Dart's nearest-latitude polar
  resolution and treat the resulting times as approximate. Use solar events
  without regional minute offsets to determine night length.
- The settings page reports which location-based profile is active. The
  existing centered seven-row Material 3 prayer card shows calculated times
  for the selected location; without a selected place it remains uncalculated.

## Layout and acceptance

Keep the existing centered seven-row Material 3 prayer card. With no place,
center the two location actions and any permission explanation in the available
body. The app-bar place
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
- The prayer card and settings page use the same effective profile; changing the
  selected place recalculates the times without requiring a profile toggle.
