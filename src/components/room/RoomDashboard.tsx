import React, { useMemo, useState } from 'react';
import type {
  AccountingPeriod,
  ExpenseWithReimbursement,
  Room,
  RoomFundBalance,
  RoomMember,
} from '../../models/room';
import { formatCents } from '../../utils/money';
import { CURRENCY_SYMBOL, formatDate, todayIso } from '../../utils/formatters';
import { validatePeriodDraft } from '../../utils/periods';
import { ContributionForm, ExpenseForm } from './RoomForms';
import type { ContributionInput, ExpenseInput } from './RoomForms';

type Tab = 'overview' | 'contribution' | 'expense';

interface RoomDashboardProps {
  room: Room;
  members: RoomMember[];
  balance: RoomFundBalance | null;
  expenses: ExpenseWithReimbursement[];
  periods?: AccountingPeriod[];
  activePeriod?: AccountingPeriod | null;
  currentMember: RoomMember | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  onAddContribution: (input: ContributionInput) => Promise<boolean>;
  onAddExpense: (input: ExpenseInput) => Promise<boolean>;
  onRequestReimbursement: (expenseId: string) => Promise<void>;
  onMarkPaid: (
    reimbursementId: string,
    method?: string,
    reference?: string,
    paidOn?: string
  ) => Promise<void>;
  onVoidExpense?: (expenseId: string, reason: string, reimbursementId?: string) => Promise<void>;
  onCreatePeriod?: (name: string, startsOn: string, endsOn: string) => Promise<void>;
  onClosePeriod?: (periodId: string) => Promise<void>;
  onExportPeriod?: (startsOn: string, endsOn: string) => Promise<void>;
}

