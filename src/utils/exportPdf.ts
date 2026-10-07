import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { RoomExport } from '../models/room';
import { formatDate } from './formatters';
import { resolveCategory } from './constants';

// ---------------------------------------------------------------------------
// Page geometry (millimetres — jsPDF default unit)
// ---------------------------------------------------------------------------

const PAGE = {
  width: 210,
  height: 297,
  margin: 16,
  /** Vertical zone reserved for the footer on every page. */
  footerZone: 18,
  get contentWidth(): number {
    return this.width - this.margin * 2;
  },
  get contentLeft(): number {
    return this.margin;
  },
  get contentRight(): number {
    return this.width - this.margin;
  },
  get contentTop(): number {
    return this.margin;
  },
  /** Bottom limit for body content (above the footer). */
  get contentBottom(): number {
    return this.height - this.margin - this.footerZone;
  },
};

// ---------------------------------------------------------------------------
// Color palette
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

const C = {
  navy: [23, 33, 61] as RGB,
  charcoal: [45, 49, 60] as RGB,
  body: [55, 55, 65] as RGB,
  slate: [100, 108, 125] as RGB,
  rule: [210, 215, 225] as RGB,
  rowAlt: [247, 249, 252] as RGB,
  white: [255, 255, 255] as RGB,
  credit: [14, 116, 82] as RGB,
  debit: [185, 38, 38] as RGB,
  bg: [250, 251, 253] as RGB,
};

// ---------------------------------------------------------------------------
// Tiny helpers
// ---------------------------------------------------------------------------

function setFill(d: jsPDF, [r, g, b]: RGB): void {
  d.setFillColor(r, g, b);
}
function setTxt(d: jsPDF, [r, g, b]: RGB): void {
  d.setTextColor(r, g, b);
}
function setDraw(d: jsPDF, [r, g, b]: RGB): void {
  d.setDrawColor(r, g, b);
}

/** Horizontal rule. */
function hr(d: jsPDF, y: number, color: RGB = C.rule, weight = 0.3): void {
  setDraw(d, color);
  d.setLineWidth(weight);
  d.line(PAGE.contentLeft, y, PAGE.contentRight, y);
}

