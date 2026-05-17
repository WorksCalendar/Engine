import type { NormalizedEvent } from './types/events.js'
import type { SortConfig } from './types/grouping.js'

function extractValue(event: NormalizedEvent, config: SortConfig): unknown {
  if (config.getValue) return config.getValue(event)
  const direct = (event as unknown as Record<string, unknown>)[config.field]
  if (direct !== undefined && direct !== null) return direct
  return (event.meta as Record<string, unknown> | undefined)?.[config.field] ?? null
}

function compareValues(a: unknown, b: unknown, direction: 'asc' | 'desc'): number {
  // Nulls always sort last regardless of direction
  if (a === null || a === undefined) {
    if (b === null || b === undefined) return 0
    return 1
  }
  if (b === null || b === undefined) return -1

  let result: number
  if (a instanceof Date && b instanceof Date) {
    result = a.getTime() - b.getTime()
  } else if (typeof a === 'number' && typeof b === 'number') {
    result = a - b
  } else if (typeof a === 'boolean' && typeof b === 'boolean') {
    result = (a ? 1 : 0) - (b ? 1 : 0)
  } else {
    result = String(a).localeCompare(String(b), undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  }

  return direction === 'asc' ? result : -result
}

/**
 * Sort an event array by one or more fields. Each config acts as a tiebreaker
 * for the previous. Returns a new array; original is not mutated.
 */
export function sortEvents(
  events: NormalizedEvent[],
  sortConfigs: SortConfig[],
): NormalizedEvent[] {
  if (!sortConfigs.length) return events
  return [...events].sort((a, b) => {
    for (const config of sortConfigs) {
      const av = extractValue(a, config)
      const bv = extractValue(b, config)
      const cmp = compareValues(av, bv, config.direction)
      if (cmp !== 0) return cmp
    }
    return 0
  })
}

/**
 * Sort group keys as strings. (Ungrouped) always sorts last.
 */
export function sortGroupKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    if (a === '(Ungrouped)') return 1
    if (b === '(Ungrouped)') return -1
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  })
}
