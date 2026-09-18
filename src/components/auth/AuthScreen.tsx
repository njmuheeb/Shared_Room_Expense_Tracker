import React, { useEffect, useRef, useState } from 'react';
import type {
  AuthActionResult,
  SignUpActionResult,
} from '../../hooks/useSession';

interface AuthScreenProps {
  serverError: string | null;
  onPasswordLogin: (email: string, password: string) => Promise<AuthActionResult>;
  onSignUp: (email: string, password: string) => Promise<SignUpActionResult>;
  onMagicLink: (email: string) => Promise<AuthActionResult>;
  onPasswordReset: (email: string) => Promise<AuthActionResult>;
}

type Mode = 'login' | 'signup';
type LoginMethod = 'password' | 'magic';
type Busy = 'login' | 'signup' | 'magic' | 'reset' | null;

interface Notice {
  tone: 'success' | 'error';
  title: string;
  body: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;

/**
 * Unauthenticated landing experience: log in or sign up.
 *
 * Supports email + password (Supabase Auth) and, as an alternative, a
 * passwordless magic link. A new email address creates an account.
 */
export const AuthScreen: React.FC<AuthScreenProps> = ({
  serverError,
  onPasswordLogin,
  onSignUp,
  onMagicLink,
  onPasswordReset,
}) => {
  const [mode, setMode] = useState<Mode>('login');
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<Busy>(null);

  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, [mode, loginMethod]);

  const switchMode = (next: Mode) => {
    setMode(next);
    setNotice(null);
    setFieldErrors({});
    setPassword('');
    setConfirmPassword('');
  };

  const switchLoginMethod = (next: LoginMethod) => {
    setLoginMethod(next);
    setNotice(null);
    setFieldErrors({});
    setPassword('');
  };

  const validateEmail = (errors: Record<string, string>) => {
    const trimmed = email.trim();
    if (!trimmed) {
      errors.email = 'Enter your email address.';
    } else if (!EMAIL_PATTERN.test(trimmed)) {
      errors.email = 'Enter a valid email address.';
    }
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    const errors: Record<string, string> = {};
    validateEmail(errors);
    if (!password) errors.password = 'Enter your password.';

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy('login');
    setNotice(null);
    const result = await onPasswordLogin(email, password);
    setBusy(null);
    if (!result.ok) {
      setNotice({ tone: 'error', title: 'Could not log in', body: result.message });
    }
  };

