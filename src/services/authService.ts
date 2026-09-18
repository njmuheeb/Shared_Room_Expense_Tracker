import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';

export type { Session, User } from '@supabase/supabase-js';

/**
 * Read the current session from local storage (no network round trip).
 */
export async function getSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

/**
 * Passwordless sign-in. Sends a magic link to the address.
 * No passwords are stored or transmitted, so there is nothing to leak.
 *
 * Requires the Email provider to be enabled and the current origin to be listed
 * under Authentication -> URL Configuration -> Redirect URLs in Supabase.
 */
export async function sendMagicLinkEmail(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
}

/** Email + password sign-in via Supabase Auth. */
export async function signInWithPassword(
  email: string,
  password: string
): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export interface SignUpResult {
  /** True when the project requires the user to confirm their email first. */
  needsEmailConfirmation: boolean;
  /**
   * True when Supabase reports the email is already in use. With email
   * confirmation enabled Supabase deliberately returns a user with no
   * identities instead of an error, to avoid leaking which emails exist.
   */
  alreadyRegistered: boolean;
}

/** Creates an account with email + password. Supabase stores the password. */
export async function signUpWithPassword(
  email: string,
  password: string
): Promise<SignUpResult> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;

  const identities = data.user?.identities;
  return {
    needsEmailConfirmation: !data.session,
    alreadyRegistered: Array.isArray(identities) && identities.length === 0,
  };
}

/** Sends a password-reset email. The link returns to the current origin. */
export async function sendPasswordResetEmail(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });
  if (error) throw error;
}

/** Sets a new password for the signed-in user (also used after a reset link). */
export async function updatePassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * Subscribe to sign-in / sign-out / token refresh / password recovery.
 * Returns an unsubscribe function.
 */
export function onAuthStateChange(
  callback: (session: Session | null, event: string) => void
): () => void {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    callback(session, event);
  });
  return () => {
    data.subscription.unsubscribe();
  };
}

function readError(err: unknown): { code?: string; message: string } {
  if (err && typeof err === 'object') {
    const value = err as { code?: unknown; message?: unknown };
    return {
      code: typeof value.code === 'string' ? value.code : undefined,
      message: typeof value.message === 'string' ? value.message : '',
    };
  }
  return { message: typeof err === 'string' ? err : '' };
}

/**
 * Turns a Supabase auth error into a clear, safe message for the user.
 * Never includes tokens or raw server internals.
 */
export function describeAuthError(err: unknown): string {
  const { code, message } = readError(err);
  const text = message.toLowerCase();

  if (code === 'invalid_credentials' || text.includes('invalid login credentials')) {
    return 'Incorrect email or password.';
  }
  if (code === 'email_not_confirmed' || text.includes('email not confirmed')) {
    return 'Please confirm your email first. Check your inbox for the confirmation link.';
  }
  if (
    code === 'email_exists' ||
    code === 'user_already_exists' ||
    text.includes('already registered') ||
    text.includes('already exists')
  ) {
    return 'An account with this email already exists. Log in or reset your password.';
  }
  if (
    code === 'weak_password' ||
    text.includes('at least 6') ||
    text.includes('password should be') ||
    text.includes('weak password')
  ) {
    return 'That password is too weak. Use at least 6 characters.';
  }
  if (
    code === 'over_email_send_rate_limit' ||
    code === 'over_request_rate_limit' ||
    text.includes('rate limit') ||
    text.includes('too many requests')
  ) {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  if (code === 'signup_disabled' || text.includes('signups not allowed')) {
    return 'New sign-ups are currently disabled.';
  }
  if (code === 'same_password' || text.includes('different from the old password')) {
    return 'Choose a password different from your current one.';
  }
  if (code === 'validation_failed' || text.includes('unable to validate email')) {
    return 'Enter a valid email address.';
  }
  if (text.includes('failed to fetch') || text.includes('networkerror')) {
    return 'Network error. Check your connection and try again.';
  }

  const trimmed = message.trim();
  return trimmed && trimmed.length <= 160
    ? trimmed
    : 'Something went wrong. Please try again.';
}
