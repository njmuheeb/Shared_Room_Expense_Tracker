/**
 * Domain types for the Supabase-backed shared room fund.
 *
 * These are intentionally separate from `src/models/expense.ts` so the existing
 * local-first UI keeps compiling untouched.
 *
 * All money is integer minor units ("cents"). Never use floats for money:
 * splitting or summing floats accumulates rounding drift.
 */

export type MemberRole = 'admin' | 'member';
export type MemberStatus = 'active' | 'removed';
export type ReimbursementStatus = 'pending' | 'paid';

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
  total_reimbursed_cents: number;
  fund_cash_cents: number;
  pending_liability_cents: number;
  available_balance_cents: number;
}
