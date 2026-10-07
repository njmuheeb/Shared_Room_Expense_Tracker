/**
 * Generates a test PDF with realistic mock data to visually verify the layout.
 * Run with: node --experimental-strip-types scripts/test-pdf.ts
 */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { RoomExport } from '../src/models/room.ts';
import * as fs from 'node:fs';
import * as path from 'node:path';

// We can't import the browser-only module directly in Node because it uses
// Blob. Instead, we inline the core logic or duplicate just for this test.
// But actually jsPDF works fine in Node — we just need to avoid calling
// `doc.output('blob')` and instead use `doc.output('arraybuffer')`.

// Import the module pieces we need
const PAGE = {
  width: 210,
  height: 297,
  margin: 16,
  footerZone: 18,
  get contentWidth(): number { return this.width - this.margin * 2; },
  get contentLeft(): number { return this.margin; },
  get contentRight(): number { return this.width - this.margin; },
  get contentTop(): number { return this.margin; },
  get contentBottom(): number { return this.height - this.margin - this.footerZone; },
};

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

function setFill(d: jsPDF, [r, g, b]: RGB) { d.setFillColor(r, g, b); }
function setTxt(d: jsPDF, [r, g, b]: RGB) { d.setTextColor(r, g, b); }
function setDraw(d: jsPDF, [r, g, b]: RGB) { d.setDrawColor(r, g, b); }
function hr(d: jsPDF, y: number, color: RGB = C.rule, weight = 0.3) {
  setDraw(d, color); d.setLineWidth(weight);
  d.line(PAGE.contentLeft, y, PAGE.contentRight, y);
}
function inr(cents: number): string {
  const abs = Math.abs(cents);
  const n = (abs / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cents < 0 ? `-₹${n}` : `₹${n}`;
}
function fmtTimestamp(v: Date | string): string {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZoneName: 'short' });
}
function formatDate(dateString: string): string {
  if (!dateString) return '';
  const [year, month, day] = dateString.split('-').map(Number);
  if (!year || !month || !day) return dateString;
  const date = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}
function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > PAGE.contentBottom) { doc.addPage(); return PAGE.contentTop; }
  return y;
}

// ---- Draw functions (copy from exportPdf.ts) ----

function drawHeader(doc: jsPDF, statementId: string): number {
  const y = PAGE.contentTop;
  const bandH = 22;
  setFill(doc, C.navy);
  doc.rect(PAGE.contentLeft, y, PAGE.contentWidth, bandH, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); setTxt(doc, C.white);
  doc.text('ROOMFUND', PAGE.contentLeft + 6, y + 9);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  doc.text('Shared Room Expense Tracker', PAGE.contentLeft + 6, y + 15);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('EXPENSE STATEMENT', PAGE.contentRight - 6, y + 9, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
  doc.text(`Statement ID: ${statementId}`, PAGE.contentRight - 6, y + 15, { align: 'right' });
  return y + bandH + 6;
}

function drawStatementInfo(doc: jsPDF, data: RoomExport, startY: number, meta: RoomExport['metadata']): number {
  let y = startY;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); setTxt(doc, C.navy);
  doc.text('STATEMENT INFORMATION', PAGE.contentLeft, y);
  y += 2; hr(doc, y, C.navy, 0.5); y += 5;

  const lineH = 4.5;
  const labelX = PAGE.contentLeft + 1;
  const valX = PAGE.contentLeft + 42;

  const pair = (label: string, value: string) => {
    y = ensureSpace(doc, y, lineH + 1);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); setTxt(doc, C.slate);
    doc.text(label, labelX, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); setTxt(doc, C.charcoal);
    const maxW = PAGE.contentRight - valX - 2;
    const lines: string[] = doc.splitTextToSize(value, maxW);
    doc.text(lines, valX, y);
    y += lineH * Math.max(lines.length, 1);
  };

  const code = data.room.join_code ?? '';
  pair('Room', `${data.room.name}${code ? ` [${code}]` : ''}`);

  const scopeLabel = meta?.periodName
    ? `${meta.periodName} (${meta.periodStatus ?? 'OPEN'})`
    : 'Custom Date Range';
  pair('Period', scopeLabel);

  const from = formatDate(data.range.from);
  const isOpen = meta?.periodStatus === 'OPEN';
  const to = isOpen ? 'Present (Open)' : `${formatDate(data.range.to)} (Closed)`;
  pair('Date Range', `${from}  →  ${to}`);
  pair('Currency', `${data.room.currency} (₹)`);

  const exporterName = meta?.exportedBy?.name ?? 'Room Member';
  const exporterRole = meta?.exportedBy?.role ? ` (${meta.exportedBy.role})` : '';
  pair('Exported By', `${exporterName}${exporterRole}`);
  pair('Exported On', fmtTimestamp(meta?.exportedAt ?? new Date()));

  y += 3;
  const isApproved = meta?.adminApproval?.status === 'DIGITALLY APPROVED';
  if (isApproved && meta?.adminApproval?.approvedBy) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); setTxt(doc, C.slate);
    doc.text('ADMIN APPROVAL', labelX, y); y += lineH;
    pair('Approved By', meta.adminApproval.approvedBy);
    pair('Approved On', fmtTimestamp(meta.adminApproval.approvedAt ?? new Date()));
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); setTxt(doc, C.credit);
    doc.text('✓  DIGITALLY APPROVED', valX, y); y += lineH;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); setTxt(doc, C.slate);
    doc.text('Digitally approved by Room Administrator. This is not a cryptographic certificate-based signature.', labelX, y);
    y += lineH;
  } else {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); setTxt(doc, C.slate);
    doc.text('ADMIN APPROVAL', labelX, y); y += lineH;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setTxt(doc, C.charcoal);
    doc.text('Pending admin approval.', valX, y); y += lineH;
  }

  return y + 2;
}

