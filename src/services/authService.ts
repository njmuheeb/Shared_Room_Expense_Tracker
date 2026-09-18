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
export async function signInWithEmail(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * Subscribe to sign-in / sign-out / token refresh.
 * Returns an unsubscribe function.
 */
export function onAuthStateChange(
  callback: (session: Session | null) => void
): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
  return () => {
    data.subscription.unsubscribe();
  };
}
