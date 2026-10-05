import type { AccountingPeriod } from '../models/room';

/**
 * Pure helpers for accounting periods.
 *
 * A period is a date-bounded window of a room's ledger. The database is the
 * authority — it rejects overlaps and a second open period — but mirroring the
 * same rules here lets the UI explain the problem before a round trip fails.
 *
 * Every rule below is deliberately duplicated from the SQL migration. When one
 * side changes, change the other; they are two layers of one rule, not two
 * rules.
 */

/** The database's limits, restated as constants the forms and tests can read. */
export const PERIOD_NAME_MAX = 60;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface PeriodDraft {
  name: string;
  startsOn: string;
  endsOn: string;
}

export type PeriodValidation =
  | { ok: true; value: { name: string; startsOn: string; endsOn: string } }
  | { ok: false; errors: Record<string, string> };

/** True when the string is a real calendar day in YYYY-MM-DD form. */
export function isIsoDay(value: string): boolean {
  if (!ISO_DAY.test(value)) return false;

  const [year, month, day] = value.split('-').map(Number);
  // Rejects 2026-02-30 and friends by round-tripping through a Date.
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/**
 * True when two inclusive date ranges share at least one day.
 *
 * Touching ranges do not overlap: January ending the 31st and February starting
 * the 1st are adjacent, not overlapping. Half-open comparison is exactly what
 * the `daterange &&` operator in the migration's exclusion constraint does.
 */
export function rangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** True when `date` falls inside the period, inclusive of both endpoints. */
export function isDateInPeriod(date: string, period: AccountingPeriod): boolean {
  return date >= period.starts_on && date <= period.ends_on;
}

/**
 * The period containing `date`, or null.
 *
 * Periods cannot overlap, so at most one can ever match and no disambiguation
 * is needed.
 */
export function findPeriodForDate(
  periods: AccountingPeriod[],
  date: string
): AccountingPeriod | null {
  return periods.find((period) => isDateInPeriod(date, period)) ?? null;
}

/** Sorts periods oldest first, which is the order they are displayed in. */
export function sortPeriods(periods: AccountingPeriod[]): AccountingPeriod[] {
  return [...periods].sort((a, b) => a.starts_on.localeCompare(b.starts_on));
}

/**
 * Validates a new period against the periods that already exist.
 *
 * Returns every problem at once rather than the first, so the form can mark all
 * offending fields in a single pass.
 */
export function validatePeriodDraft(
  draft: PeriodDraft,
  existing: AccountingPeriod[]
): PeriodValidation {
  const errors: Record<string, string> = {};
  const name = draft.name.trim();

  if (!name) {
    errors.name = 'Name this period.';
  } else if (name.length > PERIOD_NAME_MAX) {
    errors.name = `Keep the name under ${PERIOD_NAME_MAX} characters.`;
  }

  if (!draft.startsOn) {
    errors.startsOn = 'Choose a start date.';
  } else if (!isIsoDay(draft.startsOn)) {
    errors.startsOn = 'That is not a valid date.';
  }

  if (!draft.endsOn) {
    errors.endsOn = 'Choose an end date.';
  } else if (!isIsoDay(draft.endsOn)) {
    errors.endsOn = 'That is not a valid date.';
  }

  // Only compare the two dates when both are real, or a typo in the start date
  // would be reported as "ends before it starts", which is not the real problem.
  const bothDatesValid =
    !errors.startsOn &&
    !errors.endsOn &&
    isIsoDay(draft.startsOn) &&
    isIsoDay(draft.endsOn);

  if (bothDatesValid && draft.endsOn < draft.startsOn) {
    errors.endsOn = 'The end date cannot be before the start date.';
  }

  if (bothDatesValid && !errors.endsOn) {
    const clash = existing.find((period) =>
      rangesOverlap(draft.startsOn, draft.endsOn, period.starts_on, period.ends_on)
    );
    if (clash) {
      errors.endsOn = `These dates overlap “${clash.name}”. Periods cannot overlap.`;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, startsOn: draft.startsOn, endsOn: draft.endsOn } };
}

/**
 * True when the room already has a period still open.
 *
 * The database allows exactly one open period per room, so the form refuses to
 * offer a second one rather than letting the request fail.
 */
export function hasOpenPeriod(periods: AccountingPeriod[]): boolean {
  return periods.some((period) => period.status === 'open');
}
