# fullcalendar-bridge

Drop the engine **underneath** FullCalendar. FullCalendar still handles
every pixel; the engine handles every decision.

- FullCalendar renders, drags, drops, resizes
- `eventDrop` / `eventResize` callbacks intercept the change
- The diff is run through `evaluateConflicts`
- If a rule violates, `arg.revert()` snaps the event back

You don't have to replace your calendar to get validation. You add this
underneath the calendar you already shipped.

## Run

```bash
# from the engine package root:
npm install && npm run build
cd examples/fullcalendar-bridge
npm install
npm run dev
```

Drag any event to overlap another on the same resource — the engine
rejects it and a red banner explains why.