/** Format cents → ₹X,XXX.00 (Indian grouping). */
function inr(cents: number): string {
  const abs = Math.abs(cents);
  const n = (abs / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return cents < 0 ? `-₹${n}` : `₹${n}`;
}

/** Professional timestamp: "07 Oct 2026, 12:43 PM IST". */
function fmtTimestamp(v: Date | string): string {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
}

/** Period display: "Oct 1, 2026 → Present (Open)" or closed equivalent. */
function periodDisplay(data: RoomExport, meta: RoomExport['metadata']): string {
  const from = formatDate(data.range.from);
  const isOpen =
    meta?.periodStatus === 'OPEN' ||
    (meta?.spansMultiplePeriods &&
      data.range.to >= new Date().toISOString().slice(0, 10));
  const to = isOpen ? 'Present (Open)' : `${formatDate(data.range.to)} (Closed)`;
  return `${from}  →  ${to}`;
}

/** Ensures y is within page limits; if not, adds a new page and returns the
 *  new cursor (below the header). */
function ensureSpace(
  doc: jsPDF,
  y: number,
  needed: number,
): number {
  if (y + needed > PAGE.contentBottom) {
    doc.addPage();
    return PAGE.contentTop;
  }
  return y;
}

// ---------------------------------------------------------------------------
// Section drawers
// ---------------------------------------------------------------------------

/** Draw the top header band (navy bar with brand + statement title). */
function drawHeader(doc: jsPDF, statementId: string): number {
  const y = PAGE.contentTop;
  const bandH = 22;

  // Navy band
  setFill(doc, C.navy);
  doc.rect(PAGE.contentLeft, y, PAGE.contentWidth, bandH, 'F');

  // Brand left
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  setTxt(doc, C.white);
  doc.text('ROOMFUND', PAGE.contentLeft + 6, y + 9);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('Shared Room Expense Tracker', PAGE.contentLeft + 6, y + 15);

  // Title right
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('EXPENSE STATEMENT', PAGE.contentRight - 6, y + 9, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(`Statement ID: ${statementId}`, PAGE.contentRight - 6, y + 15, {
    align: 'right',
  });

  return y + bandH + 6;
}

/** Draw room / period / member / exporter / approval info.  Returns cursor Y. */
function drawStatementInfo(
  doc: jsPDF,
  data: RoomExport,
  startY: number,
  meta: RoomExport['metadata'],
): number {
  let y = startY;

  // --- Section title ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  setTxt(doc, C.navy);
  doc.text('STATEMENT INFORMATION', PAGE.contentLeft, y);
  y += 2;
  hr(doc, y, C.navy, 0.5);
  y += 5;

  // Helper to draw a label–value pair
  const lineH = 4.5;
  const labelX = PAGE.contentLeft + 1;
  const valX = PAGE.contentLeft + 42;

  const pair = (label: string, value: string): void => {
    y = ensureSpace(doc, y, lineH + 1);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    setTxt(doc, C.slate);
    doc.text(label, labelX, y);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    setTxt(doc, C.charcoal);
    // Wrap long values
    const maxW = PAGE.contentRight - valX - 2;
    const lines: string[] = doc.splitTextToSize(value, maxW);
    doc.text(lines, valX, y);
    y += lineH * Math.max(lines.length, 1);
  };

  const code = data.room.join_code ?? '';
  pair('Room', `${data.room.name}${code ? ` [${code}]` : ''}`);

  // Period name
  const scopeLabel = meta?.periodName
    ? `${meta.periodName} (${meta.periodStatus ?? 'OPEN'})`
    : meta?.spansMultiplePeriods
      ? 'Custom Date Range (spans multiple periods)'
      : 'Custom Date Range';
  pair('Period', scopeLabel);
  pair('Date Range', periodDisplay(data, meta));
  pair('Currency', `${data.room.currency} (₹)`);

  // Exporter
  const exporterName = meta?.exportedBy?.name ?? 'Room Member';
  const exporterRole = meta?.exportedBy?.role ? ` (${meta.exportedBy.role})` : '';
  pair('Exported By', `${exporterName}${exporterRole}`);
  pair('Exported On', fmtTimestamp(meta?.exportedAt ?? new Date()));

  // Approval
  y += 3;
  const isApproved = meta?.adminApproval?.status === 'DIGITALLY APPROVED';
  if (isApproved && meta?.adminApproval?.approvedBy) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    setTxt(doc, C.slate);
    doc.text('ADMIN APPROVAL', labelX, y);
    y += lineH;

    pair('Approved By', meta.adminApproval.approvedBy);
    pair('Approved On', fmtTimestamp(meta.adminApproval.approvedAt ?? new Date()));

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    setTxt(doc, C.credit);
    doc.text('✓  DIGITALLY APPROVED', valX, y);
    y += lineH;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    setTxt(doc, C.slate);
    doc.text(
      'Digitally approved by Room Administrator. This is not a cryptographic certificate-based signature.',
      labelX,
      y,
    );
    y += lineH;
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    setTxt(doc, C.slate);
    doc.text('ADMIN APPROVAL', labelX, y);
    y += lineH;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    setTxt(doc, C.charcoal);
    doc.text('Pending admin approval.', valX, y);
    y += lineH;
  }

  return y + 2;
}

/** Draw the financial summary block. Returns cursor Y. */
function drawFinancialSummary(doc: jsPDF, data: RoomExport, startY: number): number {
  let y = ensureSpace(doc, startY, 50);

  // Section title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  setTxt(doc, C.navy);
  doc.text('FINANCIAL SUMMARY', PAGE.contentLeft, y);
  y += 2;
  hr(doc, y, C.navy, 0.5);
  y += 6;

  const s = data.summary;

  const items: Array<{ label: string; amount: string; color: RGB }> = [
    { label: 'Total Contributions', amount: inr(s.contributions_cents), color: C.credit },
    { label: 'Common Expenses', amount: inr(s.common_expenses_cents), color: C.debit },
    { label: 'Personal Expenses', amount: inr(s.personal_expenses_cents), color: C.debit },
    { label: 'Reimbursed', amount: inr(s.reimbursed_cents), color: C.charcoal },
    { label: 'Available Fund', amount: inr(s.available_cents), color: C.credit },
  ];

  const labelX = PAGE.contentLeft + 4;
  const amountX = PAGE.contentLeft + PAGE.contentWidth / 2 - 4;
  const lineH = 6;

  // Light background card
  const cardH = items.length * lineH + 6;
  setFill(doc, C.bg);
  setDraw(doc, C.rule);
  doc.setLineWidth(0.2);
  doc.roundedRect(PAGE.contentLeft, y - 3, PAGE.contentWidth, cardH, 1.5, 1.5, 'FD');

  items.forEach((item) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    setTxt(doc, C.body);
    doc.text(item.label, labelX, y + 1);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    setTxt(doc, item.color);
    doc.text(item.amount, amountX, y + 1, { align: 'right' });

    y += lineH;
  });

  return y + 6;
}

