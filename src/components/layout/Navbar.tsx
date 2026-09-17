import React from 'react';
import { useExpenses } from '../../context/ExpenseContext';
import { SUPPORTED_CURRENCIES } from '../../utils/constants';

export const Navbar: React.FC = () => {
  const {
    state,
    setCurrency,
    toggleTheme,
    openAddModal,
    loadSampleData,
    promptClearAll,
  } = useExpenses();

  return (
    <header className="navbar" role="banner">
      <div className="navbar-container">
        <div className="navbar-brand">
          <div className="brand-icon" aria-hidden="true">
            💸
          </div>
          <div>
            <h1 className="brand-title">ExpenFlow</h1>
          </div>
          <span className="brand-badge">Local-First</span>
        </div>

        <div className="navbar-actions">
          {/* Currency Selector */}
          <select
            id="currency-selector"
            className="select-input"
            value={state.currency}
            onChange={(e) => setCurrency(e.target.value)}
            title="Select Currency"
            aria-label="Select Currency"
          >
            {SUPPORTED_CURRENCIES.map((curr) => (
              <option key={curr.code} value={curr.symbol}>
                {curr.label}
              </option>
            ))}
          </select>

          {/* Theme Toggle Button */}
          <button
            id="theme-toggle-btn"
            className="btn-icon"
            onClick={toggleTheme}
            title={`Switch to ${state.theme === 'dark' ? 'Light' : 'Dark'} mode`}
            aria-label="Toggle theme"
          >
            {state.theme === 'dark' ? '☀️' : '🌙'}
          </button>

          {/* Load Sample / Reset Menu buttons */}
          <button
            id="load-sample-btn"
            className="btn btn-ghost"
            onClick={loadSampleData}
            title="Load demo sample expenses"
          >
            Demo Data
          </button>

          {state.transactions.length > 0 && (
            <button
              id="clear-all-btn"
              className="btn btn-ghost"
              onClick={promptClearAll}
              title="Clear all expenses"
              style={{ color: 'var(--color-danger)' }}
            >
              Clear
            </button>
          )}

          {/* Add Transaction CTA */}
          <button
            id="add-expense-btn"
            className="btn btn-primary"
            onClick={openAddModal}
          >
            <span style={{ fontSize: '1.1rem', lineHeight: 1 }}>+</span>
            <span>Add Transaction</span>
          </button>
        </div>
      </div>
    </header>
  );
};
