/**
 * Domain types for the Supabase-backed shared room fund.
 *
 * All money is integer minor units ("cents"). Never use floats for money:
 * splitting or summing floats accumulates rounding drift.
 */

export type MemberRole = 'admin' | 'member';
export type MemberStatus = 'active' | 'removed';
export type ReimbursementStatus = 'pending' | 'paid';

/**
 * Who actually paid for an expense.
 *
 * - `common`  the shared pot paid. This money has left the room.
 * - `personal` a member paid out of pocket. This creates a liability, not a
 *              movement of money, until a reimbursement is settled.
 *
 * This is the authoritative classification. `RoomExpense.is_reimbursable` is a
 * legacy mirror kept only so older rows and older queries keep working.
 */
export type PaymentSource = 'common' | 'personal';

/** A closed period is immutable history; an open one still accepts changes. */
export type PeriodStatus = 'open' | 'closed';

export interface Room {
  id: string;
  name: string;
  join_code: string;
  currency: string;
  contribution_target_cents: number | null;
  is_archived: boolean;
  created_by: string;
  created_at: string;
}

export interface RoomMember {
  id: string;
  room_id: string;
  user_id: string | null;
  display_name: string;
  role: MemberRole;
  status: MemberStatus;
  joined_at: string;
}

export interface Contribution {
  id: string;
  room_id: string;
  member_id: string;
  amount_cents: number;
  contributed_on: string;
  method: string | null;
  note: string | null;
  recorded_by_member_id: string | null;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
}

export interface RoomExpense {
  id: string;
  room_id: string;
  paid_by_member_id: string;
  description: string;
  amount_cents: number;
  payment_source: PaymentSource;
  category: string;
  spent_on: string;
  is_reimbursable: boolean;
  note: string | null;
  created_by_member_id: string;
  created_at: string;
  updated_at: string;
  voided_at: string | null;
  void_reason: string | null;
}

export interface Reimbursement {
  id: string;
  expense_id: string;
  room_id: string;
  payee_member_id: string;
  status: ReimbursementStatus;
  requested_at: string;
  requested_by_member_id: string | null;
  paid_at: string | null;
  /**
   * The date the money actually changed hands, chosen by the treasurer.
   * Distinct from `paid_at`, which is the server clock. Period close and the
   * CSV export both report against this date.
   */
  paid_on: string | null;
  paid_by_member_id: string | null;
  method: string | null;
  reference: string | null;
  voided_at: string | null;
  void_reason: string | null;
}

/** An expense with its (at most one) reimbursement embedded. */
export interface ExpenseWithReimbursement extends RoomExpense {
  reimbursements: Reimbursement[];
}

/** Row shape of the `room_fund_balance` view. Every value is derived, never stored. */
export interface RoomFundBalance {
  room_id: string;
  total_contributions_cents: number;
  total_common_expenses_cents: number;
  total_personal_expenses_cents: number;
  total_reimbursed_cents: number;
  /** Cash physically in the pot: contributions − common expenses − payouts. */
  fund_cash_cents: number;
  /**
   * Money the room owes but has not sent yet. A liability, not a movement of
   * cash, so it is deliberately reported separately and must never be
   * subtracted from the balance.
   */
  pending_liability_cents: number;
  /** What the treasurer may actually spend. Equals `fund_cash_cents`. */
  available_balance_cents: number;
}

/** Row shape of the `member_activity` view. */
export interface MemberActivity {
  member_id: string;
  room_id: string;
  display_name: string;
  role: MemberRole;
  status: MemberStatus;
  contributed_cents: number;
  reimbursed_cents: number;
  net_into_fund_cents: number;
  /** Everything this member paid personally, settled or not. */
  personal_spent_cents: number;
  /** The unsettled slice of `personal_spent_cents`. */
  pending_claim_cents: number;
}

/**
 * A date-bounded window of a room's ledger.
 *
 * Periods are non-overlapping, at most one is open at a time, and a closed
 * period rejects every later write that falls inside its range.
 */
export interface AccountingPeriod {
  id: string;
  room_id: string;
  name: string;
  starts_on: string;
  ends_on: string | null;
  status: PeriodStatus;
  closed_at: string | null;
  closed_by_member_id: string | null;
  created_by: string | null;
  created_at: string;
}

/** Append-only record of every admin correction and void. */
export interface FinancialAuditEntry {
  id: string;
  room_id: string;
  actor_member_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  reason: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

/** One row of the `room_export` RPC. Voided rows are included and flagged. */
export interface ExportContributionRow {
  id: string;
  member_id: string;
  display_name: string;
  amount_cents: number;
  contributed_on: string;
  method: string | null;
  note: string | null;
  voided_at: string | null;
  void_reason: string | null;
}

export interface ExportExpenseRow {
  id: string;
  paid_by_member_id: string;
  paid_by: string;
  description: string;
  amount_cents: number;
  payment_source: PaymentSource;
  category: string;
  spent_on: string;
  note: string | null;
  voided_at: string | null;
  void_reason: string | null;
  reimbursement_status: ReimbursementStatus | null;
  reimbursed_on: string | null;
}

export interface RoomExport {
  room: { id: string; name: string; currency: string };
  range: { from: string; to: string };
  contributions: ExportContributionRow[];
  expenses: ExportExpenseRow[];
  summary: {
    contributions_cents: number;
    common_expenses_cents: number;
    personal_expenses_cents: number;
    reimbursed_cents: number;
    available_cents: number;
    pending_liability_cents: number;
  };
}