function drawFinancialSummary(doc: jsPDF, data: RoomExport, startY: number): number {
  let y = ensureSpace(doc, startY, 50);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); setTxt(doc, C.navy);
  doc.text('FINANCIAL SUMMARY', PAGE.contentLeft, y);
  y += 2; hr(doc, y, C.navy, 0.5); y += 6;

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
  const cardH = items.length * lineH + 6;
  setFill(doc, C.bg); setDraw(doc, C.rule); doc.setLineWidth(0.2);
  doc.roundedRect(PAGE.contentLeft, y - 3, PAGE.contentWidth, cardH, 1.5, 1.5, 'FD');

  items.forEach((item) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); setTxt(doc, C.body);
    doc.text(item.label, labelX, y + 1);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); setTxt(doc, item.color);
    doc.text(item.amount, amountX, y + 1, { align: 'right' });
    y += lineH;
  });
  return y + 6;
}

function drawMemberSummary(doc: jsPDF, data: RoomExport, startY: number): number {
  type Stat = { name: string; contributed: number; personalPaid: number; reimbursed: number };
  const map = new Map<string, Stat>();
  data.contributions.forEach((c) => {
    if (c.voided_at) return;
    const e = map.get(c.display_name) ?? { name: c.display_name, contributed: 0, personalPaid: 0, reimbursed: 0 };
    e.contributed += c.amount_cents; map.set(c.display_name, e);
  });
  data.expenses.forEach((ex) => {
    if (ex.voided_at) return;
    const e = map.get(ex.paid_by) ?? { name: ex.paid_by, contributed: 0, personalPaid: 0, reimbursed: 0 };
    if (ex.payment_source === 'personal') e.personalPaid += ex.amount_cents;
    if (ex.reimbursement_status === 'paid') e.reimbursed += ex.amount_cents;
    map.set(ex.paid_by, e);
  });
  const members = [...map.values()];
  let y = ensureSpace(doc, startY, 30);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); setTxt(doc, C.navy);
  doc.text('MEMBER EXPENSE SUMMARY', PAGE.contentLeft, y);
  y += 2; hr(doc, y, C.navy, 0.5); y += 4;

  if (members.length === 0) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setTxt(doc, C.slate);
    doc.text('No member activity recorded for this period.', PAGE.contentLeft, y + 4);
    return y + 12;
  }

  const head = [['Member', 'Contributed', 'Personal Spent', 'Reimbursed']];
  const body = members.map((m) => [m.name, inr(m.contributed), inr(m.personalPaid), inr(m.reimbursed)]);

  autoTable(doc, {
    startY: y,
    margin: { left: PAGE.margin, right: PAGE.margin, bottom: PAGE.footerZone + PAGE.margin },
    head, body, theme: 'grid',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 3, textColor: C.body, lineColor: C.rule, lineWidth: 0.15, minCellHeight: 7 },
    headStyles: { fillColor: C.navy, textColor: C.white, fontStyle: 'bold', fontSize: 8.5, cellPadding: 3.5 },
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

function drawLedger(doc: jsPDF, data: RoomExport, startY: number): number {
  type Row = { date: string; type: string; description: string; member: string; amount: number; isCredit: boolean; status: string };
  const rows: Row[] = [];
  data.contributions.forEach((c) => {
    if (c.voided_at) return;
    rows.push({ date: c.contributed_on, type: 'CONTRIBUTION', description: c.note ? `Contribution — ${c.note}` : 'Contribution', member: c.display_name, amount: c.amount_cents, isCredit: true, status: c.method ? `Paid (${c.method})` : 'Completed' });
  });
  data.expenses.forEach((ex) => {
    if (ex.voided_at) return;
    const reimbStr = ex.reimbursement_status ? ex.reimbursement_status.charAt(0).toUpperCase() + ex.reimbursement_status.slice(1) : 'N/A';
    rows.push({ date: ex.spent_on, type: ex.payment_source.toUpperCase(), description: ex.note ? `${ex.category}\n${ex.description} — ${ex.note}` : `${ex.category}\n${ex.description}`, member: ex.paid_by, amount: ex.amount_cents, isCredit: false, status: ex.payment_source === 'personal' ? `Reimb: ${reimbStr}` : 'Common Fund' });
  });
  rows.sort((a, b) => a.date.localeCompare(b.date));

  let y = ensureSpace(doc, startY, 30);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); setTxt(doc, C.navy);
  doc.text('EXPENSE & TRANSACTION LEDGER', PAGE.contentLeft, y);
  y += 2; hr(doc, y, C.navy, 0.5); y += 4;

  if (rows.length === 0) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setTxt(doc, C.slate);
    doc.text('No transactions recorded for this period.', PAGE.contentLeft, y + 4);
    return y + 12;
  }

  const W = PAGE.contentWidth;
  const cw = { 0: W * 0.05, 1: W * 0.12, 2: W * 0.13, 3: W * 0.30, 4: W * 0.13, 5: W * 0.14, 6: W * 0.13 };

  const head = [['#', 'Date', 'Type', 'Description', 'Paid By', 'Amount', 'Status']];
  const body = rows.map((r, i) => [String(i + 1), formatDate(r.date), r.type, r.description, r.member, inr(r.amount), r.status]);

  const continuationTopMargin = PAGE.margin + 28;

  autoTable(doc, {
    startY: y,
    margin: { left: PAGE.margin, right: PAGE.margin, top: continuationTopMargin, bottom: PAGE.footerZone + PAGE.margin },
    head, body, theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2.8, textColor: C.body, lineColor: C.rule, lineWidth: 0.15, minCellHeight: 7, overflow: 'linebreak' as const },
    headStyles: { fillColor: C.navy, textColor: C.white, fontStyle: 'bold', fontSize: 8.5, cellPadding: 3.5, halign: 'center' as const },
    alternateRowStyles: { fillColor: C.rowAlt },
    columnStyles: {
      0: { cellWidth: cw[0], halign: 'center' as const, fontStyle: 'bold' },
      1: { cellWidth: cw[1], halign: 'center' as const },
      2: { cellWidth: cw[2], halign: 'left' as const, fontStyle: 'bold', fontSize: 8 },
      3: { cellWidth: cw[3], halign: 'left' as const },
      4: { cellWidth: cw[4], halign: 'left' as const },
      5: { cellWidth: cw[5], halign: 'right' as const, fontStyle: 'bold' },
      6: { cellWidth: cw[6], halign: 'center' as const, fontSize: 8 },
    },
    didParseCell(hookData: { section: string; column: { index: number }; row: { index: number }; cell: { styles: { textColor: RGB } } }) {
      if (hookData.section === 'body' && hookData.column.index === 5) {
        const rowIdx = hookData.row.index;
        const row = rows[rowIdx];
        if (row) hookData.cell.styles.textColor = row.isCredit ? C.credit : C.debit;
      }
    },
    showHead: 'everyPage',
  });
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

