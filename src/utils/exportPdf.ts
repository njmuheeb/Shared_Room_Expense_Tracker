import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { RoomExport } from '../models/room';
import { formatCentsPlain } from './money';
import { formatDate } from './formatters';
import { resolveCategory } from './constants';

/** Page geometry in millimetres (jsPDF default unit). */
const PAGE = {
  width: 210,
  height: 297,
  margin: 16,
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
  get contentBottom(): number {
    return this.height - this.margin;
  },
};

/** Professional color palette. */
const COLORS = {
  navy: [23, 33, 61] as [number, number, number],
  navyDark: [15, 22, 42] as [number, number, number],
  navyLight: [30, 42, 75] as [number, number, number],
  charcoal: [45, 49, 60] as [number, number, number],
  slate: [100, 108, 125] as [number, number, number],
  slateLight: [148, 155, 170] as [number, number, number],
  rule: [220, 224, 232] as [number, number, number],
  rowAlt: [248, 250, 253] as [number, number, number],
  credit: [14, 116, 82] as [number, number, number],
  debit: [185, 38, 38] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  cream: [252, 250, 245] as [number, number, number],
  gold: [180, 135, 30] as [number, number, number],
};

type RGB = [number, number, number];

function setFill(doc: jsPDF, [r, g, b]: RGB): void {
  doc.setFillColor(r, g, b);
}
function setText(doc: jsPDF, [r, g, b]: RGB): void {
  doc.setTextColor(r, g, b);
}
function setDraw(doc: jsPDF, [r, g, b]: RGB): void {
  doc.setDrawColor(r, g, b);
}
function rule(doc: jsPDF, x: number, y: number, w: number, color: RGB = COLORS.rule, weight = 0.25): void {
  setDraw(doc, color);
  doc.setLineWidth(weight);
  doc.line(x, y, x + w, y);
}

