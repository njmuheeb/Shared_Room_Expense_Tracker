import React from 'react';

interface AppHeaderProps {
  email: string;
  onSignOut: () => Promise<void>;
}

/** Top bar for the authenticated app. Shows who is signed in and sign-out. */
export const AppHeader: React.FC<AppHeaderProps> = ({ email, onSignOut }) => (
  <header className="navbar" role="banner">
    <div className="navbar-container">
      <div className="navbar-brand">
        <div className="brand-icon" aria-hidden="true">
          🏠
        </div>
        <div>
          <h1 className="brand-title">RoomFund</h1>
        </div>
        <span className="brand-badge">Shared</span>
      </div>

      <div className="navbar-actions">
        <span className="header-user" title={email}>
          {email}
        </span>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void onSignOut()}
        >
          Sign out
        </button>
      </div>
    </div>
  </header>
);
