import React, { useMemo, useState } from 'react';
import type {
  ExpenseWithReimbursement,
  Room,
  RoomFundBalance,
  RoomMember,
} from '../../models/room';
import { formatCents } from '../../utils/money';
import { formatDate } from '../../utils/formatters';
import { ContributionForm, ExpenseForm } from './RoomForms';
import type { ContributionInput, ExpenseInput } from './RoomForms';

type Tab = 'overview' | 'contribution' | 'expense';

interface RoomDashboardProps {
  room: Room;
  members: RoomMember[];
  balance: RoomFundBalance | null;
  expenses: ExpenseWithReimbursement[];
  currentMember: RoomMember | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  onAddContribution: (input: ContributionInput) => Promise<boolean>;
  onAddExpense: (input: ExpenseInput) => Promise<boolean>;
  onRequestReimbursement: (expenseId: string) => Promise<void>;
  onMarkPaid: (reimbursementId: string) => Promise<void>;
}

export const RoomDashboard: React.FC<RoomDashboardProps> = ({
  room,
  members,
  balance,
  expenses,
  currentMember,
  loading,
  busy,
  error,
  onAddContribution,
  onAddExpense,
  onRequestReimbursement,
  onMarkPaid,
}) => {
  const [tab, setTab] = useState<Tab>('overview');

  const isAdmin = currentMember?.role === 'admin';
  const currency = room.currency;

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

  return (
    <div className="room-dashboard">
      <div className="room-metrics">
        <div className="room-metric">
          <span className="room-metric-label">Fund cash</span>
          <span className="room-metric-value">
            {formatCents(balance?.fund_cash_cents ?? 0, currency)}
          </span>
          <span className="room-metric-hint">
            {formatCents(balance?.total_contributions_cents ?? 0, currency)} contributed
          </span>
        </div>

        <div className="room-metric">
          <span className="room-metric-label">Owed to members</span>
          <span className="room-metric-value">
            {formatCents(pendingTotal, currency)}
          </span>
          <span className="room-metric-hint">not yet reimbursed</span>
        </div>

        <div className="room-metric room-metric--accent">
          <span className="room-metric-label">Available to spend</span>
          <span className="room-metric-value">
            {formatCents(balance?.available_balance_cents ?? 0, currency)}
          </span>
          <span className="room-metric-hint">fund cash − outstanding claims</span>
        </div>

        <div className="room-metric">
          <span className="room-metric-label">Members</span>
          <span className="room-metric-value">{members.length}</span>
          <span className="room-metric-hint">
            {formatCents(balance?.total_reimbursed_cents ?? 0, currency)} reimbursed
          </span>
        </div>
      </div>

      <div className="room-roomcode">
        <span className="room-metric-label">Room code</span>
        <code className="room-roomcode-value">{room.join_code}</code>
        <span className="room-metric-hint">Share this with roommates so they can join.</span>
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
          currency={currency}
          busy={busy}
          onSubmit={onAddContribution}
        />
      )}

      {tab === 'expense' && (
        <ExpenseForm
          members={members}
          currentMemberId={currentMember?.id ?? null}
          isAdmin={isAdmin}
          currency={currency}
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
                        {formatCents(expense.amount_cents, currency)}
                      </span>

                      <span className="room-expense-actions">
                        {!expense.is_reimbursable && (
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
                            onClick={() => void onMarkPaid(claim.id)}
                          >
                            Mark paid
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
    </div>
  );
};