/** Formats a Date to professional local string: "07 Oct 2026, 12:43 PM IST". */
function formatDateTimeProfessional(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return String(date);
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

/** Formats period display: "Oct 1, 2026 → Present (Open)" or "Oct 1, 2026 → Oct 28, 2026 (Closed)". */
function formatPeriodDisplay(data: RoomExport, meta: RoomExport['metadata']): string {
  const from = formatDate(data.range.from);
  const isOpen = meta?.periodStatus === 'OPEN' || (meta?.spansMultiplePeriods && data.range.to >= new Date().toISOString().slice(0, 10));
  const to = isOpen ? 'Present (Open)' : formatDate(data.range.to);
  return `${from} → ${to}`;
}

/** Draws the header band on a page. */
function drawHeader(doc: jsPDF, _data: RoomExport, statementId: string): void {
  const bandH = 24;
  const y = PAGE.contentTop;

  setFill(doc, COLORS.navy);
  doc.rect(PAGE.contentLeft, y, PAGE.contentWidth, bandH, 'F');

  setFill(doc, COLORS.navyDark);
  doc.rect(PAGE.contentLeft, y + bandH - 1.5, PAGE.contentWidth, 1.5, 'F');

  // Brand mark (white square with navy R)
  setFill(doc, COLORS.white);
  doc.rect(PAGE.contentLeft + 6, y + 7, 6, 10, 'F');
  setFill(doc, COLORS.navy);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('R', PAGE.contentLeft + 6 + 1.5, y + 14.5);

  // Brand text
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  setText(doc, COLORS.white);
  doc.text('ROOMFUND', PAGE.contentLeft + 16, y + 11);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text('Shared Room Expense Tracker', PAGE.contentLeft + 16, y + 17);

  // Right side — statement title + ID
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('EXPENSE STATEMENT', PAGE.contentRight - 6, y + 11, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(`Statement ID: ${statementId}`, PAGE.contentRight - 6, y + 17, { align: 'right' });
}

/** Draws the account info card (two-column). Returns Y position after the card. */
function drawAccountInfo(doc: jsPDF, data: RoomExport, startY: number, _statementId: string, meta: RoomExport['metadata']): number {
  const boxH = 52;
  const y = startY + 4;

  setFill(doc, COLORS.cream);
  doc.roundedRect(PAGE.contentLeft, y, PAGE.contentWidth, boxH, 2, 2, 'F');
  setDraw(doc, COLORS.rule);
  doc.setLineWidth(0.25);
  doc.roundedRect(PAGE.contentLeft, y, PAGE.contentWidth, boxH, 2, 2, 'S');

  // Vertical divider
  const midX = PAGE.contentLeft + PAGE.contentWidth / 2;
  setDraw(doc, COLORS.rule);
  doc.line(midX, y + 6, midX, y + boxH - 6);

  const col1X = PAGE.contentLeft + 8;
  const col2X = midX + 8;
  const labelSize = 6.5;
  const valueSize = 9.5;

  // --- Column 1: Room & Statement Scope ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(labelSize);
  setText(doc, COLORS.slate);
  doc.text('ROOM & CODE', col1X, y + 9);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(valueSize);
  setText(doc, COLORS.navy);
  doc.text(`${data.room.name} [${data.room.join_code ?? 'CODE'}]`, col1X, y + 16);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(labelSize);
  setText(doc, COLORS.slate);
  doc.text('STATEMENT SCOPE / PERIOD', col1X, y + 23);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(valueSize);
  setText(doc, COLORS.charcoal);
  const scopeLabel = meta?.periodName
    ? `${meta.periodName} (${meta.periodStatus ?? 'OPEN'})`
    : meta?.spansMultiplePeriods
      ? 'Custom Date Range (Spans multiple periods)'
      : 'Custom Date Range';
  doc.text(scopeLabel, col1X, y + 30);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  setText(doc, COLORS.slate);
  const periodStr = formatPeriodDisplay(data, meta);
  doc.text(`Period: ${periodStr}`, col1X, y + 37);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(`Currency: ${data.room.currency} (₹)`, col1X, y + 43);

  // --- Column 2: Exporter & Digital Approval ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(labelSize);
  setText(doc, COLORS.slate);
  doc.text('EXPORTED BY', col2X, y + 9);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(valueSize);
  setText(doc, COLORS.charcoal);
  const exporterName = meta?.exportedBy?.name ?? 'Room Member';
  const exporterRole = meta?.exportedBy?.role ? ` (${meta.exportedBy.role})` : '';
  doc.text(`${exporterName}${exporterRole}`, col2X, y + 16);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(labelSize);
  setText(doc, COLORS.slate);
  doc.text('ADMIN DIGITAL APPROVAL STATUS', col2X, y + 23);

  const isApproved = meta?.adminApproval?.status === 'DIGITALLY APPROVED';
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(valueSize - 0.5);
  setText(doc, isApproved ? COLORS.credit : COLORS.gold);
  doc.text(
    isApproved ? '✓ DIGITALLY APPROVED BY ROOM ADMIN' : '⏳ PENDING ADMIN APPROVAL',
    col2X,
    y + 30
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  setText(doc, COLORS.charcoal);
  if (isApproved && meta?.adminApproval?.approvedBy) {
    const approvedAt = meta.adminApproval.approvedAt
      ? formatDateTimeProfessional(meta.adminApproval.approvedAt)
      : formatDateTimeProfessional(new Date());
    // Wrap long approval text if needed
    const approvalText = `Approved by: ${meta.adminApproval.approvedBy} on ${approvedAt}`;
    const lines = doc.splitTextToSize(approvalText, PAGE.contentWidth / 2 - 16);
    doc.text(lines, col2X, y + 36);
    doc.setFontSize(7);
    setText(doc, COLORS.slate);
    doc.text('Status: Digitally approved by room administrator.', col2X, y + 36 + lines.length * 4);
  } else {
    doc.text('Generated for accounting review.', col2X, y + 36);
    doc.setFontSize(7);
    setText(doc, COLORS.slate);
    doc.text('Status: Pending room administrator digital approval.', col2X, y + 42);
  }

  return y + boxH;
}

/** Draws the 5-card financial summary. Returns Y position after the block. */
function drawBalanceSummary(doc: jsPDF, data: RoomExport, startY: number): number {
  const blockH = 24;
  const y = startY + 6;

  setFill(doc, COLORS.navy);
  doc.roundedRect(PAGE.contentLeft, y, PAGE.contentWidth, blockH, 1.5, 1.5, 'F');

  const credits = data.summary.contributions_cents;
  const commonExp = data.summary.common_expenses_cents;
  const personalExp = data.summary.personal_expenses_cents;
  const reimbursed = data.summary.reimbursed_cents;
  const available = data.summary.available_cents;

  const cells: Array<{ label: string; amount: string; color: RGB }> = [
    { label: 'CONTRIBUTIONS', amount: formatCentsPlain(credits), color: COLORS.credit },
    { label: 'COMMON EXPENSE', amount: formatCentsPlain(commonExp), color: COLORS.debit },
    { label: 'PERSONAL EXPENSE', amount: formatCentsPlain(personalExp), color: COLORS.white },
    { label: 'REIMBURSED', amount: formatCentsPlain(reimbursed), color: COLORS.white },
    { label: 'AVAILABLE FUND', amount: formatCentsPlain(available), color: COLORS.white },
  ];

  const colW = PAGE.contentWidth / 5;
  cells.forEach((cell, i) => {
    const x = PAGE.contentLeft + i * colW;

    if (i > 0) {
      setDraw(doc, COLORS.navyDark);
      doc.setLineWidth(0.25);
      doc.line(x, y + 5, x, y + blockH - 5);
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    setText(doc, COLORS.slateLight);
    doc.text(cell.label, x + 6, y + 9);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    setText(doc, cell.color);
    doc.text(cell.amount, x + 6, y + 17);
  });

  return y + blockH;
}

/** Draws the Member Activity Summary table. Returns Y position after the table. */
function drawMemberSummary(doc: jsPDF, data: RoomExport, startY: number): number {
  type MemberStat = {
    name: string;
    contributed: number;
    personalPaid: number;
    reimbursed: number;
  };
  const map = new Map<string, MemberStat>();

  data.contributions.forEach((c) => {
    if (c.voided_at) return;
    const entry = map.get(c.display_name) ?? { name: c.display_name, contributed: 0, personalPaid: 0, reimbursed: 0 };
    entry.contributed += c.amount_cents;
    map.set(c.display_name, entry);
  });

  data.expenses.forEach((e) => {
    if (e.voided_at) return;
    const entry = map.get(e.paid_by) ?? { name: e.paid_by, contributed: 0, personalPaid: 0, reimbursed: 0 };
    if (e.payment_source === 'personal') {
      entry.personalPaid += e.amount_cents;
    }
    if (e.reimbursement_status === 'paid') {
      entry.reimbursed += e.amount_cents;
    }
    map.set(e.paid_by, entry);
  });

  const members = [...map.values()];
  if (members.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    setText(doc, COLORS.slate);
    doc.text('No member activity recorded.', PAGE.contentLeft, startY + 6);
    return startY + 14;
  }

  // Section title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  setText(doc, COLORS.navy);
  doc.text('MEMBER ACTIVITY SUMMARY', PAGE.contentLeft, startY);
  rule(doc, PAGE.contentLeft, startY + 2, PAGE.contentWidth, COLORS.navy, 0.5);

  const head = [['Member', 'Total Contributed', 'Personal Paid', 'Total Reimbursed']];
  const body = members.map((m) => [
    m.name,
    formatCentsPlain(m.contributed),
    formatCentsPlain(m.personalPaid),
    formatCentsPlain(m.reimbursed),
  ]);

  autoTable(doc, {
    startY: startY + 5,
    margin: { left: PAGE.margin, right: PAGE.margin },
    head,
    body,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 9,
      cellPadding: 3.5,
      textColor: COLORS.charcoal,
      lineColor: COLORS.rule,
      lineWidth: 0.15,
      minCellHeight: 7,
    },
    headStyles: {
      fillColor: COLORS.navy,
      textColor: COLORS.white,
      fontStyle: 'bold',
      fontSize: 9,
      cellPadding: 4,
    },
    alternateRowStyles: { fillColor: COLORS.rowAlt },
    columnStyles: {
      0: { cellWidth: 'auto', fontStyle: 'bold', minCellWidth: 30 },
      1: { cellWidth: 38, halign: 'right', textColor: COLORS.credit, fontStyle: 'bold' },
      2: { cellWidth: 38, halign: 'right' },
      3: { cellWidth: 38, halign: 'right' },
    },
    showHead: 'everyPage',
    // Don't draw footer here - we'll do it in a second pass
  });

  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

/** Draws the Transaction Ledger table. Returns Y position after the table. */
function drawTransactionHistory(doc: jsPDF, data: RoomExport, startY: number): number {
  type Row = {
    date: string;
    type: string;
    narration: string;
    member: string;
    credit: number;
    debit: number;
    status: string;
  };

  const rows: Row[] = [];

  data.contributions.forEach((c) => {
    if (c.voided_at) return;
    rows.push({
      date: c.contributed_on,
      type: 'Contribution',
      narration: c.note ? `Contribution — ${c.note}` : 'Contribution to common fund',
      member: c.display_name,
      credit: c.amount_cents,
      debit: 0,
      status: c.method ? `Paid (${c.method})` : 'Completed',
    });
  });

  data.expenses.forEach((e) => {
    if (e.voided_at) return;
    const cat = resolveCategory(e.category);
    const reimbStr = e.reimbursement_status
      ? e.reimbursement_status.toUpperCase()
      : 'N/A';
    rows.push({
      date: e.spent_on,
      type: `${e.payment_source.toUpperCase()} (${cat.name})`,
      narration: e.note ? `${e.description} — ${e.note}` : e.description,
      member: e.paid_by,
      credit: 0,
      debit: e.amount_cents,
      status: e.payment_source === 'personal' ? `Reimb: ${reimbStr}` : 'Common Fund Spent',
    });
  });

  rows.sort((a, b) => a.date.localeCompare(b.date));

  // Section title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  setText(doc, COLORS.navy);
  doc.text('TRANSACTION LEDGER', PAGE.contentLeft, startY);
  rule(doc, PAGE.contentLeft, startY + 2, PAGE.contentWidth, COLORS.navy, 0.5);

  if (rows.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    setText(doc, COLORS.slate);
    doc.text('No active transactions recorded for this period.', PAGE.contentLeft, startY + 10);
    return startY + 16;
  }

  const head = [['#', 'Date', 'Type & Description', 'Paid By', 'Credit', 'Debit', 'Status']];
  const body = rows.map((row, i) => [
    String(i + 1),
    formatDate(row.date),
    `${row.type}\n${row.narration}`,
    row.member,
    row.credit ? formatCentsPlain(row.credit) : '—',
    row.debit ? formatCentsPlain(row.debit) : '—',
    row.status,
  ]);

  // Calculate column widths proportionally
  const totalW = PAGE.contentWidth;
  const colWidths = {
    0: totalW * 0.055,  // #
    1: totalW * 0.11,   // Date
    2: totalW * 0.33,   // Type & Description
    3: totalW * 0.125,  // Paid By
    4: totalW * 0.125,  // Credit
    5: totalW * 0.125,  // Debit
    6: totalW * 0.13,   // Status
  };

  autoTable(doc, {
    startY: startY + 5,
    margin: { left: PAGE.margin, right: PAGE.margin },
    head,
    body,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 3,
      textColor: COLORS.charcoal,
      lineColor: COLORS.rule,
      lineWidth: 0.15,
      minCellHeight: 7,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: COLORS.navy,
      textColor: COLORS.white,
      fontStyle: 'bold',
      fontSize: 8.5,
      cellPadding: 4,
      halign: 'center',
    },
    alternateRowStyles: { fillColor: COLORS.rowAlt },
    columnStyles: {
      0: { cellWidth: colWidths[0], halign: 'center', fontStyle: 'bold' },
      1: { cellWidth: colWidths[1], halign: 'center' },
      2: { cellWidth: colWidths[2], halign: 'left', cellPadding: { left: 4, right: 4, top: 3, bottom: 3 } },
      3: { cellWidth: colWidths[3], halign: 'left' },
      4: { cellWidth: colWidths[4], halign: 'right', textColor: COLORS.credit, fontStyle: 'bold' },
      5: { cellWidth: colWidths[5], halign: 'right', textColor: COLORS.debit, fontStyle: 'bold' },
      6: { cellWidth: colWidths[6], halign: 'center', fontSize: 7.5 },
    },
    // Ensure header repeats on each page
    showHead: 'everyPage',
  });

  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

/** Draws footer on a specific page (called in second pass). */
function drawFooter(doc: jsPDF, _data: RoomExport, page: number, totalPages: number, statementId: string, meta: RoomExport['metadata']): void {
  const footerH = 16;
  const y = PAGE.height - PAGE.margin - footerH + 4;

  // Thin top rule
  setDraw(doc, COLORS.navy);
  doc.setLineWidth(0.3);
  doc.line(PAGE.contentLeft, y - 2, PAGE.contentRight, y - 2);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  setText(doc, COLORS.slate);

  const exporterName = meta?.exportedBy?.name ?? 'Member';

  // Left side
  doc.text(`RoomFund · Statement ${statementId} · Exported by: ${exporterName}`, PAGE.contentLeft + 2, y + 3);
  doc.text(`Note: This document provides a financial transaction record and does not constitute a cryptographic certificate-based digital signature.`, PAGE.contentLeft + 2, y + 8);

  // Right side
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  setText(doc, COLORS.navy);
  doc.text(`Page ${page} of ${totalPages}`, PAGE.contentRight - 2, y + 3, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  setText(doc, COLORS.slate);
  doc.text(`Generated: ${formatDateTimeProfessional(new Date())}`, PAGE.contentRight - 2, y + 8, { align: 'right' });
}

/** Builds the professional expense PDF statement with proper pagination. */
export function buildRoomExpensesPdf(data: RoomExport): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

  const meta = data.metadata;
  const code = data.room.join_code ?? data.room.id.slice(0, 8).toUpperCase();
  const statementId = meta?.statementId ?? `RF-${code}-${data.range.from.replace(/-/g, '')}`;

  // --- Page 1: Header, Account Info, Balance Summary, Member Summary ---
  let y = PAGE.contentTop;

  drawHeader(doc, data, statementId);
  y = drawAccountInfo(doc, data, y + 2, statementId, meta);
  y = drawBalanceSummary(doc, data, y);
  y = drawMemberSummary(doc, data, y);

  // If there's not enough space for at least 3 transaction rows, start new page
  const minSpaceNeeded = 35;
  if (y > PAGE.contentBottom - minSpaceNeeded) {
    doc.addPage();
    y = PAGE.contentTop;
    drawHeader(doc, data, statementId);
  } else {
    y += 4;
  }

  // --- Transaction Ledger (may span multiple pages) ---
  drawTransactionHistory(doc, data, y);

  // --- Second pass: draw headers (on continuation pages) and footers on all pages ---
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    if (p > 1) {
      drawHeader(doc, data, statementId);
    }
    drawFooter(doc, data, p, totalPages, statementId, meta);
  }

  return doc.output('blob');
}

/** Builds descriptive filename for PDF exports. */
export function pdfExportFilename(
  roomName: string,
  startsOn: string,
  endsOn: string,
  periodName?: string
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