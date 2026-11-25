# Product design — lean Material-first workflow (V2)

Design a usable product, not a collection of widgets. The build parent owns
design and integration; use the same Luna planning/execution roles already
configured. No mandatory design agent, premium model, design approval or
additional review round. Apply proportionately.

## 1. Choose a design direction before UI code

No original app launch by default. For focused changes or new screens, implement from request and design system; user references are optional. Only when meaningful before/after comparison is needed, launch auto before edits, wait for actual content, inspect and capture the original state explicitly. After final check, launch auto selects and pins one working iOS → Android → Web target. Use --only for platform-specific changes. Do not build every platform. Keep comparable content/viewport when using a baseline.

For minor changes preserve the existing visual language and adapt the
relevant component; no new mockups, two-option design exercise or full-screen redesign. Implement the precise requested outcome and inspect only affected states. For significant layout changes apply PRODUCT.md adaptive acceptance; choose a bounded single column, list-detail, supporting pane or grid based on actual user jobs, not an arbitrary desktop layout. For a substantial new screen, major
navigation/flow or redesign, establish the behavior contract (BEHAVIOR.md)
first. Identify the primary job, focal content, frequent and rare actions,
required states and the space available. Inspect the actual existing screen
when changing it, if available, and relevant reference images. Prefer
existing product references, then relevant Material examples from the SDK
or official Material documentation (https://m3.material.io/). The local
references/content-priority.svg is a teaching illustration, not a required
layout or a runtime screenshot. Render/view an image rather than judging
its markup alone. If a reference or rendering tool is unavailable, state
the limitation; do not repeatedly hunt for tools or claim inspection.

For an explicit redesign, preserving functionality does NOT mean preserving
the old composition. First capture and actually inspect the existing populated
screen at a representative compact viewport if it can run. Use realistic,
non-sensitive fixture content, not an empty screen; retain existing data.
Identify the two or three most consequential baseline UX problems and their
observable impact. Save the baseline path and viewport in the design handoff;
if it cannot be captured, name the actual limitation once. Do not treat the
old layout as the default solution simply because it already compiles.

Before UI edits, record a compact design decision in the existing behavior
contract (one section, not another document). For a substantial redesign:
- State the primary job and rank content, frequent actions and rare actions.
- Sketch two materially different layout/interaction options with the same
  realistic content at a representative compact width; an annotated text
  wireframe is sufficient for this planning step. If visual tools are already
  available, a small rendered concept may help. Do not build two Flutter apps.
- Choose the layout, explain why it improves the baseline, and name specific
  changes to placement, persistent controls, secondary actions and density.
- Specify observable visual acceptance: the primary content start and visible
  useful items (where meaningful), long-label handling, selected state,
  action access, empty/error state and width/theme evidence. Use a target tied
  to actual content and viewport, not an arbitrary screen percentage.
- A retained control or layout with a baseline defect needs a user-job
  justification. Do not confuse unchanged functionality with unchanged UI.
For new screens, one coherent annotated layout is enough unless a real
structural trade-off needs comparison. No extra agent, approval or art contest.

Choose one coherent direction: layout and reading order, primary action,
secondary actions, navigation, content density, typography, surfaces,
responsive behavior and the meaningful state transitions. Keep a compact
handoff in the behavior contract or local task plan. A single focused revision if needed; no default separate SVG app,
duplicated UI implementation or design competition. Do not delay an
obvious standard Material solution for high-fidelity mockup production.
Planning wireframes are not evidence of runtime visual quality.

## 2. Design for the product's actual job

- Content first for content-oriented utilities. Use navigation, summaries,
  dashboards or prominent calls to action when the primary job warrants them,
  not because a generic design template includes them.
- Use a clear visual hierarchy, consistent grid and spacing rhythm, readable
  type, intentional contrast, semantic color roles and restrained accents.
  Avoid nested surfaces, redundant labels, gratuitous chips, heroes and
  invented metrics. Every element must have a job; minimalism must not hide
  frequent actions or important state.
- Use ordinary Material 3 patterns and existing theme tokens. Customize
  when a real product requirement warrants it. No second platform visual
  tree, pretend UIKit effects, or new UI kit for standard controls.
- Maintain predictable selected states, discoverability, visible feedback,
  recoverable errors and accessible explicit alternatives to gesture-only
  actions. Avoid custom animation when a standard component works.
- Use realistic data, including long labels, multiple statuses and values.
  Respect touch targets, text scale, focus, contrast, keyboard, safe areas
  and width. On wide screens choose a meaningful bounded layout or additional
  panes only when useful, not arbitrary empty columns.
- Do not invent fields, branding, product features, navigation or marketing
  content to fill a composition. Search, filters, sorting and other state
  must follow the behavior contract, not a static mockup.

Examples across product types:
- A task list prioritizes tasks and frequent actions; rare row actions can
  be contextual. Keep independent sort/group/filter state comprehensible.
- A finance history prioritizes descriptions, dates, amounts and scope.
  Align amounts for comparison; use signs/labels as well as color; never
  invent categories or balances. Search may deserve persistent space.
- A form prioritizes labels, valid input, recovery and the next action;
  distinguish required/optional fields and preserve input after failure.
  A dashboard prioritizes meaningful decisions, not maximum card count.
  These are examples, not fixed screen templates.

## Material 3 component selection (default, not a task-specific prompt)

Use the current official SDK Material widgets directly and their semantic theme.
Review the user job, state cardinality, frequency and placement before choosing
the control. The following are defaults; justify an exception with actual UX
needs, not styling preference:

| Interaction | Preferred stock component/pattern |
|---|---|
| Small fixed set of mutually exclusive display modes | SegmentedButton; Tabs for distinct content destinations |
| Independent combinable filters | FilterChip; chips for categories/tags |
| Secondary search on a content-first screen | SearchAnchor/SearchBar opened from an accessible action; show active query and clear affordance |
| Search as the primary job | Persistent SearchBar |
| Main create/add action | FloatingActionButton or FilledButton according to screen job |
| Contextual/overflow or sort menu | MenuAnchor/MenuItemButton; standard Material 3 menu rather than legacy PopupMenuButton unless justified |
| Standard task/content row | ListTile, CheckboxListTile or stock equivalent; custom layout only for a concrete need |

Do not use standalone chips to mimic a small fixed single-choice mode switch
when SegmentedButton fits. Do not permanently show competing input fields
without a demonstrated user need. Do not hide the currently selected mode:
show the active filter, search query, sort criterion and direction outside the
closed menu, with accessible names and a selected marker inside it. Prefer
meaningful sort names describing the actual ordering (e.g. oldest first),
not "Default". Do not silently change stored data/order or add new features
to satisfy labels. Use representative long labels, selected/nonselected
states and sufficient touch targets; allow responsive alternatives if needed.
A wrong component choice or invisible active state is a material UX finding,
even when the widget itself belongs to Material. Native here means official
Flutter Material components, not Android Views or a third-party UI kit.

## 3. Implement and inspect

The build agent implements the selected direction with shared tokens and coherent stock controls. Do not change product behavior to make UI implementation easier.

After integration, capture representative actual Flutter runtime screen(s)
for the changed flow, at the affected widths and themes per PRODUCT.md.
Use the installed CLI launch/capture on one explicit representative target; capture receipts are candidate-bound. For meaningful interaction, use a scripted scenario or inspect actual state before capturing. Prefer one stable
runtime session and targeted refresh over rebuilding every platform. If
isolated fixture data is needed, use the real screen and design system;
never ship demo data or erase real records. Static mockups, SVGs and Ahem
test renders cannot establish runtime visual acceptance.

For substantial redesigns capture a populated final screen and a key changed
interaction at the representative compact width, in both light and dark
on one runtime platform. Create ignored .flutter-harness/work/visual-plan.json before review, preferably before edits:

    {"platform":"ios","fixture":"isolated realistic short/long mixed-state records","scenarios":[{"label":"final","kind":"screen"},{"label":"changed-menu","kind":"interaction"}]}

Only if comparison matters, capture the actual original screen before edits with CLI `capture <platform> baseline light` after launch and readiness inspection; add `"baseline":{"digest":"<original SHA256>","label":"baseline"}` to the plan. If needed but unavailable, record `"baseline":{"unavailable":"specific observed blocker"}`. Otherwise omit baseline entirely. The gate checks baseline hash/dimensions and matching native target when supplied; the reviewer must verify the same realistic fixture and logical viewport. Choose scenario labels for actual changed states; add affected widths/screens only when needed. For Web each scenario also declares `viewport` (e.g. `390,844`); a Web interaction requires a project-local Playwright capture scenario. Capture each label sequentially in light and dark via CLI `capture <platform> <label> <theme>` (optional `--settle 1.5`, `--scenario <path>`). Native scenarios use the installed Maestro CLI; Web Playwright tests receive HARNESS_WEB_URL, HARNESS_CAPTURE_PATH, HARNESS_CAPTURE_THEME, HARNESS_CAPTURE_VIEWPORT and HARNESS_CAPTURE_SETTLE_MS and must set viewport/theme, exercise the state, wait for stability and write the PNG. No arbitrary raw screenshot files in place of receipts. Use isolated fixture data or a dedicated test target, never erase existing records. Include enough items and long labels to exercise actual density and state; a single short row is not a populated acceptance fixture. Inspect the real interaction after animation, not a transient frame. CLI serializes native theme/capture; never run competing simulator commands. `visual-evidence` checks coverage/hashes/dimensions and distinct theme content; it cannot prove correct UI state or aesthetic quality. Reviewer must open planned images, verify actual state/theme and compare baseline only when supplied. For focused material UX changes declare visual_required in delivery.json; set visual_interaction when a changed interaction must be captured. Use only relevant states, not a full redesign checklist. No review dispatch before successful standard checks and visual evidence. Keep the plan stable across review; do not remove a failing required state just to satisfy the gate. Use comparable content/viewport to the baseline
where possible; inspect wide layout when affected. Save actual image paths
under .flutter-harness/previews/ and include them in the handoff and PR.
Do not count a build, an empty screen or an unopened file as visual review.

Compare actual captures against the intended design, baseline and request:
- **Hierarchy:** where does real content start; how many useful items are
  visible; is an avoidable stack of persistent controls still dominating?
  For a content-first utility, the list is the primary content, not its form.
  For other product types use the corresponding primary job, not list metrics.
- **Actions:** can users find frequent actions, and do rare actions consume
  space better used by content? Contextual means actually available in context,
  not a claim in a spec. Are destructive actions and scope clear?
- **State:** is the selected mode/order/filter readable without guessing?
  Does a label such as "Default" explain what it does? Does an icon-only
  action have an accessible label/tooltip?
- **Craft:** inspect alignment, spacing rhythm, hierarchy, readable long
  content, contrast, clipping, safe areas and representative themes.
- **Outcome:** what material UX problems did the redesign actually solve?
  A mere alignment/spacing tweak or green sorting tests are insufficient for
  a broad redesign if the dominant baseline issues remain. Preserve data,
  identity, behavior and important states, not unnecessary old layout.

Use behavioral tests for interactions and persistence; screenshots cannot
prove animation smoothness, keyboard behavior or accessibility compliance.
When an important gesture/animation is changed, inspect its actual behavior
with the smallest appropriate runtime check. Fix material defects and
inspect changed evidence, not endless aesthetic variations.

For changes requiring independent review, give the existing reviewer the
original request, behavior contract, chosen design and actual images.
It should identify concrete product or visual defects and their impact,
not reward a generic clean appearance or invent arbitrary preferences.
Require the same reviewer to open the supplied populated runtime images,
not infer quality from source, a build log or the parent's statement.
Review against the original job and the observable baseline/target, not
only against a self-authored design contract. Name evidence inspected,
one concrete finding per material defect and its user impact. If the
design direction is too conservative, challenge it. Visual acceptance is
separate from correctness; report VISUAL: PASS immediately before the final
VERDICT: PASS for a visual task. For actual product defects report VISUAL: CHANGES_REQUIRED and VERDICT: CHANGES_REQUIRED. Missing or unreadable evidence is VERDICT: BLOCKED, technical execution failure VERDICT: ERROR. Do not spend an independent review on missing known prerequisites. A logic-only targeted recheck can reuse
unchanged images after actually inspecting them. Do not retake them for
invisible source changes. No extra design reviewer or numeric beauty score.
Required visual evidence missing means visual acceptance is BLOCKED; do not
substitute a mockup or green analyzer/test output. Report the specific gap.
The guard checks the explicit reviewer verdict, not aesthetic truth or the
provenance of an image; the owner still makes final aesthetic acceptance.
Respect existing bounded recovery and publication policy.

For a focused change use one checked final launch when needed and only required changed states. No initial launch or baseline ritual. `launch auto` may reuse a prior exact native launch on the pinned device after a live device probe; this is not proof the app remains foregrounded. Inspect actual UI, use `--fresh` when necessary. For batch capture add a project-local `scenario` to every visual-plan scenario (including a deterministic screen reset/launch without clearing real data), then `capture-plan` runs both themes serially. Plan scripts before final check; do not change source during capture. Individual capture remains available for inspected live UI. Verify interaction state changes in executable widget tests and not only screenshots.