function drawLedgerTotals(doc: jsPDF, data: RoomExport, startY: number): number {
  let y = ensureSpace(doc, startY + 3, 25);
  hr(doc, y, C.navy, 0.4); y += 5;
  const valX = PAGE.contentRight - 6;
  const labelX = PAGE.contentRight - 80;
  const lineH = 5.5;

  const totals = [
    { label: 'Total Contributions', value: inr(data.summary.contributions_cents), color: C.credit },
    { label: 'Total Expenses', value: inr(data.summary.common_expenses_cents + data.summary.personal_expenses_cents), color: C.debit },
    { label: 'Available Fund', value: inr(data.summary.available_cents), color: C.credit },
  ];
  totals.forEach((t) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); setTxt(doc, C.charcoal);
    doc.text(t.label, labelX, y, { align: 'right' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); setTxt(doc, t.color);
    doc.text(t.value, valX, y, { align: 'right' });
    y += lineH;
  });
  return y + 2;
}

function drawFooter(doc: jsPDF, page: number, totalPages: number, statementId: string, roomName: string, exporterName: string) {
  const footY = PAGE.height - PAGE.margin - PAGE.footerZone + 4;
  setDraw(doc, C.navy); doc.setLineWidth(0.25);
  doc.line(PAGE.contentLeft, footY - 2, PAGE.contentRight, footY - 2);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); setTxt(doc, C.slate);
  doc.text(`RoomFund · ${roomName}  ·  Statement ID: ${statementId}`, PAGE.contentLeft, footY + 2);
  doc.text(`Exported by: ${exporterName}`, PAGE.contentLeft, footY + 6);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); setTxt(doc, C.navy);
  doc.text(`Page ${page} of ${totalPages}`, PAGE.contentRight, footY + 2, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); setTxt(doc, C.slate);
  doc.text('Financial transaction record generated by RoomFund. This does not constitute a cryptographic certificate-based digital signature.', PAGE.contentLeft, footY + 12);
}

