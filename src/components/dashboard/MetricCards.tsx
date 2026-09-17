import React from 'react';
import { useExpenses } from '../../context/ExpenseContext';
import { formatCurrency } from '../../utils/formatters';

export const MetricCards: React.FC = () => {
  const { overallMetrics, state } = useExpenses();
  const { totalIncome, totalExpense, netBalance, transactionCount } = overallMetrics;
  const currency = state.currency;

  const isPositiveBalance = netBalance >= 0;

  return (
    <section className="metrics-grid" aria-label="Dashboard Financial Overview">
      {/* 1. Net Balance Card (Primary Spotlight) */}
      <div
        className="metric-card highlight animate-fade-in"
        id="metric-net-balance"
        style={{
          borderLeft: `4px solid ${isPositiveBalance ? 'var(--color-success)' : 'var(--color-danger)'}`,
        }}
      >
        <div className="metric-header">
          <span className="metric-label">Net Balance</span>
          <div
            className="metric-icon-badge"
            style={{
              background: isPositiveBalance ? 'var(--color-success-bg)' : 'var(--color-danger-bg)',
              color: isPositiveBalance ? 'var(--color-success)' : 'var(--color-danger)',
            }}
          >
            {isPositiveBalance ? '💰' : '⚠️'}
          </div>
        </div>
        <div
          className="metric-value"
          style={{
            color: isPositiveBalance ? 'var(--color-success)' : 'var(--color-danger)',
          }}
        >
          {formatCurrency(netBalance, currency)}
        </div>
        <div className="metric-subtitle">
          {isPositiveBalance ? 'Positive cash flow' : 'Expenses exceed income'}
        </div>
      </div>

      {/* 2. Total Income Card */}
      <div className="metric-card animate-fade-in" id="metric-total-income">
        <div className="metric-header">
          <span className="metric-label">Total Income</span>
          <div
            className="metric-icon-badge"
            style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981' }}
          >
            📥
          </div>
        </div>
        <div className="metric-value" style={{ color: '#10b981' }}>
          +{formatCurrency(totalIncome, currency)}
        </div>
        <div className="metric-subtitle">Earnings &amp; revenue</div>
      </div>

      {/* 3. Total Expenses Card */}
      <div className="metric-card animate-fade-in" id="metric-total-expenses">
        <div className="metric-header">
          <span className="metric-label">Total Expenses</span>
          <div
            className="metric-icon-badge"
            style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }}
          >
            📤
          </div>
        </div>
        <div className="metric-value" style={{ color: '#f87171' }}>
          -{formatCurrency(totalExpense, currency)}
        </div>
        <div className="metric-subtitle">Outflows &amp; spending</div>
      </div>

      {/* 4. Total Transactions Count */}
      <div className="metric-card animate-fade-in" id="metric-transaction-count">
        <div className="metric-header">
          <span className="metric-label">Transactions</span>
          <div
            className="metric-icon-badge"
            style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#6366f1' }}
          >
            🧾
          </div>
        </div>
        <div className="metric-value">{transactionCount}</div>
        <div className="metric-subtitle">Active income &amp; expense records</div>
      </div>
    </section>
  );
};