export const RoomDashboard: React.FC<RoomDashboardProps> = ({
  room,
  members,
  balance,
  expenses,
  periods = [],
  activePeriod = null,
  currentMember,
  loading,
  busy,
  error,
  onAddContribution,
  onAddExpense,
  onRequestReimbursement,
  onMarkPaid,
  onVoidExpense,
  onCreatePeriod,
  onClosePeriod,
  onExportPeriod,
}) => {
  const [tab, setTab] = useState<Tab>('overview');

  // Settlement Modal State
  const [settlingClaim, setSettlingClaim] = useState<{
    claimId: string;
    expenseDesc: string;
    amountCents: number;
    payeeName: string;
  } | null>(null);
  const [settlePaidOn, setSettlePaidOn] = useState(todayIso());
  const [settleMethod, setSettleMethod] = useState('');
  const [settleReference, setSettleReference] = useState('');

  // Delete / Void Expense Modal State
  const [deletingExpense, setDeletingExpense] =
    useState<ExpenseWithReimbursement | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidError, setVoidError] = useState<string | null>(null);

  // Accounting Period Modal States
  const [showCreatePeriodModal, setShowCreatePeriodModal] = useState(false);
  const [periodName, setPeriodName] = useState('');
  const [periodStartsOn, setPeriodStartsOn] = useState(todayIso());
  const [periodEndsOn, setPeriodEndsOn] = useState(todayIso());
  const [periodErrors, setPeriodErrors] = useState<Record<string, string>>({});

  const [closingPeriod, setClosingPeriod] = useState<AccountingPeriod | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);

  const isAdmin = currentMember?.role === 'admin';

  const memberById = useMemo(() => {
    const map = new Map<string, RoomMember>();
    for (const member of members) map.set(member.id, member);
    return map;
  }, [members]);

  const memberName = (id: string): string =>
    memberById.get(id)?.display_name ?? 'Former member';

  const activeReimbursement = (expense: ExpenseWithReimbursement) =>
    (expense.reimbursements ?? []).find((item) => !item.voided_at) ?? null;

  const pendingTotal = balance?.pending_liability_cents ?? 0;

  const handleOpenSettle = (
    claimId: string,
    expenseDesc: string,
    amountCents: number,
    payeeId: string
  ) => {
    setSettlingClaim({
      claimId,
      expenseDesc,
      amountCents,
      payeeName: memberName(payeeId),
    });
    setSettlePaidOn(todayIso());
    setSettleMethod('');
    setSettleReference('');
  };

  const handleConfirmSettle = async () => {
    if (!settlingClaim) return;
    await onMarkPaid(
      settlingClaim.claimId,
      settleMethod.trim() || undefined,
      settleReference.trim() || undefined,
      settlePaidOn
    );
    setSettlingClaim(null);
  };

  const handleOpenDelete = (expense: ExpenseWithReimbursement) => {
    setDeletingExpense(expense);
    setVoidReason('');
    setVoidError(null);
  };

  const handleConfirmDelete = async () => {
    if (!deletingExpense || !onVoidExpense) return;
    if (!voidReason.trim()) {
      setVoidError('Please provide a reason for deleting this expense.');
      return;
    }
    // Pass the active (non-voided, non-paid) reimbursement ID so the handler
    // can auto-void it before voiding the expense.
    const activeReimb = activeReimbursement(deletingExpense);
    const pendingReimbId =
      activeReimb && activeReimb.status === 'pending' ? activeReimb.id : undefined;
    try {
      await onVoidExpense(deletingExpense.id, voidReason.trim(), pendingReimbId);
      setDeletingExpense(null);
    } catch (err) {
      setVoidError(
        err instanceof Error ? err.message : 'Failed to delete expense.'
      );
    }
  };

  const handleOpenCreatePeriod = () => {
    setPeriodName('');
    setPeriodStartsOn(todayIso());
    setPeriodEndsOn(todayIso());
    setPeriodErrors({});
    setShowCreatePeriodModal(true);
  };

  const handleConfirmCreatePeriod = async () => {
    if (!onCreatePeriod) return;
    const validation = validatePeriodDraft(
      { name: periodName, startsOn: periodStartsOn, endsOn: periodEndsOn },
      periods
    );

    if (!validation.ok) {
      setPeriodErrors(validation.errors);
      return;
    }

    try {
      await onCreatePeriod(periodName.trim(), periodStartsOn, periodEndsOn);
      setShowCreatePeriodModal(false);
    } catch (err) {
      setPeriodErrors({
        form: err instanceof Error ? err.message : 'Failed to create period.',
      });
    }
  };

  const handleOpenClosePeriod = (p: AccountingPeriod) => {
    setClosingPeriod(p);
    setCloseError(null);
  };

  const handleConfirmClosePeriod = async () => {
    if (!closingPeriod || !onClosePeriod) return;
    try {
      await onClosePeriod(closingPeriod.id);
      setClosingPeriod(null);
    } catch (err) {
      setCloseError(
        err instanceof Error ? err.message : 'Failed to close accounting period.'
      );
    }
  };

  const handleExportCurrentPeriod = async () => {
    if (!onExportPeriod) return;
    const from = activePeriod ? activePeriod.starts_on : '2020-01-01';
    const to = activePeriod ? activePeriod.ends_on : todayIso();
    await onExportPeriod(from, to);
  };

  return (
    <div className="room-dashboard">
      <div className="room-metrics">
        <div className="room-metric">
          <span className="room-metric-label">Fund cash</span>
          <span className="room-metric-value">
            {formatCents(balance?.fund_cash_cents ?? 0)}
          </span>
          <span className="room-metric-hint">
            {formatCents(balance?.total_contributions_cents ?? 0)} contributed
          </span>
        </div>

        <div className="room-metric">
          <span className="room-metric-label">Owed to members</span>
          <span className="room-metric-value">
            {formatCents(pendingTotal)}
          </span>
          <span className="room-metric-hint">not yet reimbursed</span>
        </div>

        <div className="room-metric room-metric--accent">
          <span className="room-metric-label">Available to spend</span>
          <span className="room-metric-value">
            {formatCents(balance?.available_balance_cents ?? 0)}
          </span>
          <span className="room-metric-hint">fund cash available for room</span>
        </div>

        <div className="room-metric">
          <span className="room-metric-label">Members</span>
          <span className="room-metric-value">{members.length}</span>
          <span className="room-metric-hint">
            {formatCents(balance?.total_reimbursed_cents ?? 0)} reimbursed
          </span>
        </div>
      </div>

      <div className="room-roomcode" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <span className="room-metric-label">Room code: <code className="room-roomcode-value">{room.join_code}</code></span>
          <div style={{ fontWeight: 600, fontSize: '0.95rem', marginTop: '0.2rem' }}>
            {activePeriod ? (
              <span>📅 {activePeriod.name} ({formatDate(activePeriod.starts_on)} → {formatDate(activePeriod.ends_on)})</span>
            ) : (
              <span>📅 All Time / Custom Ledger</span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {onExportPeriod && (
            <button
              type="button"
              className="btn btn-primary room-mini-btn"
              disabled={busy}
              onClick={() => void handleExportCurrentPeriod()}
            >
              📄 Export Statement (PDF)
            </button>
          )}

          {isAdmin && activePeriod && onClosePeriod && (
            <button
              type="button"
              className="btn btn-ghost room-mini-btn"
              disabled={busy}
              onClick={() => handleOpenClosePeriod(activePeriod)}
            >
              🔒 Close Period
            </button>
          )}

          {isAdmin && onCreatePeriod && (
            <button
              type="button"
              className="btn btn-primary room-mini-btn"
              disabled={busy}
              onClick={handleOpenCreatePeriod}
            >
              ➕ Start New Period
            </button>
          )}
        </div>
      </div>

      <div className="room-tabs" role="tablist" aria-label="Room sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'overview'}
          className={`room-tab ${tab === 'overview' ? 'is-active' : ''}`}
          onClick={() => setTab('overview')}
        >
          Overview
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'contribution'}
          className={`room-tab ${tab === 'contribution' ? 'is-active' : ''}`}
          onClick={() => setTab('contribution')}
        >
          Add contribution
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'expense'}
          className={`room-tab ${tab === 'expense' ? 'is-active' : ''}`}
          onClick={() => setTab('expense')}
        >
          Add expense
        </button>
      </div>

      {error && (
        <div className="room-notice room-notice--error" role="alert">
          {error}
        </div>
      )}

      {tab === 'contribution' && (
        <ContributionForm
          members={members}
          currentMemberId={currentMember?.id ?? null}
          isAdmin={isAdmin}
          currency={CURRENCY_SYMBOL}
          busy={busy}
          onSubmit={onAddContribution}
        />
      )}

      {tab === 'expense' && (
        <ExpenseForm
          members={members}
          currentMemberId={currentMember?.id ?? null}
          isAdmin={isAdmin}
          currency={CURRENCY_SYMBOL}
          busy={busy}
          onSubmit={onAddExpense}
        />
      )}

      {tab === 'overview' && (
        <>
          <section className="room-section">
            <h3 className="section-title">Members</h3>
            {members.length === 0 ? (
              <p className="room-hint">No members yet.</p>
            ) : (
              <ul className="room-member-list">
                {members.map((member) => (
                  <li key={member.id} className="room-member">
                    <span className="room-avatar" aria-hidden="true">
                      {member.display_name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="room-member-name">
                      {member.display_name}
                      {member.id === currentMember?.id && (
                        <span className="room-tag">you</span>
                      )}
                    </span>
                    <span className={`room-tag ${member.role === 'admin' ? 'room-tag--admin' : ''}`}>
                      {member.role === 'admin' ? 'Treasurer' : 'Member'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="room-section">
            <h3 className="section-title">
              Expenses
              {loading && <span className="room-optional"> · loading…</span>}
            </h3>

            {expenses.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon" aria-hidden="true">
                  🧾
                </div>
                <p className="empty-state-title">No expenses yet</p>
                <p className="empty-state-desc">
                  Use “Add expense” to record the first purchase for this room.
                </p>
              </div>
            ) : (
              <ul className="room-expense-list">
                {expenses.map((expense) => {
                  const claim = activeReimbursement(expense);
                  const canRequest =
                    expense.is_reimbursable &&
                    !claim &&
                    (isAdmin || expense.paid_by_member_id === currentMember?.id);
                  const canPay = Boolean(claim) && claim?.status === 'pending' && isAdmin;
                  const canDelete =
                    onVoidExpense &&
                    (isAdmin || expense.created_by_member_id === currentMember?.id);

                  return (
                    <li key={expense.id} className="room-expense">
                      <div className="room-expense-main">
                        <span className="room-expense-desc">{expense.description}</span>
                        <span className="room-expense-meta">
                          Paid by {memberName(expense.paid_by_member_id)} ·{' '}
                          {formatDate(expense.spent_on)} · {expense.category}
                        </span>
                      </div>

                      <span className="room-expense-amount">
                        {formatCents(expense.amount_cents)}
                      </span>

                      <span className="room-expense-actions">
                        {!expense.is_reimbursable && (
                          <span className="room-tag">common fund</span>
                        )}

                        {expense.is_reimbursable && !claim && (
                          <span className="room-tag">personal</span>
                        )}

                        {claim?.status === 'paid' && (
                          <span className="room-tag room-tag--paid">reimbursed</span>
                        )}

                        {claim?.status === 'pending' && (
                          <span className="room-tag room-tag--pending">pending</span>
                        )}

                        {canRequest && (
                          <button
                            type="button"
                            className="btn btn-ghost room-mini-btn"
                            disabled={busy}
                            onClick={() => void onRequestReimbursement(expense.id)}
                          >
                            Request reimbursement
                          </button>
                        )}

                        {canPay && claim && (
                          <button
                            type="button"
                            className="btn btn-primary room-mini-btn"
                            disabled={busy}
                            onClick={() =>
                              handleOpenSettle(
                                claim.id,
                                expense.description,
                                expense.amount_cents,
                                expense.paid_by_member_id
                              )
                            }
                          >
                            Mark paid
                          </button>
                        )}

                        {canDelete && (
                          <button
                            type="button"
                            className="btn btn-ghost room-mini-btn"
                            title="Delete / Void Expense"
                            disabled={busy}
                            onClick={() => handleOpenDelete(expense)}
                          >
                            🗑️ Delete
                          </button>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      {/* Settle Reimbursement Modal */}
      {settlingClaim && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="modal-header">
              <h3 className="modal-title">Settle Reimbursement</h3>
              <button
                type="button"
                className="btn btn-ghost room-mini-btn"
                onClick={() => setSettlingClaim(null)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p>
                Pay <strong>{settlingClaim.payeeName}</strong>{' '}
                <strong>{formatCents(settlingClaim.amountCents)}</strong> from the shared common fund for:
              </p>
              <p className="room-hint">“{settlingClaim.expenseDesc}”</p>

              <div className="form-group">
                <label className="form-label">Payment Date</label>
                <input
                  type="date"
                  className="form-input"
                  value={settlePaidOn}
                  onChange={(e) => setSettlePaidOn(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  Payment Method <span className="room-optional">(optional)</span>
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. UPI, Cash, Bank Transfer"
                  value={settleMethod}
                  onChange={(e) => setSettleMethod(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  Reference / Transaction ID <span className="room-optional">(optional)</span>
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. UPI Ref #987654321"
                  value={settleReference}
                  onChange={(e) => setSettleReference(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setSettlingClaim(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleConfirmSettle()}
                disabled={busy || !settlePaidOn}
              >
                {busy ? 'Settling…' : 'Confirm Settlement'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete / Void Expense Confirmation Modal */}
      {deletingExpense && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="modal-header">
              <h3 className="modal-title">Delete / Void Expense</h3>
              <button
                type="button"
                className="btn btn-ghost room-mini-btn"
                onClick={() => setDeletingExpense(null)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="room-notice room-notice--error">
                ⚠️ Are you sure you want to delete this expense? This will update the room balance history.
              </div>

              {/* Warn when an active reimbursement will also be auto-voided */}
              {(() => {
                const reimb = activeReimbursement(deletingExpense);
                if (reimb && reimb.status === 'pending') {
                  return (
                    <div className="room-notice" style={{ background: 'rgba(251,191,36,0.12)', borderColor: 'var(--color-warning, #f59e0b)', color: 'var(--color-warning, #f59e0b)' }}>
                      🔗 This expense has a <strong>pending reimbursement request</strong>. It will be automatically cancelled along with the expense.
                    </div>
                  );
                }
                return null;
              })()}

              <p>
                <strong>{deletingExpense.description}</strong> — {formatCents(deletingExpense.amount_cents)}
              </p>

              <div className="form-group">
                <label className="form-label">Reason for deletion (required)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Entered accidentally, duplicate entry..."
                  value={voidReason}
                  onChange={(e) => {
                    setVoidReason(e.target.value);
                    setVoidError(null);
                  }}
                />
                {voidError && <span className="form-error">{voidError}</span>}
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setDeletingExpense(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ background: 'var(--color-danger)' }}
                onClick={() => void handleConfirmDelete()}
                disabled={busy}
              >
                {busy ? 'Deleting…' : 'Confirm Deletion'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Start New Accounting Period Modal */}
      {showCreatePeriodModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="modal-header">
              <h3 className="modal-title">Start New Accounting Period</h3>
              <button
                type="button"
                className="btn btn-ghost room-mini-btn"
                onClick={() => setShowCreatePeriodModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              {periodErrors.form && (
                <div className="room-notice room-notice--error">
                  {periodErrors.form}
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Period Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. October 2026 / 29 Sep → 28 Oct"
                  value={periodName}
                  onChange={(e) => setPeriodName(e.target.value)}
                />
                {periodErrors.name && (
                  <span className="form-error">{periodErrors.name}</span>
                )}
              </div>

              <div className="room-form-row">
                <div className="form-group">
                  <label className="form-label">Start Date</label>
                  <input
                    type="date"
                    className="form-input"
                    value={periodStartsOn}
                    onChange={(e) => setPeriodStartsOn(e.target.value)}
                  />
                  {periodErrors.startsOn && (
                    <span className="form-error">{periodErrors.startsOn}</span>
                  )}
                </div>

                <div className="form-group">
                  <label className="form-label">End Date</label>
                  <input
                    type="date"
                    className="form-input"
                    value={periodEndsOn}
                    onChange={(e) => setPeriodEndsOn(e.target.value)}
                  />
                  {periodErrors.endsOn && (
                    <span className="form-error">{periodErrors.endsOn}</span>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowCreatePeriodModal(false)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleConfirmCreatePeriod()}
                disabled={busy}
              >
                {busy ? 'Creating…' : 'Start Period'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Close Accounting Period Modal */}
      {closingPeriod && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="modal-header">
              <h3 className="modal-title">Close Period: {closingPeriod.name}</h3>
              <button
                type="button"
                className="btn btn-ghost room-mini-btn"
                onClick={() => setClosingPeriod(null)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              {pendingTotal > 0 && (
                <div className="room-notice room-notice--error">
                  ⚠️ Warning: There are {formatCents(pendingTotal)} in pending reimbursements.
                  Please settle or void pending claims before closing this period.
                </div>
              )}

              {closeError && (
                <div className="room-notice room-notice--error">
                  {closeError}
                </div>
              )}

              <p>
                Closing <strong>{closingPeriod.name}</strong> ({formatDate(closingPeriod.starts_on)} → {formatDate(closingPeriod.ends_on)}) will lock this period's ledger records into historical reference.
              </p>
              <p className="room-hint">
                You can export report data at any time before or after closing.
              </p>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setClosingPeriod(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleConfirmClosePeriod()}
                disabled={busy}
              >
                {busy ? 'Closing…' : 'Confirm & Close Period'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