// ---- Mock data ----

const mockData: RoomExport = {
  room: { id: 'room-001', name: 'Shalteng', currency: 'INR', join_code: 'SH4LT' },
  range: { from: '2026-10-01', to: '2026-10-31' },
  contributions: [
    { id: 'c1', member_id: 'm1', display_name: 'Yasir', amount_cents: 150000, contributed_on: '2026-10-05', method: 'UPI', note: 'October Contribution', voided_at: null, void_reason: null },
  ],
  expenses: [
    { id: 'e1', paid_by_member_id: 'm2', paid_by: 'Suhail', description: 'Milk', amount_cents: 3400, payment_source: 'personal', category: 'groceries', spent_on: '2026-10-01', note: null, voided_at: null, void_reason: null, reimbursement_status: 'pending', reimbursed_on: null },
    { id: 'e2', paid_by_member_id: 'm2', paid_by: 'Suhail', description: 'Meat', amount_cents: 25000, payment_source: 'personal', category: 'groceries', spent_on: '2026-10-01', note: null, voided_at: null, void_reason: null, reimbursement_status: 'pending', reimbursed_on: null },
    { id: 'e3', paid_by_member_id: 'm3', paid_by: 'Muheeb', description: 'Roti', amount_cents: 3000, payment_source: 'personal', category: 'groceries', spent_on: '2026-10-02', note: null, voided_at: null, void_reason: null, reimbursement_status: 'pending', reimbursed_on: null },
    { id: 'e4', paid_by_member_id: 'm3', paid_by: 'Muheeb', description: 'Vegetables', amount_cents: 15400, payment_source: 'personal', category: 'groceries', spent_on: '2026-10-03', note: 'Weekly veggies', voided_at: null, void_reason: null, reimbursement_status: 'pending', reimbursed_on: null },
    { id: 'e5', paid_by_member_id: 'm2', paid_by: 'Suhail', description: 'Rice 5kg', amount_cents: 7800, payment_source: 'personal', category: 'groceries', spent_on: '2026-10-03', note: null, voided_at: null, void_reason: null, reimbursement_status: 'pending', reimbursed_on: null },
    // More rows for pagination test
    { id: 'e6', paid_by_member_id: 'm2', paid_by: 'Suhail', description: 'Cooking Oil', amount_cents: 22000, payment_source: 'common', category: 'groceries', spent_on: '2026-10-04', note: null, voided_at: null, void_reason: null, reimbursement_status: null, reimbursed_on: null },
    { id: 'e7', paid_by_member_id: 'm3', paid_by: 'Muheeb', description: 'Electricity Bill', amount_cents: 85000, payment_source: 'common', category: 'utilities', spent_on: '2026-10-05', note: 'September bill', voided_at: null, void_reason: null, reimbursement_status: null, reimbursed_on: null },
    { id: 'e8', paid_by_member_id: 'm1', paid_by: 'Yasir', description: 'Gas Cylinder', amount_cents: 95000, payment_source: 'common', category: 'utilities', spent_on: '2026-10-06', note: null, voided_at: null, void_reason: null, reimbursement_status: null, reimbursed_on: null },
    { id: 'e9', paid_by_member_id: 'm2', paid_by: 'Suhail', description: 'Internet Bill', amount_cents: 49900, payment_source: 'common', category: 'internet', spent_on: '2026-10-07', note: 'BSNL Fiber', voided_at: null, void_reason: null, reimbursement_status: null, reimbursed_on: null },
    { id: 'e10', paid_by_member_id: 'm3', paid_by: 'Muheeb', description: 'Cleaning Supplies', amount_cents: 12000, payment_source: 'personal', category: 'cleaning', spent_on: '2026-10-08', note: 'Broom and mop', voided_at: null, void_reason: null, reimbursement_status: 'pending', reimbursed_on: null },
    { id: 'e11', paid_by_member_id: 'm1', paid_by: 'Yasir', description: 'Water Tank Repair', amount_cents: 150000, payment_source: 'common', category: 'maintenance', spent_on: '2026-10-09', note: 'Plumber charges', voided_at: null, void_reason: null, reimbursement_status: null, reimbursed_on: null },
    { id: 'e12', paid_by_member_id: 'm2', paid_by: 'Suhail', description: 'Toilet Paper & Soap', amount_cents: 8500, payment_source: 'personal', category: 'household', spent_on: '2026-10-10', note: null, voided_at: null, void_reason: null, reimbursement_status: 'paid', reimbursed_on: '2026-10-12' },
    { id: 'e13', paid_by_member_id: 'm3', paid_by: 'Muheeb', description: 'Eggs & Bread', amount_cents: 9500, payment_source: 'personal', category: 'groceries', spent_on: '2026-10-11', note: null, voided_at: null, void_reason: null, reimbursement_status: 'pending', reimbursed_on: null },
    { id: 'e14', paid_by_member_id: 'm1', paid_by: 'Yasir', description: 'Taxi to Market', amount_cents: 25000, payment_source: 'personal', category: 'transport', spent_on: '2026-10-12', note: 'Round trip', voided_at: null, void_reason: null, reimbursement_status: 'pending', reimbursed_on: null },
    { id: 'e15', paid_by_member_id: 'm2', paid_by: 'Suhail', description: 'Movie Night', amount_cents: 45000, payment_source: 'common', category: 'entertainment', spent_on: '2026-10-13', note: 'Netflix subscription', voided_at: null, void_reason: null, reimbursement_status: null, reimbursed_on: null },
  ],
  summary: {
    contributions_cents: 150000,
    common_expenses_cents: 446900,
    personal_expenses_cents: 150600,
    reimbursed_cents: 8500,
    available_cents: -305400,
    pending_liability_cents: 142100,
  },
  metadata: {
    statementId: 'RF-SH4LT-20261001',
    scopeType: 'current',
    periodName: 'October 2026',
    periodStatus: 'OPEN',
    spansMultiplePeriods: false,
    exportedBy: { name: 'Muheeb', role: 'admin' },
    exportedAt: new Date().toISOString(),
    adminApproval: {
      status: 'DIGITALLY APPROVED',
      approvedBy: 'Muheeb',
      approvedByRole: 'Room Admin',
      approvedAt: new Date().toISOString(),
    },
  },
};

