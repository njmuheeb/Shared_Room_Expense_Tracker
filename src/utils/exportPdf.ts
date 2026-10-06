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
 * Banking-style palette. Navy + charcoal + accent emerald/red.
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
    gold: [197, 145, 39] as [number, number, number],
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
 * "EXPENSE STATEMENT" on the right.
 */
function drawHeader(doc: jsPDF, data: RoomExport): number {
    const bandH = 26;
    const y = PAGE.margin;

    setFill(doc, COLORS.navy);
    doc.rect(PAGE.margin, y, PAGE.contentWidth, bandH, 'F');

    // Accent line.
    setFill(doc, COLORS.navyDark);
    doc.rect(PAGE.margin, y + bandH - 1.5, PAGE.contentWidth, 1.5, 'F');

    // Brand mark
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

    // Right side — statement title + ID
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('EXPENSE STATEMENT', PAGE.margin + PAGE.contentWidth - 6, y + 12, {
        align: 'right',
    });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    const code = data.room.join_code ?? data.room.id.slice(0, 8).toUpperCase();
    const statementId = data.metadata?.statementId ?? `RF-${code}-${data.range.from.replace(/-/g, '')}`;
    doc.text(
        `Statement ID: ${statementId}`,
        PAGE.margin + PAGE.contentWidth - 6,
        y + 18,
        { align: 'right' }
    );

    return y + bandH;
}

/**
 * Account & Exporter & Approval info block.
 */
function drawAccountInfo(
    doc: jsPDF,
    data: RoomExport,
    y: number
): number {
    const boxH = 46;
    const meta = data.metadata;

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

    const col1X = PAGE.margin + 6;
    const col2X = PAGE.margin + PAGE.contentWidth / 2 + 6;

    // --- Col 1: Room & Statement Scope ---
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    setText(doc, COLORS.slate);
    doc.text('ROOM & CODE', col1X, y + 8);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    setText(doc, COLORS.navy);
    doc.text(`${data.room.name} [${data.room.join_code ?? 'CODE'}]`, col1X, y + 14);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    setText(doc, COLORS.slate);
    doc.text('STATEMENT SCOPE / PERIOD', col1X, y + 21);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    setText(doc, COLORS.charcoal);
    const scopeLabel = meta?.periodName
        ? `${meta.periodName} (${meta.periodStatus ?? 'OPEN'})`
        : meta?.spansMultiplePeriods
        ? 'Custom Date Range (Spans multiple periods)'
        : 'Custom Date Range';
    doc.text(scopeLabel, col1X, y + 27);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    setText(doc, COLORS.slate);
    const dateRangeStr = meta?.periodStatus === 'OPEN' && data.range.to >= new Date().toISOString().slice(0, 10)
        ? `${formatDate(data.range.from)} → Present (Open)`
        : `${formatDate(data.range.from)} → ${formatDate(data.range.to)}`;
    doc.text(`Period: ${dateRangeStr}`, col1X, y + 33);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(`Currency: ${data.room.currency} (₹)`, col1X, y + 39);

    // --- Col 2: Exporter & Digital Approval ---
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    setText(doc, COLORS.slate);
    doc.text('EXPORTED BY', col2X, y + 8);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    setText(doc, COLORS.charcoal);
    const exporterName = meta?.exportedBy?.name ?? 'Room Member';
    const exporterRole = meta?.exportedBy?.role ? ` (${meta.exportedBy.role})` : '';
    doc.text(`${exporterName}${exporterRole}`, col2X, y + 14);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    setText(doc, COLORS.slate);
    doc.text('ADMIN DIGITAL APPROVAL STATUS', col2X, y + 21);

    const isApproved = meta?.adminApproval?.status === 'DIGITALLY APPROVED';
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    setText(doc, isApproved ? COLORS.credit : COLORS.gold);
    doc.text(
        isApproved ? '✓ DIGITALLY APPROVED BY ROOM ADMIN' : '⏳ PENDING ADMIN APPROVAL',
        col2X,
        y + 27
    );

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    setText(doc, COLORS.charcoal);
    if (isApproved && meta?.adminApproval?.approvedBy) {
        doc.text(
            `Approved By: ${meta.adminApproval.approvedBy} on ${meta.adminApproval.approvedAt ? formatDate(meta.adminApproval.approvedAt) : formatDate(new Date().toISOString())}`,
            col2X,
            y + 33
        );
        doc.setFontSize(7);
        setText(doc, COLORS.slate);
        doc.text('Status: Digitally approved by room administrator.', col2X, y + 39);
    } else {
        doc.text('Generated for accounting review.', col2X, y + 33);
        doc.setFontSize(7);
        setText(doc, COLORS.slate);
        doc.text('Status: Pending room administrator digital approval signature.', col2X, y + 39);
    }

    return y + boxH;
}