  const handleSignUp = async (event: React.FormEvent) => {
    event.preventDefault();
    const errors: Record<string, string> = {};
    validateEmail(errors);

    if (!password) {
      errors.password = 'Choose a password.';
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }

    if (!confirmPassword) {
      errors.confirmPassword = 'Re-enter your password.';
    } else if (password !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match.';
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy('signup');
    setNotice(null);
    const result = await onSignUp(email, password);
    setBusy(null);

    if (!result.ok) {
      setNotice({ tone: 'error', title: 'Could not create account', body: result.message });
      return;
    }

    if (result.needsEmailConfirmation) {
      switchMode('login');
      setNotice({ tone: 'success', title: 'Confirm your email', body: result.message });
    }
    // Otherwise Supabase returned a session and the app switches to the room view.
  };

  const handleMagicLink = async (event: React.FormEvent) => {
    event.preventDefault();
    const errors: Record<string, string> = {};
    validateEmail(errors);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy('magic');
    setNotice(null);
    const result = await onMagicLink(email);
    setBusy(null);
    setNotice({
      tone: result.ok ? 'success' : 'error',
      title: result.ok ? 'Check your inbox' : 'Could not send link',
      body: result.message,
    });
  };

  const handleForgotPassword = async () => {
    const errors: Record<string, string> = {};
    validateEmail(errors);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy('reset');
    setNotice(null);
    const result = await onPasswordReset(email);
    setBusy(null);
    setNotice({
      tone: result.ok ? 'success' : 'error',
      title: result.ok ? 'Reset link sent' : 'Could not send reset link',
      body: result.message,
    });
  };

  const isBusy = busy !== null;

  return (
    <div className="auth-page">
      <div className="auth-card modal-content animate-slide-up">
        <div className="modal-header auth-header">
          <div className="auth-mark" aria-hidden="true">
            🏠
          </div>
          <h1 className="modal-title">Shared Room Expense Tracker</h1>
          <p className="room-hint">
            Split a shared fund with your roommates. Log in or create an account
            to continue.
          </p>
        </div>

        <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={`auth-tab ${mode === 'login' ? 'is-active' : ''}`}
            onClick={() => switchMode('login')}
            disabled={isBusy}
          >
            Log in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signup'}
            className={`auth-tab ${mode === 'signup' ? 'is-active' : ''}`}
            onClick={() => switchMode('signup')}
            disabled={isBusy}
          >
            Sign up
          </button>
        </div>

        <div className="modal-body">
          {serverError && (
            <div className="room-notice room-notice--error" role="alert">
              {serverError}
            </div>
          )}

          {notice && (
            <div
              className={`room-notice room-notice--${notice.tone}`}
              role={notice.tone === 'error' ? 'alert' : 'status'}
            >
              <strong>{notice.title}</strong>
              <p>{notice.body}</p>
            </div>
          )}

          {mode === 'login' && loginMethod === 'password' && (
            <form onSubmit={handleLogin} noValidate>
              <div className="form-group">
                <label htmlFor="auth-email" className="form-label">
                  Email address
                </label>
                <input
                  id="auth-email"
                  ref={emailRef}
                  type="email"
                  className="form-input"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: '' }));
                  }}
                  placeholder="you@example.com"
                  autoComplete="email"
                  aria-invalid={Boolean(fieldErrors.email)}
                  disabled={isBusy}
                />
                {fieldErrors.email && <span className="form-error">{fieldErrors.email}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="auth-password" className="form-label">
                  Password
                </label>
                <input
                  id="auth-password"
                  type="password"
                  className="form-input"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (fieldErrors.password) setFieldErrors((p) => ({ ...p, password: '' }));
                  }}
                  placeholder="Your password"
                  autoComplete="current-password"
                  aria-invalid={Boolean(fieldErrors.password)}
                  disabled={isBusy}
                />
                {fieldErrors.password && (
                  <span className="form-error">{fieldErrors.password}</span>
                )}
              </div>

              <div className="auth-actions">
                <button
                  type="button"
                  className="auth-link"
                  onClick={() => void handleForgotPassword()}
                  disabled={isBusy}
                >
                  {busy === 'reset' ? 'Sending reset link…' : 'Forgot password?'}
                </button>
              </div>

              <button type="submit" className="btn btn-primary auth-submit" disabled={isBusy}>
                {busy === 'login' ? 'Logging in…' : 'Log in'}
              </button>

              <div className="auth-divider">
                <span>or</span>
              </div>

              <button
                type="button"
                className="btn btn-secondary auth-submit"
                onClick={() => switchLoginMethod('magic')}
                disabled={isBusy}
              >
                Email me a magic link instead
              </button>
            </form>
          )}

          {mode === 'login' && loginMethod === 'magic' && (
            <form onSubmit={handleMagicLink} noValidate>
              <p className="room-hint">
                We&apos;ll email you a one-time sign-in link. No password needed.
              </p>

              <div className="form-group">
                <label htmlFor="magic-email" className="form-label">
                  Email address
                </label>
                <input
                  id="magic-email"
                  ref={emailRef}
                  type="email"
                  className="form-input"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: '' }));
                  }}
                  placeholder="you@example.com"
                  autoComplete="email"
                  aria-invalid={Boolean(fieldErrors.email)}
                  disabled={isBusy}
                />
                {fieldErrors.email && <span className="form-error">{fieldErrors.email}</span>}
              </div>

              <button type="submit" className="btn btn-primary auth-submit" disabled={isBusy}>
                {busy === 'magic' ? 'Sending…' : 'Send sign-in link'}
              </button>

              <div className="auth-actions">
                <button
                  type="button"
                  className="auth-link"
                  onClick={() => switchLoginMethod('password')}
                  disabled={isBusy}
                >
                  Use password instead
                </button>
              </div>
            </form>
          )}

          {mode === 'signup' && (
            <form onSubmit={handleSignUp} noValidate>
              <div className="form-group">
                <label htmlFor="signup-email" className="form-label">
                  Email address
                </label>
                <input
                  id="signup-email"
                  ref={emailRef}
                  type="email"
                  className="form-input"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: '' }));
                  }}
                  placeholder="you@example.com"
                  autoComplete="email"
                  aria-invalid={Boolean(fieldErrors.email)}
                  disabled={isBusy}
                />
                {fieldErrors.email && <span className="form-error">{fieldErrors.email}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="signup-password" className="form-label">
                  Password
                </label>
                <input
                  id="signup-password"
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
                  disabled={isBusy}
                />
                {fieldErrors.password && (
                  <span className="form-error">{fieldErrors.password}</span>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="signup-confirm" className="form-label">
                  Confirm password
                </label>
                <input
                  id="signup-confirm"
                  type="password"
                  className="form-input"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    if (fieldErrors.confirmPassword) {
                      setFieldErrors((p) => ({ ...p, confirmPassword: '' }));
                    }
                  }}
                  placeholder="Re-enter your password"
                  autoComplete="new-password"
                  aria-invalid={Boolean(fieldErrors.confirmPassword)}
                  disabled={isBusy}
                />
                {fieldErrors.confirmPassword && (
                  <span className="form-error">{fieldErrors.confirmPassword}</span>
                )}
              </div>

              <button type="submit" className="btn btn-primary auth-submit" disabled={isBusy}>
                {busy === 'signup' ? 'Creating account…' : 'Create account'}
              </button>
            </form>
          )}
        </div>
      </div>

      <p className="auth-footnote room-hint">
        Passwords are managed securely by Supabase Auth. New emails create an
        account on first sign-up.
      </p>
    </div>
  );
};