/** Draw member activity summary table. Returns cursor Y. */
function drawMemberSummary(doc: jsPDF, data: RoomExport, startY: number): number {
  // Build member stats from data (same logic as before — no accounting change)
  type Stat = { name: string; contributed: number; personalPaid: number; reimbursed: number };
  const map = new Map<string, Stat>();

  data.contributions.forEach((c) => {
    if (c.voided_at) return;
    const e = map.get(c.display_name) ?? {
      name: c.display_name,
      contributed: 0,
      personalPaid: 0,
      reimbursed: 0,
    };
    e.contributed += c.amount_cents;
    map.set(c.display_name, e);
  });

  data.expenses.forEach((ex) => {
    if (ex.voided_at) return;
    const e = map.get(ex.paid_by) ?? {
      name: ex.paid_by,
      contributed: 0,
      personalPaid: 0,
      reimbursed: 0,
    };
    if (ex.payment_source === 'personal') {
      e.personalPaid += ex.amount_cents;
    }
    if (ex.reimbursement_status === 'paid') {
      e.reimbursed += ex.amount_cents;
    }
    map.set(ex.paid_by, e);
  });

  const members = [...map.values()];

  let y = ensureSpace(doc, startY, 30);

  // Section title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  setTxt(doc, C.navy);
  doc.text('MEMBER EXPENSE SUMMARY', PAGE.contentLeft, y);
  y += 2;
  hr(doc, y, C.navy, 0.5);
  y += 4;

  if (members.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    setTxt(doc, C.slate);
    doc.text('No member activity recorded for this period.', PAGE.contentLeft, y + 4);
    return y + 12;
  }

  const head = [['Member', 'Contributed', 'Personal Spent', 'Reimbursed']];
  const body = members.map((m) => [
    m.name,
    inr(m.contributed),
    inr(m.personalPaid),
    inr(m.reimbursed),
  ]);

  autoTable(doc, {
    startY: y,
    margin: { left: PAGE.margin, right: PAGE.margin, bottom: PAGE.footerZone + PAGE.margin },
    head,
    body,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 9,
      cellPadding: 3,
      textColor: C.body,
      lineColor: C.rule,
      lineWidth: 0.15,
      minCellHeight: 7,
    },
    headStyles: {
      fillColor: C.navy,
      textColor: C.white,
      fontStyle: 'bold',
      fontSize: 8.5,
      cellPadding: 3.5,
    },
    alternateRowStyles: { fillColor: C.rowAlt },
    columnStyles: {
      0: { cellWidth: 'auto', fontStyle: 'bold', minCellWidth: 30 },
      1: { cellWidth: 35, halign: 'right', textColor: C.credit, fontStyle: 'bold' },
      2: { cellWidth: 35, halign: 'right' },
      3: { cellWidth: 35, halign: 'right' },
    },
    showHead: 'everyPage',
  });

  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

