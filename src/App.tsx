import React from 'react';
import { AuthScreen } from './components/auth/AuthScreen';
import { ResetPasswordScreen } from './components/auth/ResetPasswordScreen';
import { FullPageLoader } from './components/common/FullPageLoader';
import { AppHeader } from './components/layout/AppHeader';
import { RoomApp } from './components/room/RoomApp';
import { useSession } from './hooks/useSession';

/**
 * Authentication-first application shell.
 *
 * - Checking session      → loading state
 * - No session            → log in / sign up (password, or magic link)
 * - Password recovery     → set a new password
 * - Session, no room      → create / join onboarding
 * - Session with room     → shared room dashboard
 *
 * The shared-room UI only mounts for an authenticated user, so a signed-out
 * visitor can never see another user's room or financial data.
 */
const App: React.FC = () => {
  const {
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
  } = useSession();

  if (loading) {
    return (
      <div className="app-layout">
        <FullPageLoader message="Checking your session…" fullScreen />
      </div>
    );
  }

  if (!session) {
    return (
      <AuthScreen
        serverError={error}
        onPasswordLogin={signInWithPassword}
        onSignUp={signUp}
        onMagicLink={sendMagicLink}
        onPasswordReset={sendPasswordReset}
      />
    );
  }

  if (recoveryMode) {
    return (
      <div className="app-layout">
        <main className="main-content">
          <ResetPasswordScreen
            onSubmit={completePasswordReset}
            onCancel={() => void signOut()}
            serverError={error}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <AppHeader email={session.user.email ?? 'Signed in'} onSignOut={signOut} />

      <main className="main-content">
        <RoomApp session={session} />
      </main>

      <footer className="app-footer">
        <p>
          <strong>RoomFund</strong> — shared room expense tracker. Access is
          enforced per-room with Supabase Row Level Security.
        </p>
      </footer>
    </div>
  );
};

export default App;
