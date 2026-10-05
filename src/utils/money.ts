import { CURRENCY_CODE, formatCurrency } from './formatters';

/**
 * Money helpers for the shared-room fund.
 *
 * Every amount in the Supabase schema is stored as an integer number of minor
 * units ("cents"). Conversions happen only at the UI boundary, and always via
 * `Math.round`, so floating-point error can never accumulate in a balance.
 */

/** Converts a user-entered major-unit amount (e.g. 12.34) to integer cents. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Converts integer cents to major units for display or input fields. */
export function toMajorUnits(cents: number): number {
  return Math.round(cents) / 100;
}

/** Formats integer cents as Indian Rupees (₹). */
export function formatCents(cents: number, currencyCode = CURRENCY_CODE): string {
  return formatCurrency(toMajorUnits(cents), currencyCode);
}

// ---------------------------------------------------------------------------
// Balance arithmetic
//
// The single most important rule in the app lives here:
//
//     available = contributions − common expenses − reimbursements paid
//
// and NOT `− pending claims`. A pending claim is money the room still holds but
// owes; subtracting it would double-count the same outflow the moment the
// reimbursement is settled, and would make the fund look poorer than it is.
// ---------------------------------------------------------------------------

/** The stored totals a balance is computed from. */
export interface BalanceParts {
  totalContributionsCents: number;
  totalCommonExpensesCents: number;
  totalReimbursedCents: number;
  pendingLiabilityCents: number;
}

export interface DerivedBalance {
  /** Cash physically in the pot. */
  fundCashCents: number;
  /**
   * What the treasurer may spend. Deliberately identical to `fundCashCents`;
   * exposed separately because the UI labels them differently and conflating
   * them is the mistake this module exists to prevent.
   */
  availableBalanceCents: number;
  /** Owed out but not yet sent. A liability, never subtracted. */
  pendingLiabilityCents: number;
  /** True when payouts have outrun contributions. */
  isOverdrawn: boolean;
}

/** Adds integer cents. Every input must already be an integer. */
export function sumCents(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * Derives the room balance from its parts.
 *
 * Mirrors the `room_fund_balance` view so the two can be cross-checked in
 * tests, and so a component can compute a local figure without a round trip.
 */
export function deriveBalance(parts: BalanceParts): DerivedBalance {
  const fundCashCents =
    parts.totalContributionsCents -
    parts.totalCommonExpensesCents -
    parts.totalReimbursedCents;

  return {
    fundCashCents,
    availableBalanceCents: fundCashCents,
    pendingLiabilityCents: parts.pendingLiabilityCents,
    isOverdrawn: fundCashCents < 0,
  };
}

/**
 * A settlement is only affordable when the pot can cover it without going
 * negative. Matches the guard in `mark_reimbursement_paid`.
 */
export function canSettle(
  availableBalanceCents: number,
  amountCents: number
): boolean {
  return availableBalanceCents >= amountCents;
}