/**
 * Financial summary: 5 key metrics.
 */
function drawBalanceSummary(doc: jsPDF, data: RoomExport, y: number): number {
    const blockH = 22;

    setFill(doc, COLORS.navy);
    doc.rect(PAGE.margin, y, PAGE.contentWidth, blockH, 'F');

    const credits = data.summary.contributions_cents;
    const commonExp = data.summary.common_expenses_cents;
    const personalExp = data.summary.personal_expenses_cents;
    const reimbursed = data.summary.reimbursed_cents;
    const available = data.summary.available_cents;

    const cells: Array<{ label: string; amount: string; color: RGB }> = [
        { label: 'CONTRIBUTIONS', amount: formatCentsPlain(credits), color: COLORS.credit },
        { label: 'COMMON EXP', amount: formatCentsPlain(commonExp), color: COLORS.debit },
        { label: 'PERSONAL EXP', amount: formatCentsPlain(personalExp), color: COLORS.white },
        { label: 'REIMBURSED', amount: formatCentsPlain(reimbursed), color: COLORS.white },
        { label: 'AVAILABLE FUND', amount: formatCentsPlain(available), color: COLORS.white },
    ];

    const colW = PAGE.contentWidth / 5;
    cells.forEach((cell, i) => {
        const x = PAGE.margin + i * colW;

        if (i > 0) {
            setDraw(doc, COLORS.navyDark);
            doc.setLineWidth(0.2);
            doc.line(x, y + 4, x, y + blockH - 4);
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6);
        setText(doc, COLORS.slate);
        doc.text(cell.label, x + 4, y + 8);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        setText(doc, cell.color);
        doc.text(cell.amount, x + 4, y + 16);
    });

    return y + blockH;
}

/**
 * Member breakdown table.
 */
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
    if (members.length === 0) return startY;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    setText(doc, COLORS.navy);
    doc.text('MEMBER ACTIVITY SUMMARY', PAGE.margin, startY);
    rule(doc, PAGE.margin, startY + 2, PAGE.contentWidth, COLORS.navy, 0.4);

    const head = [['Member', 'Total Contributed', 'Personal Paid', 'Total Reimbursed']];
    const body = members.map((m) => [
        m.name,
        formatCentsPlain(m.contributed),
        formatCentsPlain(m.personalPaid),
        formatCentsPlain(m.reimbursed),
    ]);

    autoTable(doc, {
        startY: startY + 4,
        margin: { left: PAGE.margin, right: PAGE.margin, bottom: PAGE.margin + 22 },
        head,
        body,
        theme: 'grid',
        styles: {
            font: 'helvetica',
            fontSize: 8,
            cellPadding: 2,
            textColor: COLORS.charcoal,
            lineColor: COLORS.rule,
            lineWidth: 0.1,
        },
        headStyles: {
            fillColor: COLORS.navy,
            textColor: COLORS.white,
            fontStyle: 'bold',
            fontSize: 8,
        },
        alternateRowStyles: { fillColor: COLORS.rowAlt },
        columnStyles: {
            0: { cellWidth: 'auto', fontStyle: 'bold' },
            1: { cellWidth: 40, halign: 'right', textColor: COLORS.credit, fontStyle: 'bold' },
            2: { cellWidth: 40, halign: 'right' },
            3: { cellWidth: 40, halign: 'right' },
        },
        didDrawPage: (hookData) => {
            drawFooter(doc, data, hookData.pageNumber, doc.getNumberOfPages());
        },
    });

    return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

/**
 * Combined transaction ledger.
 */
