import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  describeAuthError,
  getSession,
  onAuthStateChange,
  sendMagicLinkEmail,
  sendPasswordResetEmail,
  signInWithPassword as signInWithPasswordRequest,
  signOut as authSignOut,
  signUpWithPassword,
  updatePassword as updatePasswordRequest,
} from '../services/authService';

export interface AuthActionResult {
  ok: boolean;
  /** User-facing message. Safe to show directly. */
  message: string;
}

export interface SignUpActionResult extends AuthActionResult {
  needsEmailConfirmation?: boolean;
}

export interface UseSessionResult {
  session: Session | null;
  /** True until the stored session has been read for the first time. */
  loading: boolean;
  error: string | null;
  /** True after a password-recovery link was opened; show a set-password screen. */
  recoveryMode: boolean;
  signInWithPassword: (email: string, password: string) => Promise<AuthActionResult>;
  signUp: (email: string, password: string) => Promise<SignUpActionResult>;
  sendMagicLink: (email: string) => Promise<AuthActionResult>;
  sendPasswordReset: (email: string) => Promise<AuthActionResult>;
  completePasswordReset: (password: string) => Promise<AuthActionResult>;
  signOut: () => Promise<void>;
}

/**
 * Tracks the Supabase auth session for the current browser.
 *
 * Supabase Auth is independent of the application tables, so this works even
 * before the SQL migration has been applied.
 */
export function useSession(): UseSessionResult {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recoveryMode, setRecoveryMode] = useState(false);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const current = await getSession();
        if (active) setSession(current);
      } catch (err) {
        if (active) {
          setError(describeAuthError(err));
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    const unsubscribe = onAuthStateChange((next, event) => {
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
      if (event === 'SIGNED_OUT') setRecoveryMode(false);
      setSession(next);
      setLoading(false);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const signInWithPassword = useCallback(
    async (email: string, password: string): Promise<AuthActionResult> => {
      try {
        await signInWithPasswordRequest(email.trim(), password);
        return { ok: true, message: 'Signed in.' };
      } catch (err) {
        return { ok: false, message: describeAuthError(err) };
      }
    },
    []
  );

  const signUp = useCallback(
    async (email: string, password: string): Promise<SignUpActionResult> => {
      try {
        const result = await signUpWithPassword(email.trim(), password);
        if (result.alreadyRegistered) {
          return {
            ok: false,
            needsEmailConfirmation: false,
            message:
              'An account with this email already exists. Log in or reset your password.',
          };
        }
        if (result.needsEmailConfirmation) {
          return {
            ok: true,
            needsEmailConfirmation: true,
            message:
              'Account created. Check your inbox to confirm your email, then log in.',
          };
        }
        return { ok: true, needsEmailConfirmation: false, message: 'Account created.' };
      } catch (err) {
        return { ok: false, message: describeAuthError(err) };
      }
    },
    []
  );

  const sendMagicLink = useCallback(async (email: string): Promise<AuthActionResult> => {
    try {
      await sendMagicLinkEmail(email.trim());
      return {
        ok: true,
        message: 'A sign-in link is on its way. Open it in this browser to finish signing in.',
      };
    } catch (err) {
      return { ok: false, message: describeAuthError(err) };
    }
  }, []);

  const sendPasswordReset = useCallback(
    async (email: string): Promise<AuthActionResult> => {
      try {
        await sendPasswordResetEmail(email.trim());
        return {
          ok: true,
          message: `If an account exists for ${email.trim()}, a reset link is on its way.`,
        };
      } catch (err) {
        return { ok: false, message: describeAuthError(err) };
      }
    },
    []
  );

  const completePasswordReset = useCallback(
    async (password: string): Promise<AuthActionResult> => {
      try {
        await updatePasswordRequest(password);
        setRecoveryMode(false);
        return { ok: true, message: 'Password updated.' };
      } catch (err) {
        return { ok: false, message: describeAuthError(err) };
      }
    },
    []
  );

  const signOut = useCallback(async () => {
    setError(null);
    try {
      await authSignOut();
    } catch (err) {
      setError(describeAuthError(err));
    }
  }, []);

  return {
    session,
    loading,
    error,
    recoveryMode,
    signInWithPassword,
    signUp,
    sendMagicLink,
    sendPasswordReset,
    completePasswordReset,
    signOut,
  };
}
