import { formatCurrency } from './formatters';

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

/** Formats integer cents using the room's currency symbol. */
export function formatCents(cents: number, currencySymbol = '$'): string {
  return formatCurrency(toMajorUnits(cents), currencySymbol);
}
