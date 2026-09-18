import React, { useState } from 'react';
import type { RoomMember } from '../../models/room';
import { EXPENSE_CATEGORIES } from '../../utils/constants';
import { todayIso } from '../../utils/formatters';
import { toCents } from '../../utils/money';

const DEFAULT_CATEGORY = EXPENSE_CATEGORIES[0]?.id ?? 'other';

function parseAmount(value: string): number | null {
  if (!value.trim()) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return toCents(numeric);
}

function memberLabel(member: RoomMember, currentMemberId: string | null): string {
  const isSelf = member.id === currentMemberId;
  const role = member.role === 'admin' ? ' (treasurer)' : '';
  return `${member.display_name}${isSelf ? ' — you' : ''}${role}`;
}

// ---------------------------------------------------------------------------
// Contributions — money paid INTO the shared fund
// ---------------------------------------------------------------------------

export interface ContributionInput {
  memberId: string;
  amountCents: number;
  contributedOn: string;
  method: string;
  note: string;
}

interface ContributionFormProps {
  members: RoomMember[];
  currentMemberId: string | null;
  isAdmin: boolean;
  currency: string;
  busy: boolean;
  /** Resolves true when the contribution was saved, so the form can reset. */
  onSubmit: (input: ContributionInput) => Promise<boolean>;
}

export const ContributionForm: React.FC<ContributionFormProps> = ({
  members,
  currentMemberId,
  isAdmin,
  currency,
  busy,
  onSubmit,
}) => {
  const [memberId, setMemberId] = useState(currentMemberId ?? '');
  const [amount, setAmount] = useState('');
  const [contributedOn, setContributedOn] = useState(todayIso());
  const [method, setMethod] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Keep the payer select sensible if members load after first render.
  const effectiveMemberId = memberId || currentMemberId || '';

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const nextErrors: Record<string, string> = {};
    const amountCents = parseAmount(amount);

    if (!effectiveMemberId) nextErrors.memberId = 'Choose who contributed.';
    if (amountCents === null) nextErrors.amount = 'Enter an amount greater than 0.';
    if (!contributedOn) nextErrors.contributedOn = 'Choose a date.';

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || amountCents === null) return;

    const saved = await onSubmit({
      memberId: effectiveMemberId,
      amountCents,
      contributedOn,
      method: method.trim(),
      note: note.trim(),
    });

    if (saved) {
      setAmount('');
      setMethod('');
      setNote('');
      setContributedOn(todayIso());
      setErrors({});
    }
  };

  return (
    <form className="room-form" onSubmit={handleSubmit} noValidate>
      <div className="room-form-row">
        <div className="form-group">
          <label htmlFor="contribution-member" className="form-label">
            Contributed by
          </label>
          <select
            id="contribution-member"
            className="select-input room-select"
            value={effectiveMemberId}
            onChange={(e) => setMemberId(e.target.value)}
            disabled={busy || (!isAdmin && Boolean(currentMemberId))}
          >
            <option value="">Select member…</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {memberLabel(member, currentMemberId)}
              </option>
            ))}
          </select>
          {errors.memberId && <span className="form-error">{errors.memberId}</span>}
        </div>

        <div className="form-group">
          <label htmlFor="contribution-amount" className="form-label">
            Amount ({currency})
          </label>
          <input
            id="contribution-amount"
            className="form-input"
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="1000.00"
            disabled={busy}
          />
          {errors.amount && <span className="form-error">{errors.amount}</span>}
        </div>

        <div className="form-group">
          <label htmlFor="contribution-date" className="form-label">
            Date
          </label>
          <input
            id="contribution-date"
            className="form-input"
            type="date"
            value={contributedOn}
            onChange={(e) => setContributedOn(e.target.value)}
            disabled={busy}
          />
          {errors.contributedOn && (
            <span className="form-error">{errors.contributedOn}</span>
          )}
        </div>
      </div>

      <div className="room-form-row">
        <div className="form-group">
          <label htmlFor="contribution-method" className="form-label">
            Method <span className="room-optional">(optional)</span>
          </label>
          <input
            id="contribution-method"
            className="form-input"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            placeholder="Cash, UPI, bank transfer…"
            maxLength={40}
            disabled={busy}
          />
        </div>

        <div className="form-group">
          <label htmlFor="contribution-note" className="form-label">
            Note <span className="room-optional">(optional)</span>
          </label>
          <input
            id="contribution-note"
            className="form-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. October top-up"
            maxLength={120}
            disabled={busy}
          />
        </div>
      </div>

      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? 'Saving…' : 'Add contribution'}
      </button>
    </form>
  );
};

// ---------------------------------------------------------------------------
// Expenses — money spent out of pocket, reimbursable from the fund
// ---------------------------------------------------------------------------