function drawTransactionHistory(
    doc: jsPDF,
    data: RoomExport,
    startY: number
): void {
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
            status: e.payment_source === 'personal' ? `Reimb: ${reimbStr}` : 'Common Spent',
        });
    });

    rows.sort((a, b) => a.date.localeCompare(b.date));

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    setText(doc, COLORS.navy);
    doc.text('TRANSACTION LEDGER', PAGE.margin, startY);
    rule(doc, PAGE.margin, startY + 2, PAGE.contentWidth, COLORS.navy, 0.4);

    if (rows.length === 0) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        setText(doc, COLORS.slate);
        doc.text('No active transactions recorded for this period.', PAGE.margin, startY + 10);
        (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable = { finalY: startY + 14 };
        return;
    }

    const head = [['#', 'Date', 'Type & Description', 'Paid By', 'Credit', 'Debit', 'Status']];
    const body = rows.map((row, i) => [
        String(i + 1),
        formatDate(row.date),
        `${row.type}\n${row.narration}`,
        row.member,
        row.credit ? formatCentsPlain(row.credit) : '',
        row.debit ? formatCentsPlain(row.debit) : '',
        row.status,
    ]);

    autoTable(doc, {
        startY: startY + 4,
        margin: { left: PAGE.margin, right: PAGE.margin, bottom: PAGE.margin + 22 },
        head,
        body,
        theme: 'grid',
        styles: {
            font: 'helvetica',
            fontSize: 7.8,
            cellPadding: 2,
            textColor: COLORS.charcoal,
            lineColor: COLORS.rule,
            lineWidth: 0.1,
        },
        headStyles: {
            fillColor: COLORS.navy,
            textColor: COLORS.white,
            fontStyle: 'bold',
            fontSize: 8,
        },
        alternateRowStyles: { fillColor: COLORS.rowAlt },
        columnStyles: {
            0: { cellWidth: 8, halign: 'center', fontStyle: 'bold' },
            1: { cellWidth: 20 },
            2: { cellWidth: 'auto' },
            3: { cellWidth: 24 },
            4: { cellWidth: 22, halign: 'right', textColor: COLORS.credit, fontStyle: 'bold' },
            5: { cellWidth: 22, halign: 'right', textColor: COLORS.debit, fontStyle: 'bold' },
            6: { cellWidth: 26, fontSize: 7, halign: 'center' },
        },
        didDrawPage: (hookData) => {
            drawFooter(doc, data, hookData.pageNumber, doc.getNumberOfPages());
        },
    });
}

/**
 * Footer bar on every page.
 */
function drawFooter(
    doc: jsPDF,
    data: RoomExport,
    page: number,
    pages: number
): void {
    const footerH = 14;
    const y = PAGE.height - PAGE.margin - footerH + 6;
    const meta = data.metadata;
    const code = data.room.join_code ?? data.room.id.slice(0, 8).toUpperCase();
    const statementId = meta?.statementId ?? `RF-${code}-${data.range.from.replace(/-/g, '')}`;

    setFill(doc, COLORS.navy);
    doc.rect(PAGE.margin, y, PAGE.contentWidth, footerH, 'F');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    setText(doc, COLORS.white);

    const approvalText = meta?.adminApproval?.status === 'DIGITALLY APPROVED'
        ? `Digitally Approved by Admin: ${meta.adminApproval.approvedBy ?? 'Admin'}`
        : 'Status: Pending Admin Approval';

    doc.text(
        `RoomFund · Statement ${statementId} · Exported by: ${meta?.exportedBy?.name ?? 'Member'} · ${approvalText}`,
        PAGE.margin + 4,
        y + 5
    );

    doc.text(
        'Note: This document provides digital approval tracking and does not constitute a cryptographic certificate signature.',
        PAGE.margin + 4,
        y + 10
    );

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text(
        `Page ${page} of ${pages}`,
        PAGE.margin + PAGE.contentWidth - 4,
        y + 5,
        { align: 'right' }
    );
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.text(
        `Exported: ${formatDateTimeLong(new Date())}`,
        PAGE.margin + PAGE.contentWidth - 4,
        y + 10,
        { align: 'right' }
    );
}

/**
 * Builds and returns the professional expense PDF statement.
 */
export function buildRoomExpensesPdf(data: RoomExport): Blob {
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

    let y = drawHeader(doc, data);
    y += 4;
    y = drawAccountInfo(doc, data, y);
    y += 4;
    y = drawBalanceSummary(doc, data, y);
    y += 6;

    y = drawMemberSummary(doc, data, y);
    y += 6;

    drawTransactionHistory(doc, data, y);

    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p += 1) {
        doc.setPage(p);
        drawFooter(doc, data, p, pages);
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