import React, { useEffect, useRef, useState } from 'react';
import type { AuthActionResult } from '../../hooks/useSession';

interface ResetPasswordScreenProps {
  onSubmit: (password: string) => Promise<AuthActionResult>;
  onCancel: () => void;
  serverError: string | null;
}

const MIN_PASSWORD_LENGTH = 6;

/**
 * Shown after the user opens a password-recovery link (Supabase emits
 * PASSWORD_RECOVERY). Lets them set a new password for their account.
 */
export const ResetPasswordScreen: React.FC<ResetPasswordScreenProps> = ({
  onSubmit,
  onCancel,
  serverError,
}) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const errors: Record<string, string> = {};
    if (!password) {
      errors.password = 'Choose a new password.';
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (!confirmPassword) {
      errors.confirmPassword = 'Re-enter your new password.';
    } else if (password !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match.';
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    setError(null);
    const result = await onSubmit(password);
    setBusy(false);
    if (!result.ok) setError(result.message);
  };

  return (
    <div className="auth-page">
      <div className="auth-card modal-content animate-slide-up">
        <div className="modal-header auth-header">
          <div className="auth-mark" aria-hidden="true">
            🔑
          </div>
          <h1 className="modal-title">Set a new password</h1>
          <p className="room-hint">Choose a new password for your account.</p>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="modal-body">
            {(serverError || error) && (
              <div className="room-notice room-notice--error" role="alert">
                {error ?? serverError}
              </div>
            )}

            <div className="form-group">
              <label htmlFor="reset-password" className="form-label">
                New password
              </label>
              <input
                id="reset-password"
                ref={inputRef}
                type="password"
                className="form-input"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (fieldErrors.password) setFieldErrors((p) => ({ ...p, password: '' }));
                }}
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                autoComplete="new-password"
                aria-invalid={Boolean(fieldErrors.password)}
                disabled={busy}
              />
              {fieldErrors.password && <span className="form-error">{fieldErrors.password}</span>}
            </div>

            <div className="form-group">
              <label htmlFor="reset-confirm" className="form-label">
                Confirm new password
              </label>
              <input
                id="reset-confirm"
                type="password"
                className="form-input"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  if (fieldErrors.confirmPassword) {
                    setFieldErrors((p) => ({ ...p, confirmPassword: '' }));
                  }
                }}
                placeholder="Re-enter your new password"
                autoComplete="new-password"
                aria-invalid={Boolean(fieldErrors.confirmPassword)}
                disabled={busy}
              />
              {fieldErrors.confirmPassword && (
                <span className="form-error">{fieldErrors.confirmPassword}</span>
              )}
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Update password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
