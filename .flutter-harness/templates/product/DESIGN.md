# Product design — lean Material-first workflow (V2)

Design a usable product, not a collection of widgets. The build parent owns
design and integration; use the same Luna planning/execution roles already
configured. No mandatory design agent, premium model, design approval or
additional review round. Apply proportionately.

## 1. Choose a design direction before UI code

For a minor text, color, dimension or spacing change, keep the existing visual
language and verify the actual style/constraints in source. No mockup, baseline,
runtime launch, screenshots or separate design exercise just to confirm code.

For a new screen or material redesign, identify the primary job, content
hierarchy, frequent/rare actions, required states and responsive constraints.
Use the existing design system and relevant references. Choose a direction
before implementation; compare two concise options only when a genuine
structural trade-off warrants it. Preserve functionality, not a bad composition.
If before/after comparison materially matters, inspect the populated existing
screen at comparable content/viewport, with a baseline capture only if useful.
Avoid empty fixtures, gratuitous controls and invented features. Keep the
design decision and observable acceptance criteria in the existing plan or
behavior contract. A wireframe is a planning aid, not runtime proof.

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

Build implements the chosen direction using shared tokens and stock controls.
Review source first: actual constraints, dimensions, color roles, state,
accessibility, layout and relevant tests. Static proof is enough for isolated
corrections. Do not launch/capture again after each reviewer finding.

After code review and material fixes, inspect the final representative runtime
when appearance or interaction cannot be established adequately by source and
widget tests (especially a substantial new screen/redesign). Prefer one
running affected target and hot reload where available. Use a meaningful
populated fixture and inspect the actual state, not just a successful build.
Use screenshots only as useful evidence, not an obligatory matrix; inspect
both themes or additional widths/platforms only when affected. If a final
correction is statically verifiable, confirm it from code and preserve prior
observations as historical evidence. If it materially changes the appearance
being judged, inspect only that affected state. Never assert old evidence is
a current screenshot.

Review the result against the user job and chosen design:
- Hierarchy: real content, density, primary and secondary actions.
- Actions: discoverability, destructive scope, accessibility and selected states.
- Craft: spacing, alignment, typography, clipping, contrast, safe areas,
  representative long content and affected responsive behavior.
- Outcome: actual improvement of the intended workflow, not superficial
  restyling or unrelated features.
- Behavior: use focused executable tests for material interactions, error
  recovery and persistence; screenshots alone cannot prove these.

For explicit automated acceptance only, use the existing CLI:
`launch auto` selects one representative target; `capture-plan` executes
the selected states in ignored `.flutter-harness/work/visual-plan.json`.
Example:

    {"platform":"ios","fixture":"isolated populated data","scenarios":[{"label":"final","kind":"screen","themes":["light"]}]}

A screen state may be captured from already inspected live UI without a script.
An actual interaction state needs a project-local Maestro or Playwright
scenario. Set `themes` to light, dark or both as needed; Web scenarios declare
`viewport`. An original baseline is optional and must be comparable if used.
Never erase real data to set up fixtures. The CLI validates the explicitly
selected current evidence for final delivery, not as admission to code review.
Do not declare --visual/--interaction for ordinary UI inspection. If required
runtime evidence is unavailable, state the actual limitation and offer a
draft rather than pretending acceptance or repeating tools. Owner decides
final aesthetic acceptance. No extra design reviewer or beauty score.
