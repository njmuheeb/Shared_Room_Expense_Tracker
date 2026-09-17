import React from 'react';
import { useExpenses } from '../../context/ExpenseContext';
import { ExpenseItem } from './ExpenseItem';

export const ExpenseList: React.FC = () => {
  const { filteredExpenses, state, openAddModal, resetFilter, loadSampleData } = useExpenses();
  const totalRawCount = state.transactions.length;
  const filteredCount = filteredExpenses.length;

  return (
    <section className="expenses-container" aria-label="Expenses History">
      <div className="expenses-header">
        <h2 className="section-title">
          <span>📋</span>
          <span>Recent Transactions</span>
        </h2>
        <span className="results-badge" id="results-count-badge">
          Showing {filteredCount} of {totalRawCount}
        </span>
      </div>

      {filteredCount === 0 ? (
        <div className="empty-state animate-fade-in" id="empty-state-view">
          <div className="empty-state-icon">
            {totalRawCount === 0 ? '💰' : '🔍'}
          </div>
          <h3 className="empty-state-title">
            {totalRawCount === 0 ? 'No Transactions Added Yet' : 'No Matching Transactions'}
          </h3>
          <p className="empty-state-desc">
            {totalRawCount === 0
              ? 'Start tracking your personal finances by logging your first transaction or load demo data.'
              : 'Try clearing your search term, changing categories, or resetting the filter range.'}
          </p>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            {totalRawCount === 0 ? (
              <>
                <button
                  id="empty-add-btn"
                  className="btn btn-primary"
                  onClick={openAddModal}
                >
                  + Add First Transaction
                </button>
                <button
                  id="empty-demo-btn"
                  className="btn btn-secondary"
                  onClick={loadSampleData}
                >
                  Load Sample Data
                </button>
              </>
            ) : (
              <button
                id="empty-reset-filter-btn"
                className="btn btn-secondary"
                onClick={resetFilter}
              >
                Reset Filters
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="expense-list" id="expense-items-list">
          {filteredExpenses.map((expense) => (
            <ExpenseItem key={expense.id} expense={expense} />
          ))}
        </div>
      )}
    </section>
  );
};
