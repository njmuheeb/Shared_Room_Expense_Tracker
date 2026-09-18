import React, { useState } from 'react';

interface RoomOnboardingProps {
  defaultDisplayName: string;
  busy: boolean;
  error: string | null;
  onCreate: (roomName: string, displayName: string) => Promise<void>;
  onJoin: (joinCode: string, displayName: string) => Promise<void>;
}

type Mode = 'create' | 'join';

/**
 * Shown when a signed-in user has no room yet. Either start a new room (the
 * caller becomes its admin/treasurer) or join an existing one with a code.
 */
export const RoomOnboarding: React.FC<RoomOnboardingProps> = ({
  defaultDisplayName,
  busy,
  error,
  onCreate,
  onJoin,
}) => {
  const [mode, setMode] = useState<Mode>('create');
  const [roomName, setRoomName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [displayName, setDisplayName] = useState(defaultDisplayName);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const errors: Record<string, string> = {};
    const cleanDisplayName = displayName.trim();

    if (!cleanDisplayName) {
      errors.displayName = 'Enter the name your roommates will see.';
    } else if (cleanDisplayName.length > 40) {
      errors.displayName = 'Keep this under 40 characters.';
    }

    if (mode === 'create') {
      const cleanRoomName = roomName.trim();
      if (!cleanRoomName) {
        errors.roomName = 'Give your room a name.';
      } else if (cleanRoomName.length > 60) {
        errors.roomName = 'Keep this under 60 characters.';
      }
    } else {
      const cleanCode = joinCode.trim().toUpperCase();
      if (!cleanCode) {
        errors.joinCode = 'Enter the room code.';
      } else if (!/^[A-Z0-9]{6,10}$/.test(cleanCode)) {
        errors.joinCode = 'Room codes are 6–10 letters and numbers.';
      }
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    if (mode === 'create') {
      await onCreate(roomName.trim(), cleanDisplayName);
    } else {
      await onJoin(joinCode.trim().toUpperCase(), cleanDisplayName);
    }
  };

  return (
    <form className="room-onboarding" onSubmit={handleSubmit} noValidate>
      <div className="room-tabs" role="tablist" aria-label="Room setup mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'create'}
          className={`room-tab ${mode === 'create' ? 'is-active' : ''}`}
          onClick={() => setMode('create')}
          disabled={busy}
        >
          Create a room
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'join'}
          className={`room-tab ${mode === 'join' ? 'is-active' : ''}`}
          onClick={() => setMode('join')}
          disabled={busy}
        >
          Join a room
        </button>
      </div>

      <p className="room-hint">
        {mode === 'create'
          ? 'Start a shared fund for your flat. You become the admin (treasurer) and can hand that role over later.'
          : 'Enter the code a roommate shared with you.'}
      </p>

      {mode === 'create' ? (
        <div className="form-group">
          <label htmlFor="room-name-input" className="form-label">
            Room name
          </label>
          <input
            id="room-name-input"
            className="form-input"
            value={roomName}
            onChange={(e) => {
              setRoomName(e.target.value);
              if (fieldErrors.roomName) setFieldErrors((p) => ({ ...p, roomName: '' }));
            }}
            placeholder="e.g. Flat 4B"
            maxLength={60}
            disabled={busy}
            aria-invalid={Boolean(fieldErrors.roomName)}
          />
          {fieldErrors.roomName && <span className="form-error">{fieldErrors.roomName}</span>}
        </div>
      ) : (
        <div className="form-group">
          <label htmlFor="room-code-input" className="form-label">
            Room code
          </label>
          <input
            id="room-code-input"
            className="form-input room-code-input"
            value={joinCode}
            onChange={(e) => {
              setJoinCode(e.target.value.toUpperCase());
              if (fieldErrors.joinCode) setFieldErrors((p) => ({ ...p, joinCode: '' }));
            }}
            placeholder="ABC123"
            maxLength={10}
            autoCapitalize="characters"
            spellCheck={false}
            disabled={busy}
            aria-invalid={Boolean(fieldErrors.joinCode)}
          />
          {fieldErrors.joinCode && <span className="form-error">{fieldErrors.joinCode}</span>}
        </div>
      )}

      <div className="form-group">
        <label htmlFor="room-display-name-input" className="form-label">
          Your display name
        </label>
        <input
          id="room-display-name-input"
          className="form-input"
          value={displayName}
          onChange={(e) => {
            setDisplayName(e.target.value);
            if (fieldErrors.displayName) setFieldErrors((p) => ({ ...p, displayName: '' }));
          }}
          placeholder="e.g. Aarav"
          maxLength={40}
          disabled={busy}
          aria-invalid={Boolean(fieldErrors.displayName)}
        />
        {fieldErrors.displayName && (
          <span className="form-error">{fieldErrors.displayName}</span>
        )}
      </div>

      {error && (
        <div className="room-notice room-notice--error" role="alert">
          {error}
        </div>
      )}

      <button type="submit" className="btn btn-primary room-submit" disabled={busy}>
        {busy ? 'Working…' : mode === 'create' ? 'Create room' : 'Join room'}
      </button>
    </form>
  );
};
