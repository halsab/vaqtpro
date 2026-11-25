# Product foundation — project defaults

One shared Flutter codebase on Android, iOS and Flutter Web. No React or
second web stack. These are defaults, not decisions to re-litigate for
every product. A user's explicit product requirement overrides a visual
choice; document genuine architectural exceptions rather than bypass checks.

## Architecture (feature-first MVVM)

- main.dart: only imports app/bootstrap.dart and calls bootstrap().
- app/: composition root, DI via constructors, app shell, routing and l10n.
- features/<feature>/{models,repositories,services,view_models,screens,widgets,use_cases}/:
  create only layers needed. Models and pure transformations are independent.
  Repositories own persistent/network data and mutations; services wrap external
  APIs. ViewModels own feature state, validation, actions, loading/error and
  presentation derivation. Use ChangeNotifier from flutter/foundation.dart
  and ListenableBuilder; dispose ownership correctly. Screens/widgets render
  state and forward intent, own only ephemeral UI controllers/focus/animation.
  Use cases are optional for complex multi-repository business rules.
- core/: genuinely shared non-product infrastructure/contracts. No dependency
  on features or app. Avoid generic utils dumping ground and empty layers.
- design_system/: tokens, themes, reusable controls, accessibility and layout
  patterns; no feature dependencies.
- Tests mirror meaningful logic. Inject fakes at repository/service boundaries.
  Preserve real persistence tests; every new material write operation considers
  rejected-write and reload behavior before the first review.
- No global service locator, blanket interfaces, code generation, new state
  manager or router just to satisfy the folder tree. Use Navigator by default,
  go_router when actual deep links/nested routes warrant it.
- Other defaults when needed: one HTTP client, shared_preferences for small
  non-secret preferences, durable structured storage for substantive data,
  secure storage for secrets, Flutter l10n for localization. Select dependencies
  only for an actual requirement; do not install a speculative stack.
- Independent features must not import each other's internals. Compose them
  in app, or extract a shared contract/model to core if warranted.

## Product behavior before visual design

For material new/changed behavior use the behavior contract guide
(BEHAVIOR.md in the reusable product template, installed at
.flutter-harness/templates/product/BEHAVIOR.md). Resolve intent, state,
combinations with existing features, failure paths and observable acceptance
examples before code or visual concepts. Update one existing feature spec or
docs/product/<feature>.md when warranted; no new document for trivial work.
Independent controls remain independent unless the user job justifies an
explicit dependency. Check the rules against the original request, not just
implementation/test agreement. No extra approval or premium model by default.

## UX — design the flow, not a pile of controls

For a new screen or meaningful UX change, privately identify primary user
intent, information hierarchy, most frequent action, and secondary actions.
Start with the content. Keep primary action easy to reach; progressive
disclosure for search, sort, filters and overflow actions when less frequent.
Keep common actions discoverable, not gesture-only. Use consistent navigation,
back behavior, form validation, focus, feedback, and destructive confirmation
or undo according to consequence. Treat loading, empty, filtered-empty,
error, saving and success states as intentional parts of the flow. Preserve
behavior, accessibility, data and all user requirements during redesign.
Do not vertically center a growing list/form as a group; top-align within
safe areas and let the content scroll naturally.

Use actual available width, not device model. Compact <600, medium 600–839,
expanded >=840 logical px are starting breakpoints. Respect text scaling,
safe areas, keyboard inset, touch targets (48 Material logical px),
contrast, semantics, keyboard/focus/hover for Web, RTL and long translations.
Use familiar Material navigation and controls with normal platform behavior,
not a second visual implementation. A single column is fine for a small app on desktop.

## Adaptive layout foundation

One shared ViewModel, navigation intent and Material 3 design system. Decide layout using the actual local constraints (LayoutBuilder), not platform/device name; use MediaQuery.sizeOf for window-level navigation. Shared AppWindowClass (new starter) classifies widths using AppTokens. Existing projects may add this small helper when needed without rewriting the app shell. Select an appropriate canonical composition: bounded single column for simple content; list-detail / split view for a real selection/detail flow; supporting pane for contextual tools; adaptive grid for collections; NavigationBar to NavigationRail/Drawer for real destinations. Do not invent panes or navigation just to fill width. Keep pane minimum widths, readable line lengths and local breakpoints; use Flex/Wrap/ConstrainedBox and standard Material controls. Do not scale the whole mobile UI. Maintain selection, query, sort, drafts, focus where practical, scroll/navigation and saved data across resize/rotation; keep shared state above layout branches. Respect split-screen and browser resize, keyboard/focus traversal, mouse hover and touch targets. No separate Web/Cupertino UI tree or new adaptive library by default.

For meaningful layout changes, execute widget acceptance at 360×800, 768×1024, 1440×900 logical px (or actual supported representative sizes) plus a transition between classes on the same mounted state. Assert meaningful control access, selected state, no overflow and expected composition; cover large text and keyboard/focus where relevant. A bounded single-column result can pass on all widths; no forced multi-pane. Only add runtime wide-width/browser evidence when the wide layout or browser interaction is materially affected. For a small isolated visual edit inspect affected states only; do not redesign unrelated screens.

