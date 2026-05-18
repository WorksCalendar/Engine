# Changelog

All notable changes to `works-calendar-engine` are documented here. This
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1]

Expanded the public API surface to cover everything a real consumer
needs. `0.1.0` shipped with a deliberately small (39 export) surface;
this release wildcard-exports each engine module so consumers don't
have to deep-import. No code changes — just additional re-exports.

### Added

- All `engine/operations/*` symbols (`applyOperation`, `safeMutate`,
  `resolveOperationScope`, full `OperationResult`/`OperationStatus`/
  `EventChange`/`OperationSource`/`RecurringEditScope` types).
- All `engine/adapters/*` symbols (`normalizeInputEvent`,
  `normalizeInputEvents`, `nextEngineId`, `RawInputEvent`,
  `fromLegacyEvent`, `fromLegacyEvents`, `toLegacyEvent`,
  `toLegacyEvents`, `occurrenceToLegacy`, `LegacyEvent`,
  `LegacyEventOut`).
- All `engine/validation/*` symbols (`validateOperation`,
  `isOperationAllowed`, `validateEvent`, `validateConstraints`, etc.).
- All `engine/recurrence/*` symbols (`expandRecurrenceSafe`,
  `recurrenceMath` helpers, `resolveRecurringEdit`, `detachOccurrence`,
  `splitSeries`, `BUILT_IN_EVENT_TEMPLATES`).
- All `engine/selectors/*`, `engine/transactions/*` symbols.
- All `engine/time/*` (`formatInTimezone`, `tzOffsetLabel`,
  `hoursInTimezone`, `localTimezone`, full date math).
- All `engine/eventBus.js` types (`EventBusChannel`, `BookingChannel`,
  `AssignmentChannel`, `BookingLifecyclePayload`,
  `AssignmentLifecyclePayload`, `EventBusPayload`, `EventBusHandler`,
  `EventBusOptions`, `EventBusUnsubscribe`).
- `conflicts/geoConflictRules.js` full (`evaluateGeoConflicts`,
  `geoConflictRules`, `GeoConflictRule`, `GeoTravelFeasibilityRule`,
  `GeoEventInput`, `GeoConflictViolation`).
- `conflictEngine.js` full (`ConflictEvaluationResult`,
  `EvaluateConflictsInput`).
- `pools/*` full — pool query DSL (`ResourceQuery`,
  `ResourceQueryValue`, `DistanceFrom`, `PoolType`), `evaluateQuery`,
  `LatLon`, `haversineKm`/`Miles`, `isLatLon`, location adapters.
- `geo/*` full (`GeoPoint`, `ResourceTrackingMeta`,
  `AssetTrackerPosition`, `isValidPosition`,
  `positionToResourceTrackingMeta`, `haversineDistanceKm`).
- `approvals/sha256.js` (`sha256Hex`).
- `availability/availabilityRule.js`, `requirements/requirementTypes.js`,
  `requirements/gateEventRequirements.js`, `tenancy/tenantScope.js`,
  `scheduleMutations.js`.

### Notes

- `EventStatus` is now sourced from the schema (`engine/schema/eventSchema`)
  rather than `types/events` to avoid duplicate-export ambiguity. The
  two definitions are byte-identical; consumers won't notice.
- `engine/schema/resourcePoolSchema` is a re-export shim of
  `pools/resourcePoolSchema`; the index now points at the canonical
  pool module to avoid the same kind of ambiguity.

### Verified

- 61 test files / 1315 tests still pass.
- Engine public surface: 191 exports (was 39).
- Local end-to-end check: a consumer that pulls in 200+ engine symbols
  type-checks and tests clean against this build.

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
