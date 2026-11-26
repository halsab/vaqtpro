# Location and prayer times home

## Intent and scope

Help the user identify and select a place quickly, then retain it between
launches. This iteration implements device location, place search, recent
places, favorites, and persistent selection only. Prayer-time calculation and
display remain out of scope; never imply that placeholder values are real.

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
  retains its original coordinates and an optional known timezone.
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

## Layout and acceptance

Keep the existing centered seven-row Material 3 prayer card and em-dash values
unchanged whenever a place is selected. With no place, center the two location
actions and any permission explanation in the available body. The app-bar place
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
- With a place selected, the prayer card still shows seven ordered rows with
  em dashes; this task does not calculate or fabricate prayer times.