## One visual foundation: Material 3

Use Material 3 on Android, iOS and Flutter Web (ui_profile: universal).
Do not implement a second Cupertino visual tree, introduce platform-specific
UI wrappers, or imitate UIKit interactions just because the device is iOS.
Keep Flutter's normal platform behavior (navigation, text editing, keyboard,
scroll physics, accessibility) and adapt layout to width and input method.
Use stock Material controls and interactions first; follow the Material 3 component-selection and visible-state rules in DESIGN.md as project defaults, not optional user prompt requirements. In particular, fixed small exclusive display modes use SegmentedButton when suitable; independent filters use FilterChip; secondary search uses progressive disclosure; active sort/filter/query stays understandable without opening a menu. Custom visual direction
builds on Material and the same design system (ui_profile: custom, when
explicitly requested). No optional second component kit by default.
Only universal and explicitly requested custom Material profiles are valid.
Older product revisions must be migrated explicitly; use Git history for rollback.

One semantic light/dark theme follows system appearance on every platform.
Material 3 generates both ColorSchemes from Ocean Blue (#2563EB), a seed,
not a literal foreground, button or background color. Resolve theme roles
with the active BuildContext; don't freeze resolved colors or hand-build
parallel palettes. Explicit branding may change the seed/theme centrally.
No theme picker or palette question by default.

Use stock Material widgets directly in app/presentation with shared theme
and tokens. Keep palette, spacing, typography, radii and genuinely reusable
patterns in design_system. Feature-specific UI stays in its feature. Do not
wrap each SDK widget merely to hide its import, or add platform switches.
No direct UI imports in domain/data/ViewModels; no storage access in views.
Use the Material package compatible with the pinned SDK and existing project.
No new UI library dependency merely for styling. Preserve keyboard/focus,
safe areas, responsive layout, semantics, and large-text support.

## Visual design before implementation

For a substantial new screen, flow or redesign follow the compact DESIGN.md
guide in .flutter-harness/templates/product/. Define the behavior first;
choose a visual direction using relevant actual reference images and Material
patterns before coding UI. For explicit redesigns needing comparison inspect the
populated baseline if available, compare two concise structural wireframes,
and record the chosen direction, baseline defects and observable visual
acceptance in the existing behavior contract. Preserve functionality, not
an ineffective composition. Keep the selected direction and interaction
notes in the task handoff. No mandatory mockup or baseline for ordinary UI
changes or new screens; user references are optional, no separate design-review agent, no premium model for visual design.

## Visual acceptance and review

For a material new screen, redesign, major navigation/flow or design-system
change, inspect actual rendered screenshots of the changed screen(s), with
representative content and the key changed state. For initial Material adoption
or a shared theme change inspect light and dark on one representative runtime platform. Inspect another platform only for an
actual platform-specific change or risk; inspect wide layout when affected.
For substantial redesigns inspect the populated final screen and key changed
interaction at a representative compact width in both themes; compare the
baseline at comparable content and width if available. A single screenshot
of an empty screen or a successful launch is insufficient. For isolated
changes inspect only affected states and representative widths.
Check narrow/large layouts and large text using fast widget assertions where
meaningful, plus a representative desktop width if Web layout changes.
Use actual local simulator/browser captures, not mockups or Ahem widget-test
screenshots as proof of polished visual design. Save local previews under
.flutter-harness/previews/ (ignored); include exact paths/viewport/platform
in reviewer handoff and PR, attach screenshots when supported.
Compare the actual rendered result with the selected direction, original
request and behavior contract. Review hierarchy, spacing, discoverability, clipping, theme, states,
platform behavior and reuse. Material hierarchy or interaction defects are
not cosmetic preferences. One read-only reviewer covers correctness,
architecture and UX, not three separate agents. If runtime visual review is
unavailable, say BLOCKED for required visual acceptance, do not claim PASS.
A screenshot is semantic review evidence, not an executable functional test.
No routine visual/E2E checks for non-visual changes, no golden auto-approval.
Required planned runtime evidence must pass the CLI before reviewer dispatch. Missing evidence is BLOCKED, not a product defect. For material visual tasks the same reviewer reports an explicit VISUAL: PASS
before VERDICT: PASS only after opening actual runtime images and comparing
them to the user job and baseline/target. Owner makes final aesthetic acceptance.

## Adoption and checks

Fresh projects are created and verified by scripts/new-project.py. On an
existing pending project, use the installed CLI adopt to copy missing starter
files only; migrate application behavior explicitly, then set product.json
active. Never downgrade an active product or disable the convention guard.
Use the CLI check operation, which resolves dependencies, formats and runs
conventions, analyzer and fast tests. The checker is lexical, not a complete
semantic verifier. Required visual and semantic review remains separate.
Existing installed files are updated by the managed installer; local edits
block sync. See ORCHESTRATION.md only for genuinely complex work.
