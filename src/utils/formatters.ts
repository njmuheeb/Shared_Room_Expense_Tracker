/**
 * Formats a numeric amount with the chosen currency symbol and 2 decimals.
 */
export function formatCurrency(amount: number, currencySymbol: string = '$'): string {
  const absFormatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount));

  return amount < 0
    ? `-${currencySymbol}${absFormatted}`
    : `${currencySymbol}${absFormatted}`;
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
