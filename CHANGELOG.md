# Changelog

All notable changes to `works-calendar-engine` are documented here. This
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0]

Initial extraction. The engine ships as the framework-agnostic scheduling
state machine carved out of the `works-calendar` monolith — pure
TypeScript, only runtime dep is `date-fns`.

### Added

- `CalendarEngine` — Map-based immutable state container with typed
  mutations, transactions, and pub/sub subscriptions.
- `EventBus` — microtask-queued, error-isolated lifecycle pub/sub.
- `UndoRedoManager` — full structural snapshots; restores pool/round-robin
  state on undo.
- `evaluateConflicts` with 8 built-in rule types (resource-overlap,
  category-mutex, min-rest, capacity-overflow, outside-business-hours,
  availability-violation, hold-conflict, policy-violation).
- `evaluateAvailability`, `evaluateRequirements`, `resolvePool`,
  `findBlockingHold` for the surrounding scheduling decisions.
- Schedule-kind domain model (`SHIFT`, `ON_CALL`, `OPEN_SHIFT`,
  `COVERING`) with normalization + predicates.
- Recurrence expansion (`expandOccurrences`, `expandRRule`) — RFC 5545
  RRULE subset (FREQ, INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY, BYMONTH,
  EXDATE).
- Approval state-machine reducer (`transitionApproval`, `LEGAL_TRANSITIONS`)
  + hash-chained audit log (`appendAuditEntry`, `verifyAuditChain`).
- Boundary helpers: `normalizeEvent`, `createId`.