/** Draw transaction ledger table. Returns cursor Y. */
function drawLedger(doc: jsPDF, data: RoomExport, startY: number): number {
  type Row = {
    date: string;
    type: string;
    description: string;
    member: string;
    amount: number;
    isCredit: boolean;
    status: string;
  };

  const rows: Row[] = [];

  data.contributions.forEach((c) => {
    if (c.voided_at) return;
    rows.push({
      date: c.contributed_on,
      type: 'CONTRIBUTION',
      description: c.note ? `Contribution — ${c.note}` : 'Contribution',
      member: c.display_name,
      amount: c.amount_cents,
      isCredit: true,
      status: c.method ? `Paid (${c.method})` : 'Completed',
    });
  });

  data.expenses.forEach((ex) => {
    if (ex.voided_at) return;
    const cat = resolveCategory(ex.category);
    const reimbStr = ex.reimbursement_status
      ? ex.reimbursement_status.charAt(0).toUpperCase() + ex.reimbursement_status.slice(1)
      : 'N/A';
    rows.push({
      date: ex.spent_on,
      type: ex.payment_source.toUpperCase(),
      description: ex.note
        ? `${cat.name}\n${ex.description} — ${ex.note}`
        : `${cat.name}\n${ex.description}`,
      member: ex.paid_by,
      amount: ex.amount_cents,
      isCredit: false,
      status:
        ex.payment_source === 'personal'
          ? `Reimb: ${reimbStr}`
          : 'Common Fund',
    });
  });

  rows.sort((a, b) => a.date.localeCompare(b.date));

  let y = ensureSpace(doc, startY, 30);

  // Section title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  setTxt(doc, C.navy);
  doc.text('EXPENSE & TRANSACTION LEDGER', PAGE.contentLeft, y);
  y += 2;
  hr(doc, y, C.navy, 0.5);
  y += 4;

  if (rows.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    setTxt(doc, C.slate);
    doc.text('No transactions recorded for this period.', PAGE.contentLeft, y + 4);
    return y + 12;
  }

  // Column widths proportional to content width
  const W = PAGE.contentWidth;
  const cw = {
    0: W * 0.05,   // #
    1: W * 0.12,   // Date
    2: W * 0.13,   // Type
    3: W * 0.30,   // Description
    4: W * 0.13,   // Paid By
    5: W * 0.14,   // Amount
    6: W * 0.13,   // Status
  };

  const head = [['#', 'Date', 'Type', 'Description', 'Paid By', 'Amount', 'Status']];
  const body = rows.map((r, i) => [
    String(i + 1),
    formatDate(r.date),
    r.type,
    r.description,
    r.member,
    inr(r.amount),
    r.status,
  ]);

  // The top margin for continuation pages must leave room for the header band
  // that we draw in the second pass (22mm band + 6mm gap = 28mm from top).
  const continuationTopMargin = PAGE.margin + 28;

  autoTable(doc, {
    startY: y,
    margin: {
      left: PAGE.margin,
      right: PAGE.margin,
      top: continuationTopMargin,
      bottom: PAGE.footerZone + PAGE.margin,
    },
    head,
    body,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 2.8,
      textColor: C.body,
      lineColor: C.rule,
      lineWidth: 0.15,
      minCellHeight: 7,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: C.navy,
      textColor: C.white,
      fontStyle: 'bold',
      fontSize: 8.5,
      cellPadding: 3.5,
      halign: 'center',
    },
    alternateRowStyles: { fillColor: C.rowAlt },
    columnStyles: {
      0: { cellWidth: cw[0], halign: 'center', fontStyle: 'bold' },
      1: { cellWidth: cw[1], halign: 'center' },
      2: { cellWidth: cw[2], halign: 'left', fontStyle: 'bold', fontSize: 8 },
      3: { cellWidth: cw[3], halign: 'left' },
      4: { cellWidth: cw[4], halign: 'left' },
      5: { cellWidth: cw[5], halign: 'right', fontStyle: 'bold' },
      6: { cellWidth: cw[6], halign: 'center', fontSize: 8 },
    },
    // Color credit/debit amounts per-row
    didParseCell(hookData) {
      if (hookData.section === 'body' && hookData.column.index === 5) {
        const rowIdx = hookData.row.index;
        const row = rows[rowIdx];
        if (row) {
          hookData.cell.styles.textColor = row.isCredit ? C.credit : C.debit;
        }
      }
    },
    showHead: 'everyPage',
  });

  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

