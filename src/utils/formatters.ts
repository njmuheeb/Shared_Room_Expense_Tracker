/** Default currency for the whole app. */
export const CURRENCY_CODE = 'INR';
/** Locale that renders Indian digit grouping and the ₹ symbol. */
export const CURRENCY_LOCALE = 'en-IN';
/** Rupee sign, for compact labels such as form field captions. */
export const CURRENCY_SYMBOL = '₹';

/**
 * Formats a numeric amount as Indian Rupees using the `en-IN` locale.
 *
 * Uses `Intl.NumberFormat` currency formatting, so grouping and the symbol
 * follow Indian conventions: ₹0.00, ₹1,000.00, ₹1,00,000.00.
 *
 * `currencyCode` is an ISO 4217 code (e.g. "INR") and exists for callers that
 * need a different currency; the app defaults to INR everywhere.
 */
export function formatCurrency(
  amount: number,
  currencyCode: string = CURRENCY_CODE
): string {
  return new Intl.NumberFormat(CURRENCY_LOCALE, {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Formats an ISO date string (YYYY-MM-DD) into a clean, human-friendly format.
 * E.g., "2026-09-15" -> "Sep 15, 2026"
 */
export function formatDate(dateString: string): string {
  if (!dateString) return '';
  const [year, month, day] = dateString.split('-').map(Number);
  if (!year || !month || !day) return dateString;

  const date = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

/**
 * Returns today's date as a local ISO day string (YYYY-MM-DD).
 * Uses local time deliberately so a late-evening entry is not dated tomorrow.
 */
export function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Returns a human-friendly relative label when applicable.
 */
export function getRelativeDateLabel(dateString: string): string {
  if (!dateString) return '';
  const today = new Date();
  const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayString = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

  if (dateString === todayString) return 'Today';
  if (dateString === yesterdayString) return 'Yesterday';
  return formatDate(dateString);
}
