import type { RoomExport } from '../models/room';
import { formatCents } from './money';
import { formatDate } from './formatters';

/**
 * Builds the downloadable CSV for a room's ledger over a date range.
 *
 * Plain RFC 4180 CSV, deliberately: it opens in Excel, Numbers, Sheets and
 * LibreOffice without a prompt, and needs no library.
 *
 * Money is written in whole major units (`450.00`) rather than paise, because a
 * reader opening a spreadsheet wants rupees, not `45000`. The header states the
 * currency so the file is never ambiguous.
 */

/**
 * Quotes a field if it contains a delimiter, a quote, or a newline, and
 * doubles any embedded quotes. Leading characters that a spreadsheet would
 * treat as a formula are prefixed with a quote so a note like `=1+1` is not
 * executed on open.
 */
export function escapeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';

  const text = String(value);
  // A leading =, +, - or @ is how CSV injection works.
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;

  if (/[",\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

/** Joins one row, escaping each cell. */
export function toCsvRow(cells: Array<string | number | null | undefined>): string {
  return cells.map(escapeCsvField).join(',');
}

/**
 * Renders a whole export as one CSV document.
 *
 * The document is a summary block followed by two flat tables. Flat tables
 * matter: a spreadsheet that can be filtered and sorted is worth far more to a
 * treasurer auditing a month than a pretty single merged table.
 */
export function buildRoomExportCsv(data: RoomExport): string {
  const { room, range, contributions, expenses, summary } = data;
  const lines: string[] = [];

  const section = (title: string, rows: string[][]) => {
    lines.push('');
    lines.push(toCsvRow([title]));
    for (const row of rows) lines.push(toCsvRow(row));
  };

  lines.push(toCsvRow([`${room.name} — ledger export`]));
  lines.push(toCsvRow(['Currency', room.currency]));
  lines.push(toCsvRow(['From', range.from]));
  lines.push(toCsvRow(['To', range.to]));

  section('Summary', [
    ['Contributions', toMajor(summary.contributions_cents)],
    ['Common expenses', toMajor(summary.common_expenses_cents)],
    ['Personal expenses', toMajor(summary.personal_expenses_cents)],
    ['Reimbursements paid', toMajor(summary.reimbursed_cents)],
    ['Available', toMajor(summary.available_cents)],
    ['Pending liability', toMajor(summary.pending_liability_cents)],
  ]);

  section('Contributions', [
    ['Date', 'Member', 'Amount', 'Method', 'Note', 'Voided'],
    ...contributions.map((row) => [
      row.contributed_on,
      row.display_name,
      toMajor(row.amount_cents),
      row.method ?? '',
      row.note ?? '',
      row.voided_at ? `voided: ${row.void_reason ?? 'no reason'}` : '',
    ]),
  ]);

  section('Expenses', [
    ['Date', 'Paid by', 'Description', 'Category', 'Source', 'Amount', 'Reimbursement', 'Reimbursed on', 'Note', 'Voided'],
    ...expenses.map((row) => [
      row.spent_on,
      row.paid_by,
      row.description,
      row.category,
      row.payment_source,
      toMajor(row.amount_cents),
      row.reimbursement_status ?? '',
      row.reimbursed_on ?? '',
      row.note ?? '',
      row.voided_at ? `voided: ${row.void_reason ?? 'no reason'}` : '',
    ]),
  ]);

  // Trailing newline: some tools drop the last row without it.
  return `${lines.join('\n')}\n`;
}

/**
 * Renders a full amount in major units, without a currency symbol.
 *
 * Amounts are integers in paise, so this never touches a float fraction that
 * could reintroduce the rounding drift the schema avoids.
 */
function toMajor(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Triggers a browser download of `text` as a CSV file.
 *
 * The object URL is revoked on the next tick; revoking it synchronously can
 * cancel the download in some browsers.
 */
export function downloadCsv(filename: string, text: string): void {
  const blob = new Blob([`\uFEFF${text}`], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** A filesystem-safe filename such as `flat-2026-09-01-to-2026-09-30.csv`. */
export function exportFilename(roomName: string, from: string, to: string): string {
  const slug =
    roomName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'room';
  return `${slug}-${from}-to-${to}.csv`;
}

/** Human summary line shown above the export button. */
export function describeExportRange(data: RoomExport): string {
  return `${formatDate(data.range.from)} – ${formatDate(data.range.to)} · ${formatCents(
    data.summary.available_cents,
    data.room.currency
  )} available`;
}