export interface ExpenseInput {
  paidByMemberId: string;
  createdByMemberId: string;
  description: string;
  amountCents: number;
  category: string;
  spentOn: string;
  isReimbursable: boolean;
  note: string;
}

interface ExpenseFormProps {
  members: RoomMember[];
  currentMemberId: string | null;
  isAdmin: boolean;
  currency: string;
  busy: boolean;
  onSubmit: (input: ExpenseInput) => Promise<boolean>;
}

export const ExpenseForm: React.FC<ExpenseFormProps> = ({
  members,
  currentMemberId,
  isAdmin,
  currency,
  busy,
  onSubmit,
}) => {
  const [paidByMemberId, setPaidByMemberId] = useState(currentMemberId ?? '');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<string>(DEFAULT_CATEGORY);
  const [spentOn, setSpentOn] = useState(todayIso());
  const [isReimbursable, setIsReimbursable] = useState(true);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const effectivePayerId = paidByMemberId || currentMemberId || '';

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const nextErrors: Record<string, string> = {};
    const amountCents = parseAmount(amount);
    const cleanDescription = description.trim();

    if (!effectivePayerId) nextErrors.paidByMemberId = 'Choose who paid.';
    if (!currentMemberId) nextErrors.paidByMemberId = 'Your membership is not loaded yet.';
    if (!cleanDescription) nextErrors.description = 'Describe the purchase.';
    else if (cleanDescription.length > 120) nextErrors.description = 'Keep this under 120 characters.';
    if (amountCents === null) nextErrors.amount = 'Enter an amount greater than 0.';
    if (!spentOn) nextErrors.spentOn = 'Choose a date.';

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || amountCents === null || !currentMemberId) return;

    const saved = await onSubmit({
      paidByMemberId: effectivePayerId,
      createdByMemberId: currentMemberId,
      description: cleanDescription,
      amountCents,
      category,
      spentOn,
      isReimbursable,
      note: note.trim(),
    });

    if (saved) {
      setDescription('');
      setAmount('');
      setCategory(DEFAULT_CATEGORY);
      setSpentOn(todayIso());
      setIsReimbursable(true);
      setNote('');
      setErrors({});
    }
  };

  return (
    <form className="room-form" onSubmit={handleSubmit} noValidate>
      <div className="form-group">
        <label htmlFor="expense-description" className="form-label">
          What was purchased?
        </label>
        <input
          id="expense-description"
          className="form-input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Groceries for the week"
          maxLength={120}
          disabled={busy}
        />
        {errors.description && <span className="form-error">{errors.description}</span>}
      </div>

      <div className="room-form-row">
        <div className="form-group">
          <label htmlFor="expense-amount" className="form-label">
            Amount ({currency})
          </label>
          <input
            id="expense-amount"
            className="form-input"
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="450.00"
            disabled={busy}
          />
          {errors.amount && <span className="form-error">{errors.amount}</span>}
        </div>

        <div className="form-group">
          <label htmlFor="expense-paid-by" className="form-label">
            Purchased by
          </label>
          <select
            id="expense-paid-by"
            className="select-input room-select"
            value={effectivePayerId}
            onChange={(e) => setPaidByMemberId(e.target.value)}
            disabled={busy || (!isAdmin && Boolean(currentMemberId))}
          >
            <option value="">Select member…</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {memberLabel(member, currentMemberId)}
              </option>
            ))}
          </select>
          {errors.paidByMemberId && (
            <span className="form-error">{errors.paidByMemberId}</span>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="expense-category" className="form-label">
            Category
          </label>
          <select
            id="expense-category"
            className="select-input room-select"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={busy}
          >
            {EXPENSE_CATEGORIES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.icon} {item.name}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="expense-date" className="form-label">
            Date
          </label>
          <input
            id="expense-date"
            className="form-input"
            type="date"
            value={spentOn}
            onChange={(e) => setSpentOn(e.target.value)}
            disabled={busy}
          />
          {errors.spentOn && <span className="form-error">{errors.spentOn}</span>}
        </div>
      </div>

      <div className="form-group">
        <label className="room-checkbox">
          <input
            type="checkbox"
            checked={isReimbursable}
            onChange={(e) => setIsReimbursable(e.target.checked)}
            disabled={busy}
          />
          <span>
            Reimbursable from the shared fund
            <span className="room-optional">
              {' '}
              — uncheck for a personal purchase kept only for history
            </span>
          </span>
        </label>
      </div>

      <div className="form-group">
        <label htmlFor="expense-note" className="form-label">
          Note <span className="room-optional">(optional)</span>
        </label>
        <input
          id="expense-note"
          className="form-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Store, receipt number, reason…"
          maxLength={120}
          disabled={busy}
        />
      </div>

      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? 'Saving…' : 'Add expense'}
      </button>
    </form>
  );
};
