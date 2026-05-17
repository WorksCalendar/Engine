/**
 * RRULE expansion — extracted from the monolith's ICS parser so the engine
 * can expand recurring events without dragging the rest of the iCal parser
 * along. Handles FREQ, INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY, BYMONTH,
 * and EXDATE.
 *
 * No external dependencies.
 */

const DAYS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

type ByDay = { n: number | null; day: number };

function parseICSDate(str: string | null | undefined): Date | null {
  if (!str) return null;
  const s = str.trim();
  if (s.length === 8) {
    return new Date(
      parseInt(s.slice(0, 4), 10),
      parseInt(s.slice(4, 6), 10) - 1,
      parseInt(s.slice(6, 8), 10),
    );
  }
  const y  = parseInt(s.slice(0, 4), 10);
  const mo = parseInt(s.slice(4, 6), 10) - 1;
  const d  = parseInt(s.slice(6, 8), 10);
  const h  = parseInt(s.slice(9, 11), 10);
  const mi = parseInt(s.slice(11, 13), 10);
  const sc = parseInt(s.slice(13, 15), 10) || 0;
  return s.endsWith('Z')
    ? new Date(Date.UTC(y, mo, d, h, mi, sc))
    : new Date(y, mo, d, h, mi, sc);
}

function parseRRule(str: string): Record<string, string> {
  const rule: Record<string, string> = {};
  str.split(';').forEach(part => {
    const eq = part.indexOf('=');
    if (eq > 0) rule[part.slice(0, eq)] = part.slice(eq + 1);
  });
  return rule;
}

function dayKey(dt: Date): string {
  return `${dt.getFullYear()}-${dt.getMonth() + 1}-${dt.getDate()}`;
}

/**
 * Expand a recurring rule into concrete start dates within [rangeStart, rangeEnd].
 * Returns sorted array of Date objects.
 */
export function expandRRule(
  dtstart: Date,
  rruleStr: string,
  exdates: Date[] | null | undefined,
  rangeStart: Date,
  rangeEnd: Date,
): Date[] {
  const rule     = parseRRule(rruleStr);
  const freq     = rule['FREQ'];
  if (!freq) return [new Date(dtstart)];

  const interval = parseInt(rule['INTERVAL'] || '1', 10);
  const maxCount = rule['COUNT'] ? parseInt(rule['COUNT'], 10) : 500;
  const until    = rule['UNTIL'] ? parseICSDate(rule['UNTIL']) : null;
  const ceiling  = until
    ? new Date(Math.min(until.getTime(), rangeEnd.getTime()))
    : new Date(rangeEnd);

  const byDays: ByDay[] | null = rule['BYDAY']
    ? rule['BYDAY'].split(',').map(s => {
        const m = s.match(/^([+-]?\d*)([A-Z]{2})$/);
        if (!m || m[2] === undefined) return null;
        const day = DAYS[m[2]];
        if (day === undefined) return null;
        return { n: m[1] ? parseInt(m[1], 10) : null, day };
      }).filter((bd): bd is ByDay => bd !== null)
    : null;

  const byMonthDays: number[] | null = rule['BYMONTHDAY'] ? rule['BYMONTHDAY'].split(',').map(Number) : null;
  const byMonths: number[] | null    = rule['BYMONTH']    ? rule['BYMONTH'].split(',').map(Number) : null;

  const exSet = new Set((exdates || []).map(d => dayKey(d)));

  const results: Date[] = [];
  let count = 0;
  let period = new Date(dtstart);

  for (let iter = 0; iter < 2000 && period <= ceiling && count < maxCount; iter++) {
    const candidates = getCandidatesForPeriod(period, freq, byDays, byMonthDays, byMonths, dtstart);

    for (const c of candidates) {
      if (c < dtstart || c > ceiling) continue;
      if (exSet.has(dayKey(c))) continue;
      if (c >= rangeStart) {
        results.push(new Date(c));
        count++;
        if (count >= maxCount) break;
      }
    }

    period = advancePeriod(period, freq, interval);
  }

  return results.sort((a, b) => a.getTime() - b.getTime());
}

function getCandidatesForPeriod(
  period: Date,
  freq: string,
  byDays: ByDay[] | null,
  byMonthDays: number[] | null,
  byMonths: number[] | null,
  dtstart: Date,
): Date[] {
  if (!byDays && !byMonthDays) {
    if (byMonths && !byMonths.includes(period.getMonth() + 1)) return [];
    return [new Date(period)];
  }

  const hms: [number, number, number] = [dtstart.getHours(), dtstart.getMinutes(), dtstart.getSeconds()];

  if (freq === 'WEEKLY' && byDays) {
    const weekSun = new Date(period);
    weekSun.setDate(weekSun.getDate() - weekSun.getDay());
    return byDays.map(bd => {
      const c = new Date(weekSun);
      c.setDate(weekSun.getDate() + bd.day);
      c.setHours(...hms, 0);
      return c;
    });
  }

  if (freq === 'MONTHLY') {
    if (byMonthDays) {
      return byMonthDays.flatMap(md => {
        const c = new Date(period.getFullYear(), period.getMonth(), md, ...hms, 0);
        return c.getMonth() === period.getMonth() ? [c] : [];
      });
    }
    if (byDays) {
      return byDays.flatMap(bd => nthWeekdayOfMonth(period.getFullYear(), period.getMonth(), bd, hms));
    }
  }

  if (freq === 'YEARLY') {
    const months = byMonths ?? [period.getMonth() + 1];
    return months.flatMap(mo => {
      if (byDays) {
        return byDays.flatMap(bd => nthWeekdayOfMonth(period.getFullYear(), mo - 1, bd, hms));
      }
      return [new Date(period.getFullYear(), mo - 1, period.getDate(), ...hms, 0)];
    });
  }

  return [new Date(period)];
}

function nthWeekdayOfMonth(
  year: number,
  month: number,
  bd: ByDay,
  hms: [number, number, number],
): Date[] {
  if (bd.n === null) {
    const days: Date[] = [];
    const d = new Date(year, month, 1);
    while (d.getMonth() === month) {
      if (d.getDay() === bd.day) days.push(new Date(year, month, d.getDate(), ...hms, 0));
      d.setDate(d.getDate() + 1);
    }
    return days;
  }

  if (bd.n > 0) {
    const d = new Date(year, month, 1);
    let occ = 0;
    while (d.getMonth() === month) {
      if (d.getDay() === bd.day && ++occ === bd.n) {
        return [new Date(year, month, d.getDate(), ...hms, 0)];
      }
      d.setDate(d.getDate() + 1);
    }
    return [];
  }

  const last = new Date(year, month + 1, 0);
  let occ = 0;
  while (last.getMonth() === month) {
    if (last.getDay() === bd.day && ++occ === Math.abs(bd.n)) {
      return [new Date(year, month, last.getDate(), ...hms, 0)];
    }
    last.setDate(last.getDate() - 1);
  }
  return [];
}

function advancePeriod(dt: Date, freq: string, interval: number): Date {
  const next = new Date(dt);
  switch (freq) {
    case 'DAILY':   next.setDate(next.getDate() + interval);             break;
    case 'WEEKLY':  next.setDate(next.getDate() + 7 * interval);         break;
    case 'MONTHLY': next.setMonth(next.getMonth() + interval);           break;
    case 'YEARLY':  next.setFullYear(next.getFullYear() + interval);     break;
  }
  return next;
}
