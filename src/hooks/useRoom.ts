import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createRoom as createRoomRequest,
  getFundBalance,
  joinRoom as joinRoomRequest,
  listExpenses,
  listMembers,
  listMyRooms,
  subscribeToRoom,
} from '../services/roomService';
import type {
  ExpenseWithReimbursement,
  Room,
  RoomFundBalance,
  RoomMember,
} from '../models/room';

export interface UseRoomResult {
  rooms: Room[];
  activeRoom: Room | null;
  activeRoomId: string | null;
  members: RoomMember[];
  balance: RoomFundBalance | null;
  expenses: ExpenseWithReimbursement[];
  currentMember: RoomMember | null;
  /** True once the first room lookup has completed. Gates loading states. */
  initialized: boolean;
  loading: boolean;
  error: string | null;
  selectRoom: (roomId: string) => void;
  createRoom: (name: string, displayName: string) => Promise<void>;
  joinRoom: (code: string, displayName: string) => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Stable empty references. When someone signs out we expose these instead of
 * clearing state, so no setState happens synchronously inside an effect and a
 * previous user's data is never rendered for the next one.
 */
const EMPTY_ROOMS: Room[] = [];
const EMPTY_MEMBERS: RoomMember[] = [];
const EMPTY_EXPENSES: ExpenseWithReimbursement[] = [];

/** Turns any thrown value into a message a roommate can act on. */
export function describeRoomError(err: unknown): string {
  let raw = 'Something went wrong.';

  if (err instanceof Error) {
    raw = err.message;
  } else if (typeof err === 'string') {
    raw = err;
  } else if (err && typeof err === 'object' && 'message' in err) {
    raw = String((err as { message: unknown }).message);
  }

  if (/PGRST205|does not exist|schema cache/i.test(raw)) {
    return 'The room tables were not found. Apply supabase/migrations/20260917000000_init.sql in the Supabase SQL Editor, then reload.';
  }
  if (/permission denied|42501/i.test(raw)) {
    return 'You do not have access to that. Ask the room admin to check your membership.';
  }
  if (/invalid api key|jwt|expired/i.test(raw)) {
    return 'Your session has expired. Sign in again.';
  }

  return raw;
}

/**
 * Owns everything about "the room I am in": the list of rooms the signed-in
 * user belongs to, the selected room's members/fund balance/expenses, and a
 * debounced realtime subscription.
 *
 * Pass `userId = null` when signed out; the hook then stays idle.
 */
export function useRoom(userId: string | null): UseRoomResult {
  const [roomsState, setRoomsState] = useState<Room[]>([]);
  const [activeRoomIdState, setActiveRoomIdState] = useState<string | null>(null);
  const [membersState, setMembersState] = useState<RoomMember[]>([]);
  const [balanceState, setBalanceState] = useState<RoomFundBalance | null>(null);
  const [expensesState, setExpensesState] = useState<ExpenseWithReimbursement[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Scoped views: signed-out users always see empty, never a previous session.
  const activeRoomId = userId ? activeRoomIdState : null;
  const rooms = userId ? roomsState : EMPTY_ROOMS;
  const members = activeRoomId ? membersState : EMPTY_MEMBERS;
  const balance = activeRoomId ? balanceState : null;
  const expenses = activeRoomId ? expensesState : EMPTY_EXPENSES;

  const loadRooms = useCallback(async () => {
    if (!userId) return;

    setLoading(true);
    try {
      const list = await listMyRooms();
      setRoomsState(list);
      setActiveRoomIdState((prev) => {
        if (prev && list.some((room) => room.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
      setError(null);
    } catch (err) {
      setError(describeRoomError(err));
    } finally {
      setLoading(false);
      setInitialized(true);
    }
  }, [userId]);

  useEffect(() => {
    void loadRooms();
  }, [loadRooms]);

  const loadRoomData = useCallback(async () => {
    if (!activeRoomId) return;

    setLoading(true);
    try {
      const [memberList, fundBalance, expenseList] = await Promise.all([
        listMembers(activeRoomId),
        getFundBalance(activeRoomId),
        listExpenses(activeRoomId),
      ]);
      setMembersState(memberList);
      setBalanceState(fundBalance);
      setExpensesState(expenseList);
      setError(null);
    } catch (err) {
      setError(describeRoomError(err));
    } finally {
      setLoading(false);
    }
  }, [activeRoomId]);

  useEffect(() => {
    void loadRoomData();
  }, [loadRoomData]);

  // Realtime: coalesce bursts of row changes into a single refetch.
  useEffect(() => {
    if (!activeRoomId) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const unsubscribe = subscribeToRoom(activeRoomId, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void loadRoomData();
      }, 200);
    });

    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [activeRoomId, loadRoomData]);

  const activeRoom = useMemo(
    () => rooms.find((room) => room.id === activeRoomId) ?? null,
    [rooms, activeRoomId]
  );

  const currentMember = useMemo(
    () => members.find((member) => member.user_id === userId) ?? null,
    [members, userId]
  );

  const createRoom = useCallback(
    async (name: string, displayName: string) => {
      setError(null);
      try {
        const roomId = await createRoomRequest(name, displayName);
        await loadRooms();
        setActiveRoomIdState(roomId);
      } catch (err) {
        setError(describeRoomError(err));
        throw err;
      }
    },
    [loadRooms]
  );

  const joinRoom = useCallback(
    async (code: string, displayName: string) => {
      setError(null);
      try {
        const roomId = await joinRoomRequest(code, displayName);
        await loadRooms();
        setActiveRoomIdState(roomId);
      } catch (err) {
        setError(describeRoomError(err));
        throw err;
      }
    },
    [loadRooms]
  );

  return {
    rooms,
    activeRoom,
    activeRoomId,
    members,
    balance,
    expenses,
    currentMember,
    initialized,
    loading,
    error,
    selectRoom: setActiveRoomIdState,
    createRoom,
    joinRoom,
    refresh: loadRoomData,
  };
}
