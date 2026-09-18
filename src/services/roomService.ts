import { supabase } from '../lib/supabaseClient';
import type {
  Contribution,
  ExpenseWithReimbursement,
  Room,
  RoomExpense,
  RoomFundBalance,
  RoomMember,
} from '../models/room';

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

/** Creates a room and makes the caller its admin (treasurer). Returns the room id. */
export async function createRoom(
  name: string,
  displayName: string,
  currency = '$'
): Promise<string> {
  const { data, error } = await supabase.rpc('create_room', {
    p_name: name,
    p_currency: currency,
    p_display_name: displayName,
  });
  if (error) throw error;
  return data as string;
}

/** Joins an existing room by its join code. Returns the room id. */
export async function joinRoom(
  code: string,
  displayName: string
): Promise<string> {
  const { data, error } = await supabase.rpc('join_room', {
    p_code: code,
    p_display_name: displayName,
  });
  if (error) throw error;
  return data as string;
}

/**
 * Rooms the signed-in user is an active member of.
 * Note: `rooms(*)` on the members table works because RLS lets a member read
 * the room they belong to.
 */
export async function listMyRooms(): Promise<Room[]> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return [];

  const { data, error } = await supabase
    .from('members')
    .select('rooms(*)')
    .eq('user_id', auth.user.id)
    .eq('status', 'active');

  if (error) throw error;

  // Without generated database types Supabase cannot infer that the embedded
  // `rooms` relation is to-one, so it widens it to an array.
  const rows = (data ?? []) as unknown as Array<{ rooms: Room | null }>;
  return rows
    .map((row) => row.rooms)
    .filter((room): room is Room => room !== null);
}

export async function listMembers(roomId: string): Promise<RoomMember[]> {
  const { data, error } = await supabase
    .from('members')
    .select('*')
    .eq('room_id', roomId)
    .eq('status', 'active')
    .order('joined_at', { ascending: true });

  if (error) throw error;
  return (data ?? []) as RoomMember[];
}

/** Hands the admin/treasurer role to another active member. Admin only. */
export async function transferAdmin(
  roomId: string,
  newMemberId: string
): Promise<void> {
  const { error } = await supabase.rpc('transfer_admin', {
    p_room: roomId,
    p_new_member: newMemberId,
  });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Balance (derived view, never a stored column)
// ---------------------------------------------------------------------------

export async function getFundBalance(
  roomId: string
): Promise<RoomFundBalance | null> {
  const { data, error } = await supabase
    .from('room_fund_balance')
    .select('*')
    .eq('room_id', roomId)
    .maybeSingle();

  if (error) throw error;
  return (data as RoomFundBalance) ?? null;
}

// ---------------------------------------------------------------------------
// Contributions
// ---------------------------------------------------------------------------

export async function addContribution(input: {
  roomId: string;
  memberId: string;
  amountCents: number;
  contributedOn: string;
  method?: string;
  note?: string;
}): Promise<Contribution> {
  const { data, error } = await supabase
    .from('contributions')
    .insert({
      room_id: input.roomId,
      member_id: input.memberId,
      amount_cents: input.amountCents,
      contributed_on: input.contributedOn,
      method: input.method ?? null,
      note: input.note ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data as Contribution;
}

/** Admin only. Voids a contribution without deleting its history. */
export async function voidContribution(
  contributionId: string,
  reason: string
): Promise<void> {
  const { error } = await supabase.rpc('void_contribution', {
    p_contribution: contributionId,
    p_reason: reason,
  });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

/** Active (non-voided) expenses with their reimbursement state embedded. */
export async function listExpenses(
  roomId: string
): Promise<ExpenseWithReimbursement[]> {
  const { data, error } = await supabase
    .from('expenses')
    .select('*, reimbursements(id, status, paid_at, voided_at)')
    .eq('room_id', roomId)
    .is('voided_at', null)
    .order('spent_on', { ascending: false });

  if (error) throw error;
  return (data ?? []) as ExpenseWithReimbursement[];
}

export async function addExpense(input: {
  id?: string;
  roomId: string;
  paidByMemberId: string;
  createdByMemberId: string;
  description: string;
  amountCents: number;
  category?: string;
  spentOn: string;
  isReimbursable?: boolean;
  note?: string;
}): Promise<RoomExpense> {
  const { data, error } = await supabase
    .from('expenses')
    .insert({
      id: input.id,
      room_id: input.roomId,
      paid_by_member_id: input.paidByMemberId,
      created_by_member_id: input.createdByMemberId,
      description: input.description,
      amount_cents: input.amountCents,
      category: input.category ?? 'other',
      spent_on: input.spentOn,
      is_reimbursable: input.isReimbursable ?? true,
      note: input.note ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data as RoomExpense;
}

/** Creator or admin. Fails if an active reimbursement exists on the expense. */
export async function voidExpense(
  expenseId: string,
  reason: string
): Promise<void> {
  const { error } = await supabase.rpc('void_expense', {
    p_expense: expenseId,
    p_reason: reason,
  });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Reimbursements
// ---------------------------------------------------------------------------

/**
 * Requests a payout for one expense. Payer or admin only.
 * A second request for the same expense fails on UNIQUE (expense_id) — that is
 * the guarantee that an expense can never be paid out twice.
 */
export async function requestReimbursement(expenseId: string): Promise<string> {
  const { data, error } = await supabase.rpc('request_reimbursement', {
    p_expense: expenseId,
  });
  if (error) throw error;
  return data as string;
}

/** Admin only. This is the single event that moves money out of the fund. */
export async function markReimbursementPaid(
  reimbursementId: string,
  method?: string,
  reference?: string
): Promise<void> {
  const { error } = await supabase.rpc('mark_reimbursement_paid', {
    p_reimbursement: reimbursementId,
    p_method: method ?? null,
    p_reference: reference ?? null,
  });
  if (error) throw error;
}

/** Admin only. Voiding a paid reimbursement restores the pending liability. */
export async function voidReimbursement(
  reimbursementId: string,
  reason: string
): Promise<void> {
  const { error } = await supabase.rpc('void_reimbursement', {
    p_reimbursement: reimbursementId,
    p_reason: reason,
  });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Realtime
// ---------------------------------------------------------------------------

/**
 * Live updates for one room. RLS applies to realtime too, so a subscriber only
 * receives rows for rooms they belong to.
 * Returns an unsubscribe function.
 */
export function subscribeToRoom(
  roomId: string,
  onChange: () => void
): () => void {
  const channel = supabase
    .channel(`room:${roomId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'expenses',
        filter: `room_id=eq.${roomId}`,
      },
      onChange
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'contributions',
        filter: `room_id=eq.${roomId}`,
      },
      onChange
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'reimbursements',
        filter: `room_id=eq.${roomId}`,
      },
      onChange
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