// ---- Build PDF ----

const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
const meta = mockData.metadata;
const statementId = meta?.statementId ?? 'RF-TEST';

let y = drawHeader(doc, statementId);
y = drawStatementInfo(doc, mockData, y, meta);
y = drawFinancialSummary(doc, mockData, y);
y = drawMemberSummary(doc, mockData, y);

y += 6;
if (y > PAGE.contentBottom - 35) {
  doc.addPage();
  y = PAGE.contentTop + 28;
}

y = drawLedger(doc, mockData, y);
y = drawLedgerTotals(doc, mockData, y);

// Second pass: headers + footers
const totalPages = doc.getNumberOfPages();
for (let p = 1; p <= totalPages; p++) {
  doc.setPage(p);
  if (p > 1) drawHeader(doc, statementId);
  drawFooter(doc, p, totalPages, statementId, mockData.room.name, meta?.exportedBy?.name ?? 'Member');
}

// Save
const outPath = path.resolve(import.meta.dirname ?? '.', '..', 'test_statement.pdf');
const buffer = Buffer.from(doc.output('arraybuffer'));
fs.writeFileSync(outPath, buffer);
console.log(`✅ PDF saved to: ${outPath}`);
console.log(`   Pages: ${totalPages}`);
console.log(`   Transactions: ${mockData.expenses.length + mockData.contributions.length}`);
