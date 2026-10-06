
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { RoomExport } from '../models/room';
import { formatCentsPlain } from './money';
import { formatDate, formatDateTimeLong } from './formatters';
import { resolveCategory } from './constants';

/** Page geometry, in millimetres (jsPDF's default unit). */
const PAGE = {
    width: 210,
    height: 297,
    margin: 14,
    get contentWidth(): number {
        return this.width - this.margin * 2;
    },
};

/**
 * Banking-style palette. Navy + charcoal + a single accent green for credits
 * and red for debits. Deliberately restrained — no gradients.
 */
const COLORS = {
    navy: [22, 33, 62] as [number, number, number],
    navyDark: [12, 20, 40] as [number, number, number],
    charcoal: [40, 44, 56] as [number, number, number],
    slate: [99, 105, 122] as [number, number, number],
    rule: [210, 214, 224] as [number, number, number],
    rowAlt: [247, 249, 252] as [number, number, number],
    credit: [16, 122, 87] as [number, number, number], // emerald
    debit: [186, 38, 38] as [number, number, number], // red
    white: [255, 255, 255] as [number, number, number],
    cream: [252, 250, 245] as [number, number, number],
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

/** Draws a horizontal rule of the given weight. */
function rule(doc: jsPDF, x: number, y: number, w: number, color: RGB = COLORS.rule, weight = 0.2): void {
    setDraw(doc, color);
    doc.setLineWidth(weight);
    doc.line(x, y, x + w, y);
}

/**
 * Header band: a solid navy rectangle with the brand mark on the left and
 * "EXPENSE STATEMENT" on the right. Two-line title underneath in white.
 */
function drawHeader(doc: jsPDF, data: RoomExport): number {
    const bandH = 26;
    const y = PAGE.margin;

    setFill(doc, COLORS.navy);
    doc.rect(PAGE.margin, y, PAGE.contentWidth, bandH, 'F');

    // Thin accent line at the bottom of the band.
    setFill(doc, COLORS.navyDark);
    doc.rect(PAGE.margin, y + bandH - 1.5, PAGE.contentWidth, 1.5, 'F');

    // Brand mark — small filled square + wordmark.
    setFill(doc, COLORS.white);
    doc.rect(PAGE.margin + 6, y + 8, 6, 10, 'F');
    setFill(doc, COLORS.navy);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('R', PAGE.margin + 6 + 1.5, y + 15);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    setText(doc, COLORS.white);
    doc.text('ROOMFUND', PAGE.margin + 16, y + 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text('Shared Room Expense Tracker', PAGE.margin + 16, y + 18);

    // Right side — statement type.
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('EXPENSE STATEMENT', PAGE.margin + PAGE.contentWidth - 6, y + 12, {
        align: 'right',
    });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(
        `Account No. ${data.room.id.slice(0, 8).toUpperCase()}`,
        PAGE.margin + PAGE.contentWidth - 6,
        y + 18,
        { align: 'right' }
    );

    return y + bandH;
}

/**
 * Account-info block: a tinted box under the header listing the account
 * holder, account number, statement period, and generation timestamp.
 */
function drawAccountInfo(
    doc: jsPDF,
    data: RoomExport,
    range: { from: string; to: string; isAllTime: boolean },
    y: number
): number {
    const boxH = 30;

    setFill(doc, COLORS.cream);
    doc.rect(PAGE.margin, y, PAGE.contentWidth, boxH, 'F');
    setDraw(doc, COLORS.rule);
    doc.setLineWidth(0.2);
    doc.rect(PAGE.margin, y, PAGE.contentWidth, boxH, 'S');

    // Vertical divider down the middle.
    doc.line(
        PAGE.margin + PAGE.contentWidth / 2,
        y + 4,
        PAGE.margin + PAGE.contentWidth / 2,
        y + boxH - 4
    );

    const colX = PAGE.margin + 6;

    // Left column
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    setText(doc, COLORS.slate);
    doc.text('ACCOUNT HOLDER', colX, y + 9);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    setText(doc, COLORS.navy);
    doc.text(data.room.name, colX, y + 15);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    setText(doc, COLORS.slate);
    doc.text('STATEMENT PERIOD', colX, y + 22);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    setText(doc, COLORS.charcoal);
    doc.text(
        range.isAllTime
            ? 'All time ledger (no period set)'
            : `${formatDate(range.from)} to ${formatDate(range.to)}`,
        colX,
        y + 28
    );

    // Right column
    const rightX = PAGE.margin + PAGE.contentWidth / 2 + 6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    setText(doc, COLORS.slate);
    doc.text('CURRENCY', rightX, y + 9);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    setText(doc, COLORS.navy);
    doc.text(`${data.room.currency} (₹)`, rightX, y + 15);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    setText(doc, COLORS.slate);
    doc.text('GENERATED ON', rightX, y + 22);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    setText(doc, COLORS.charcoal);
    doc.text(formatDateTimeLong(new Date()), rightX, y + 28);

    return y + boxH;
}

/**
 * Balance summary: four columns — Opening, Credits, Debits, Closing.
 * Numbers are right-aligned and credits/debits are tinted green/red.
 */
function drawBalanceSummary(doc: jsPDF, data: RoomExport, y: number): number {
    const blockH = 22;

    setFill(doc, COLORS.navy);
    doc.rect(PAGE.margin, y, PAGE.contentWidth, blockH, 'F');

    const opening = 0;
    const credits = data.summary.contributions_cents;
    const debits =
        data.summary.common_expenses_cents + data.summary.personal_expenses_cents;
    const closing = data.summary.available_cents;

    const cells: Array<{ label: string; amount: string; color: RGB }> = [
        { label: 'OPENING BALANCE', amount: formatCentsPlain(opening), color: COLORS.white },
        { label: 'TOTAL CREDITS', amount: formatCentsPlain(credits), color: COLORS.credit },
        { label: 'TOTAL DEBITS', amount: formatCentsPlain(debits), color: COLORS.debit },
        { label: 'CLOSING BALANCE', amount: formatCentsPlain(closing), color: COLORS.white },
    ];

    const colW = PAGE.contentWidth / 4;
    cells.forEach((cell, i) => {
        const x = PAGE.margin + i * colW;

        // Subtle vertical separator.
        if (i > 0) {
            setDraw(doc, COLORS.navyDark);
            doc.setLineWidth(0.2);
            doc.line(x, y + 4, x, y + blockH - 4);
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.5);
        setText(doc, COLORS.slate);
        doc.text(cell.label, x + 6, y + 8);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        setText(doc, cell.color);
        doc.text(cell.amount, x + 6, y + 16);
    });

    return y + blockH;
}

/**
 * The combined transaction ledger. Contributions are credits, expenses are
 * debits, sorted by date — exactly how a bank statement presents a current
 * account. Includes a running balance column.
 */
function drawTransactionHistory(
    doc: jsPDF,
    data: RoomExport,
    startY: number
): void {
    // Merge contributions + expenses into one dated ledger.
    type Row = {
        date: string;
        narration: string;
        member: string;
        credit: number;
        debit: number;
        balanceAfter: number;
    };

    const rows: Row[] = [];
    let balance = 0;

    const credits = data.contributions.map((c) => ({
        date: c.contributed_on,
        narration: c.note ? `Contribution — ${c.note}` : 'Contribution',
        member: c.display_name,
        amount: c.amount_cents,
    }));
    const debits = data.expenses.map((e) => {
        const cat = resolveCategory(e.category);
        return {
            date: e.spent_on,
            narration: e.note ? `${e.description} — ${e.note}` : e.description,
            member: e.paid_by,
            amount: e.amount_cents,
            category: cat.name,
        };
    });

    // Combine and sort by date ascending (oldest first).
    const combined: Array<{ date: string; kind: 'credit' | 'debit' } & Record<string, unknown>> = [
        ...credits.map((c) => ({ ...c, kind: 'credit' as const })),
        ...debits.map((d) => ({ ...d, kind: 'debit' as const })),
    ].sort((a, b) => a.date.localeCompare(b.date));

    for (const item of combined) {
        if (item.kind === 'credit') {
            balance += item.amount as number;
            rows.push({
                date: item.date as string,
                narration: item.narration as string,
                member: item.member as string,
                credit: item.amount as number,
                debit: 0,
                balanceAfter: balance,
            });
        } else {
            balance -= item.amount as number;
            rows.push({
                date: item.date as string,
                narration: item.narration as string,
                member: item.member as string,
                credit: 0,
                debit: item.amount as number,
                balanceAfter: balance,
            });
        }
    }

    const head = [['#', 'Date', 'Narration', 'Member', 'Credit', 'Debit', 'Balance']];
    const body = rows.map((row, i) => [
        String(i + 1),
        formatDate(row.date),
        row.narration,
        row.member,
        row.credit ? formatCentsPlain(row.credit) : '',
        row.debit ? formatCentsPlain(row.debit) : '',
        formatCentsPlain(row.balanceAfter),
    ]);

    autoTable(doc, {
        startY,
        margin: { left: PAGE.margin, right: PAGE.margin, bottom: PAGE.margin + 22 },
        head,
        body,
        theme: 'grid',
        styles: {
            font: 'helvetica',
            fontSize: 8.2,
            cellPadding: 2.4,
            textColor: COLORS.charcoal,
            lineColor: COLORS.rule,
            lineWidth: 0.1,
        },
        headStyles: {
            fillColor: COLORS.navy,
            textColor: COLORS.white,
            fontStyle: 'bold',
            fontSize: 8,
            lineColor: COLORS.navy,
        },
        alternateRowStyles: { fillColor: COLORS.rowAlt },
        columnStyles: {
            0: { cellWidth: 10, halign: 'center', fontStyle: 'bold' },
            1: { cellWidth: 22 },
            2: { cellWidth: 'auto' },
            3: { cellWidth: 26 },
            4: { cellWidth: 24, halign: 'right', textColor: COLORS.credit, fontStyle: 'bold' },
            5: { cellWidth: 24, halign: 'right', textColor: COLORS.debit, fontStyle: 'bold' },
            6: { cellWidth: 26, halign: 'right', fontStyle: 'bold' },
        },
        didDrawPage: (hookData) => {
            // Stamp the footer on every page autoTable creates.
            const pages = doc.getNumberOfPages();
            const current = hookData.pageNumber;
            drawFooter(doc, data, current, pages);
        },
    });
}

/**
 * Per-category breakdown block — small two-column table showing total spent
 * in each category. Rendered after the ledger; auto-paginates if it doesn't
 * fit on the last page.
 */
function drawCategoryBreakdown(doc: jsPDF, data: RoomExport, startY: number): void {
    // Fold expenses into category totals.
    const totals = new Map<string, number>();
    for (const e of data.expenses) {
        const cat = resolveCategory(e.category).name;
        totals.set(cat, (totals.get(cat) ?? 0) + e.amount_cents);
    }

    if (totals.size === 0) return; // nothing to show

    const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    const head = [['Category', 'Transactions', 'Total Amount']];
    const counts = new Map<string, number>();
    for (const e of data.expenses) {
        const cat = resolveCategory(e.category).name;
        counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    const body = sorted.map(([cat, amount]) => [
        cat,
        String(counts.get(cat) ?? 0),
        formatCentsPlain(amount),
    ]);

    autoTable(doc, {
        startY: startY + 4,
        margin: { left: PAGE.margin, right: PAGE.margin, bottom: PAGE.margin + 22 },
        head,
        body,
        theme: 'grid',
        styles: {
            font: 'helvetica',
            fontSize: 8.2,
            cellPadding: 2.4,
            textColor: COLORS.charcoal,
            lineColor: COLORS.rule,
            lineWidth: 0.1,
        },
        headStyles: {
            fillColor: COLORS.charcoal,
            textColor: COLORS.white,
            fontStyle: 'bold',
            fontSize: 8,
        },
        alternateRowStyles: { fillColor: COLORS.rowAlt },
        columnStyles: {
            0: { cellWidth: 'auto', fontStyle: 'bold' },
            1: { cellWidth: 36, halign: 'center' },
            2: { cellWidth: 36, halign: 'right', fontStyle: 'bold' },
        },
        didDrawPage: (hookData) => {
            const pages = doc.getNumberOfPages();
            const current = hookData.pageNumber;
            drawFooter(doc, data, current, pages);
        },
    });
}

/**
 * Footer bar on every page — thin navy strip with "Computer-generated
 * statement" on the left and page number on the right.
 */
function drawFooter(
    doc: jsPDF,
    _data: RoomExport,
    page: number,
    pages: number
): void {
    const footerH = 14;
    const y = PAGE.height - PAGE.margin - footerH + 6;

    setFill(doc, COLORS.navy);
    doc.rect(PAGE.margin, y, PAGE.contentWidth, footerH, 'F');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    setText(doc, COLORS.white);
    doc.text(
        'RoomFund · Computer-generated statement · This document is system-generated and requires no signature.',
        PAGE.margin + 6,
        y + 6
    );

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text(
        `Page ${page} of ${pages}`,
        PAGE.margin + PAGE.contentWidth - 6,
        y + 6,
        { align: 'right' }
    );
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(
        `Generated ${formatDateTimeLong(new Date())}`,
        PAGE.margin + PAGE.contentWidth - 6,
        y + 11,
        { align: 'right' }
    );
}

/**
 * Detects the "all time" sentinel range (from=2020-01-01 and to=today) used
 * by the dashboard when no accounting period is set.
 */
function describeRange(range: { from: string; to: string }): {
    from: string;
    to: string;
    isAllTime: boolean;
} {
    const todayIso = new Date().toISOString().slice(0, 10);
    return {
        from: range.from,
        to: range.to,
        isAllTime: range.from === '2020-01-01' && range.to === todayIso,
    };
}

/**
 * Builds and returns the banking-style expense PDF for one `RoomExport`
 * payload. Caller triggers a download with `downloadPdf(filename, blob)`.
 */
export function buildRoomExpensesPdf(data: RoomExport): Blob {
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const range = describeRange(data.range);

    // Header → account info → balance summary.
    let y = drawHeader(doc, data);
    y += 6;
    y = drawAccountInfo(doc, data, range, y);
    y += 6;
    y = drawBalanceSummary(doc, data, y);
    y += 8;

    // Transaction history heading.
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    setText(doc, COLORS.navy);
    doc.text('TRANSACTION HISTORY', PAGE.margin, y);
    rule(doc, PAGE.margin, y + 2, PAGE.contentWidth, COLORS.navy, 0.4);
    y += 6;

    // Ledger table (auto-paginates) → returns the Y where the table ended.
    drawTransactionHistory(doc, data, y);

    // Read the final Y from autoTable's lastAutoTable property.
    const lastY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

    // Category breakdown heading + table.
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    setText(doc, COLORS.navy);
    doc.text('EXPENSES BY CATEGORY', PAGE.margin, lastY + 12);
    rule(doc, PAGE.margin, lastY + 14, PAGE.contentWidth, COLORS.navy, 0.4);

    drawCategoryBreakdown(doc, data, lastY + 14);

    // Final pass — make sure every page has the footer (cheap insurance in
    // case the autoTable hooks missed one).
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p += 1) {
        doc.setPage(p);
        drawFooter(doc, data, p, pages);
    }

    return doc.output('blob');
}

/** Builds `<room-slug>_<from>_<to>.pdf` for one export call. */
export function pdfExportFilename(
    roomName: string,
    startsOn: string,
    endsOn: string
): string {
    const slug =
        roomName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60) || 'room';
    return `${slug}_${startsOn}_to_${endsOn}.pdf`;
}

/**
 * Triggers a browser download of `blob` as `filename`. Uses a Blob URL so
 * nothing is round-tripped through a server.
 */
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