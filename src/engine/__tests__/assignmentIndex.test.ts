/**
 * Indexed assignment lookups — issue #221.
 *
 * Verifies that CalendarEngine maintains resource→assignments and
 * event→assignments indexes across every mutation path, and that
 * lookup helpers match the semantics of the O(n) fallback scans.
 */
import { describe, it, expect } from 'vitest'
import { CalendarEngine } from '../CalendarEngine.js'
import { makeAssignment, type Assignment } from '../schema/assignmentSchema.js'

function a(id: string, eventId: string, resourceId: string, units = 100): Assignment {
  return makeAssignment(id, { eventId, resourceId, units })
}

describe('CalendarEngine — assignment indexes (#221)', () => {
  it('initial load populates both indexes', () => {
    const engine = new CalendarEngine({
      assignments: [
        a('A1', 'e1', 'r1'),
        a('A2', 'e1', 'r2'),
        a('A3', 'e2', 'r1'),
      ],
    })
    expect(engine.getAssignmentsForResource('r1').map(x => x.id).sort()).toEqual(['A1', 'A3'])
    expect(engine.getAssignmentsForResource('r2').map(x => x.id)).toEqual(['A2'])
    expect(engine.getAssignmentsForEvent('e1').map(x => x.id).sort()).toEqual(['A1', 'A2'])
    expect(engine.getAssignmentsForEvent('e2').map(x => x.id)).toEqual(['A3'])
  })

  it('returns an empty array when nothing matches', () => {
    const engine = new CalendarEngine({ assignments: [a('A1', 'e1', 'r1')] })
    expect(engine.getAssignmentsForResource('ghost')).toEqual([])
    expect(engine.getAssignmentsForEvent('ghost')).toEqual([])
  })

  it('upsertAssignment updates the index incrementally', () => {
    const engine = new CalendarEngine({
      assignments: [a('A1', 'e1', 'r1', 50)],
    })
    engine.upsertAssignment(a('A1', 'e1', 'r2', 50)) // resource changed from r1 → r2
    expect(engine.getAssignmentsForResource('r1')).toEqual([])
    expect(engine.getAssignmentsForResource('r2').map(x => x.id)).toEqual(['A1'])
  })

  it('upsertAssignment with a new id adds to index', () => {
    const engine = new CalendarEngine({ assignments: [a('A1', 'e1', 'r1')] })
    engine.upsertAssignment(a('A2', 'e1', 'r1'))
    expect(engine.getAssignmentsForResource('r1').map(x => x.id).sort()).toEqual(['A1', 'A2'])
  })

  it('removeAssignment drops the id from both indexes', () => {
    const engine = new CalendarEngine({
      assignments: [
        a('A1', 'e1', 'r1'),
        a('A2', 'e1', 'r1'),
      ],
    })
    engine.removeAssignment('A1')
    expect(engine.getAssignmentsForResource('r1').map(x => x.id)).toEqual(['A2'])
    expect(engine.getAssignmentsForEvent('e1').map(x => x.id)).toEqual(['A2'])
  })

  it('removeAssignment on an unknown id is a no-op', () => {
    const engine = new CalendarEngine({ assignments: [a('A1', 'e1', 'r1')] })
    engine.removeAssignment('ghost')
    expect(engine.getAssignmentsForResource('r1').map(x => x.id)).toEqual(['A1'])
  })

  it('setAssignments rebuilds indexes wholesale', () => {
    const engine = new CalendarEngine({
      assignments: [a('A1', 'e1', 'r1'), a('A2', 'e2', 'r1')],
    })
    engine.setAssignments([a('A3', 'e3', 'r2')])
    expect(engine.getAssignmentsForResource('r1')).toEqual([])
    expect(engine.getAssignmentsForResource('r2').map(x => x.id)).toEqual(['A3'])
    expect(engine.getAssignmentsForEvent('e1')).toEqual([])
    expect(engine.getAssignmentsForEvent('e3').map(x => x.id)).toEqual(['A3'])
  })

  it('reset() clears the index', () => {
    const engine = new CalendarEngine({ assignments: [a('A1', 'e1', 'r1')] })
    engine.reset()
    expect(engine.getAssignmentsForResource('r1')).toEqual([])
    expect(engine.getAssignmentsForEvent('e1')).toEqual([])
  })

  it('restoreState rebuilds index when assignments are included', () => {
    const engine = new CalendarEngine({ assignments: [a('A1', 'e1', 'r1')] })
    const newMap = new Map<string, Assignment>([['A9', a('A9', 'e9', 'r9')]])
    engine.restoreState({ assignments: newMap })
    expect(engine.getAssignmentsForResource('r1')).toEqual([])
    expect(engine.getAssignmentsForResource('r9').map(x => x.id)).toEqual(['A9'])
  })

  it('workloadForResource sums units via the index', () => {
    const engine = new CalendarEngine({
      assignments: [
        a('A1', 'e1', 'r1', 50),
        a('A2', 'e2', 'r1', 75),
        a('A3', 'e3', 'r2', 100),
      ],
    })
    expect(engine.workloadForResource('r1')).toBe(125)
    expect(engine.workloadForResource('r2')).toBe(100)
    expect(engine.workloadForResource('ghost')).toBe(0)
  })

  it('workloadForResource stays accurate through upsert + remove', () => {
    const engine = new CalendarEngine({
      assignments: [a('A1', 'e1', 'r1', 50)],
    })
    expect(engine.workloadForResource('r1')).toBe(50)
    engine.upsertAssignment(a('A1', 'e1', 'r1', 75)) // same id, bigger units
    expect(engine.workloadForResource('r1')).toBe(75)
    engine.upsertAssignment(a('A2', 'e2', 'r1', 25))
    expect(engine.workloadForResource('r1')).toBe(100)
    engine.removeAssignment('A1')
    expect(engine.workloadForResource('r1')).toBe(25)
  })

  it('getAssignmentsForResource results match a full-scan equivalent', () => {
    const all: Assignment[] = []
    for (let i = 0; i < 50; i++) all.push(a(`A${i}`, `e${i % 5}`, `r${i % 7}`, 100))
    const engine = new CalendarEngine({ assignments: all })

    for (let r = 0; r < 7; r++) {
      const idx = engine.getAssignmentsForResource(`r${r}`).map(x => x.id).sort()
      const expected = all.filter(x => x.resourceId === `r${r}`).map(x => x.id).sort()
      expect(idx).toEqual(expected)
    }
  })
})
