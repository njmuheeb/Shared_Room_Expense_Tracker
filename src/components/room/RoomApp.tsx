import React, { useCallback, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { describeRoomError, useRoom } from '../../hooks/useRoom';
import {
  addContribution,
  addExpense,
  markReimbursementPaid,
  requestReimbursement,
} from '../../services/roomService';
import { FullPageLoader } from '../common/FullPageLoader';
import { RoomDashboard } from './RoomDashboard';
import { RoomOnboarding } from './RoomOnboarding';
import type { ContributionInput, ExpenseInput } from './RoomForms';

interface RoomAppProps {
  session: Session;
}

/**
 * The authenticated experience.
 *
 * Renders, in order: loading → room onboarding (no room yet) → room dashboard.
 * Only mounts once a session exists, so it never fetches room data for a
 * signed-out visitor.
 */
export const RoomApp: React.FC<RoomAppProps> = ({ session }) => {
  const userId = session.user.id;
  const room = useRoom(userId);

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const runAction = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(
        err instanceof Error || (err && typeof err === 'object')
          ? describeRoomError(err)
          : 'Something went wrong.'
      );
    } finally {
      setBusy(false);
    }
  }, []);

  const handleCreate = (roomName: string, displayName: string) =>
    runAction(() => room.createRoom(roomName, displayName));

  const handleJoin = (joinCode: string, displayName: string) =>
    runAction(() => room.joinRoom(joinCode, displayName));

  const handleAddContribution = async (input: ContributionInput): Promise<boolean> => {
    if (!room.activeRoomId) return false;

    let saved = false;
    await runAction(async () => {
      await addContribution({ roomId: room.activeRoomId as string, ...input });
      await room.refresh();
      saved = true;
    });
    return saved;
  };

  const handleAddExpense = async (input: ExpenseInput): Promise<boolean> => {
    if (!room.activeRoomId) return false;

    let saved = false;
    await runAction(async () => {
      await addExpense({ roomId: room.activeRoomId as string, ...input });
      await room.refresh();
      saved = true;
    });
    return saved;
  };

  const handleRequestReimbursement = (expenseId: string) =>
    runAction(async () => {
      await requestReimbursement(expenseId);
      await room.refresh();
    });

  const handleMarkPaid = (reimbursementId: string) =>
    runAction(async () => {
      await markReimbursementPaid(reimbursementId);
      await room.refresh();
    });

  const displayError = actionError ?? room.error;

  if (!room.initialized) {
    return <FullPageLoader message="Loading your rooms…" />;
  }

  if (room.rooms.length === 0) {
    return (
      <section className="room-page">
        <header className="room-page-head">
          <div>
            <h2 className="section-title">Set up your room</h2>
            <p className="room-hint">
              Create a shared fund, or join one a roommate already started.
            </p>
          </div>
        </header>

        <RoomOnboarding
          defaultDisplayName={session.user.email?.split('@')[0] ?? ''}
          busy={busy}
          error={displayError}
          onCreate={handleCreate}
          onJoin={handleJoin}
        />
      </section>
    );
  }

  if (!room.activeRoom) {
    return <FullPageLoader message="Loading your room…" />;
  }

  return (
    <section className="room-page">
      <header className="room-page-head">
        <div>
          <h2 className="section-title">{room.activeRoom.name}</h2>
          <p className="room-hint">
            {room.members.length} member{room.members.length === 1 ? '' : 's'} ·
            room code <code className="room-page-code">{room.activeRoom.join_code}</code>
          </p>
        </div>

        {room.rooms.length > 1 && (
          <select
            className="select-input room-select"
            value={room.activeRoomId ?? ''}
            onChange={(e) => room.selectRoom(e.target.value)}
            aria-label="Switch room"
          >
            {room.rooms.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        )}
      </header>

      <RoomDashboard
        room={room.activeRoom}
        members={room.members}
        balance={room.balance}
        expenses={room.expenses}
        currentMember={room.currentMember}
        loading={room.loading}
        busy={busy}
        error={displayError}
        onAddContribution={handleAddContribution}
        onAddExpense={handleAddExpense}
        onRequestReimbursement={handleRequestReimbursement}
        onMarkPaid={handleMarkPaid}
      />
    </section>
  );
};