/** Draw ledger totals below the transaction table. */
function drawLedgerTotals(doc: jsPDF, data: RoomExport, startY: number): number {
  let y = ensureSpace(doc, startY + 3, 25);

  hr(doc, y, C.navy, 0.4);
  y += 5;

  const labelX = PAGE.contentRight - 80;
  const valX = PAGE.contentRight - 6;
  const lineH = 5.5;

  const totals: Array<{ label: string; value: string; color: RGB; bold: boolean }> = [
    {
      label: 'Total Contributions',
      value: inr(data.summary.contributions_cents),
      color: C.credit,
      bold: true,
    },
    {
      label: 'Total Expenses',
      value: inr(data.summary.common_expenses_cents + data.summary.personal_expenses_cents),
      color: C.debit,
      bold: true,
    },
    {
      label: 'Available Fund',
      value: inr(data.summary.available_cents),
      color: C.credit,
      bold: true,
    },
  ];

  totals.forEach((t) => {
    doc.setFont('helvetica', t.bold ? 'bold' : 'normal');
    doc.setFontSize(9.5);
    setTxt(doc, C.charcoal);
    doc.text(t.label, labelX, y, { align: 'right' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    setTxt(doc, t.color);
    doc.text(t.value, valX, y, { align: 'right' });
    y += lineH;
  });

  return y + 2;
}

/** Draw the page footer. Called in second pass for every page. */
function drawFooter(
  doc: jsPDF,
  page: number,
  totalPages: number,
  statementId: string,
  roomName: string,
  exporterName: string,
): void {
  const footY = PAGE.height - PAGE.margin - PAGE.footerZone + 4;

  // Thin top rule
  setDraw(doc, C.navy);
  doc.setLineWidth(0.25);
  doc.line(PAGE.contentLeft, footY - 2, PAGE.contentRight, footY - 2);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  setTxt(doc, C.slate);

  // Left: brand + statement
  doc.text(
    `RoomFund · ${roomName}  ·  Statement ID: ${statementId}`,
    PAGE.contentLeft,
    footY + 2,
  );
  doc.text(
    `Exported by: ${exporterName}`,
    PAGE.contentLeft,
    footY + 6,
  );

  // Right: page number
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  setTxt(doc, C.navy);
  doc.text(`Page ${page} of ${totalPages}`, PAGE.contentRight, footY + 2, {
    align: 'right',
  });

  // Bottom disclaimer
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  setTxt(doc, C.slate);
  doc.text(
    'Financial transaction record generated by RoomFund. This does not constitute a cryptographic certificate-based digital signature.',
    PAGE.contentLeft,
    footY + 12,
  );
}

// ---------------------------------------------------------------------------
// Public API — signatures unchanged
// ---------------------------------------------------------------------------

/** Builds the professional expense PDF statement with proper pagination. */
export function buildRoomExpensesPdf(data: RoomExport): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

  const meta = data.metadata;
  const code = data.room.join_code ?? data.room.id.slice(0, 8).toUpperCase();
  const statementId =
    meta?.statementId ?? `RF-${code}-${data.range.from.replace(/-/g, '')}`;

  // ── Page 1 ────────────────────────────────────────────────────────────────
  let y = drawHeader(doc, statementId);
  y = drawStatementInfo(doc, data, y, meta);
  y = drawFinancialSummary(doc, data, y);
  y = drawMemberSummary(doc, data, y);

  // Leave a gap before the ledger; start a new page if insufficient space
  y += 6;
  if (y > PAGE.contentBottom - 35) {
    doc.addPage();
    y = PAGE.contentTop + 28; // room for the header drawn in second pass
  }

  // ── Ledger (may span multiple pages) ──────────────────────────────────────
  y = drawLedger(doc, data, y);
  y = drawLedgerTotals(doc, data, y);

  // ── Second pass: header + footer on every page ────────────────────────────
  const totalPages = doc.getNumberOfPages();
  const roomName = data.room.name;
  const exporterName = meta?.exportedBy?.name ?? 'Member';

  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    // Draw header on continuation pages (page 1 already has it)
    if (p > 1) {
      drawHeader(doc, statementId);
    }
    drawFooter(doc, p, totalPages, statementId, roomName, exporterName);
  }

  return doc.output('blob');
}

/** Builds descriptive filename for PDF exports. */
export function pdfExportFilename(
  roomName: string,
  startsOn: string,
  endsOn: string,
  periodName?: string,
): string {
  const slug =
    roomName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'room';

  if (periodName) {
    const periodSlug = periodName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30);
    return `RoomFund_${slug}_${periodSlug}_${startsOn}_to_${endsOn}.pdf`;
  }

  return `RoomFund_${slug}_Statement_${startsOn}_to_${endsOn}.pdf`;
}

/** Downloads blob as filename. */
export function downloadPdf(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}