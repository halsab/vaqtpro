# Product behavior contract

A green test suite can enforce the wrong product decision. Specify the intended
behavior before code or visual concepts, in proportion to the actual change.

## Smallest useful specification

- Trivial text/style/wiring or an isolated bug with an obvious expected result:
  identify the result and regression case in context. No new document or agent.
- Material business rule, interacting controls, consequential writes, new
  screen or redesign: write/update one compact feature contract in the existing
  specification or docs/product/<feature>.md. Keep durable rules, not a diary.
- Multiple independent behaviors or a foundational migration: establish
  dependencies and independently verifiable slices. Do not bundle unrelated
  refactoring with product behavior.

Inspect relevant existing code, tests and product requirements. Distinguish
current behavior, desired change and what must remain. Existing behavior is
evidence, not automatically the desired product. Resolve reversible routine
decisions autonomously; ask only about consequential unresolved ambiguity.
Do not invent product data, brand, functionality or navigation.

## Contract

Use only applicable items; approximately one page for a small feature, not
a word quota. Replace vague adjectives with observable outcomes.

1. Intent/scope: primary user job, desired outcome, exclusions.
2. State/rules: initial values, valid options, independent vs dependent state,
   source of truth, what persists/resets, identity, order and tie rules.
3. Transitions: action + precondition -> result and retained state.
   Include interaction with existing functions and navigation.
4. Invariants/failures: what is always true; empty data vs empty results,
   validation, loading, errors, retry and concurrency where meaningful.
   Specify what is preserved on failure and how recovery avoids duplicate work.
5. Acceptance examples: concrete small datasets and exact outcomes; map material
   rules to existing tests, focused unit/widget tests or actual visual inspection.
   Do not test every static detail or duplicate evidence across levels.

Challenge the contract once before implementation:
- Does changing one control unexpectedly reset another or remove content?
- Is the selected mode visible? Can users understand missing results, recover,
  and predict which records a destructive action affects?
- What happens at zero, one, duplicates, long values, failure, repeated action,
  or back/reopen where it matters?
- Could all proposed examples pass while the requested behavior is still wrong?

Resolve actual contradictions, not just add checklist words. Choose visual
concepts from these rules. If new evidence changes the contract, record why
and update affected acceptance examples before implementing the revision.
Never rewrite expectations just to make a failing test green.

## Worked example: grouped task sorting

Illustrative, not a universal rule for all products. Goal: order tasks without
losing active/completed distinction. Existing records have stable ID, title,
completion and append order. No new timestamp or schema migration.

- All/Active/Completed scope, trimmed case-insensitive title query, order
  By addition (oldest first), Title A–Z, Title Z–A. Initial All, empty query,
  By addition; these view settings are session state in this example.
- All always shows active above completed, omitting empty groups. Scope and
  search select records; order is applied within each status group. Use existing
  title comparison (specify locale collation if required). Equal keys retain
  stored order in both directions. Never reorder persisted data for a view.
- Display selected sort criterion and direction, menu selection and accessible
  label. Update the relevant icon/direction. No undefined "Default" mode.
  Changing sort never clears query or scope; changing scope retains sort.
- Completion moves a row into its new group (or out of scope). Renaming can
  reposition it or remove a query match. New/duplicated task is a distinct
  active record appended to storage. If success is hidden by the view, explain
  it and offer an explicit way to show the result without silently resetting
  settings. Unfinished count always covers all stored tasks.
- Failed writes retain saved state; keep draft input and retry. Bulk deletion
  has explicit scope and confirmation; sorting cannot affect deletion scope.

Seed in stored order: B(active), E(completed), A(active), F(completed),
C(active), D(completed). Neither group's stored order is alphabetical.

| Action / starting state | Expected result | Evidence |
| --- | --- | --- |
| All, By addition | Active B,A,C; Completed E,F,D; count 3 | Unit + widget |
| Select Title A–Z | Active A,B,C; Completed D,E,F | Unit |
| Select Title Z–A | Active C,B,A; Completed F,E,D | Unit |
| A–Z: select Completed, then All | D,E,F only; then A,B,C / D,E,F; order retained | Unit/widget |
| All, A–Z: query D, then clear | Completed D only; then A,B,C / D,E,F; count 3 | Unit/widget |
| A–Z: complete A | Active B,C; Completed A,D,E,F; count 2 | Unit + persistence evidence |
| Equal titles, distinct IDs | Both remain; ties keep stored order both directions | Unit |
| Reject completion write and reload | Original IDs, statuses and stored order unchanged | Repository/VM |
| Change sort under query/filter | Selected criterion visible, grouping and matching remain | Widget |
| Query nonexistent title | No-results, not empty-store onboarding; clear restores view | Widget |

One parameterized test can cover several rows. Reuse existing meaningful tests.
A test expecting All to become a flat list on A–Z would violate this contract,
even if the code and test agree. Other products may legitimately link grouping
to order; make that relationship an explicit product decision.

## Acceptance

Compare original request, contract, actual behavior and evidence. A required
independent reviewer also challenges the contract itself for omissions or
contradictions. No extra reviewer or user approval just for a specification.
