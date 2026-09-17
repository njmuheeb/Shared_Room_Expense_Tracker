import React from 'react';
import { useExpenses } from '../../context/ExpenseContext';
import type { Transaction } from '../../models/expense';
import { CATEGORIES } from '../../utils/constants';
import { formatCurrency, getRelativeDateLabel } from '../../utils/formatters';

interface ExpenseItemProps {
  expense: Transaction;
}

export const ExpenseItem: React.FC<ExpenseItemProps> = ({ expense }) => {
  const { state, openEditModal, promptDelete } = useExpenses();
  const isIncome = expense.type === 'income';

  const category = CATEGORIES[expense.categoryId] || {
    id: expense.categoryId,
    name: expense.categoryId,
    icon: isIncome ? '💵' : '📦',
    color: isIncome ? '#10b981' : '#64748b',
    bgLight: isIncome ? 'rgba(16, 185, 129, 0.15)' : 'rgba(100, 116, 139, 0.15)',
    type: expense.type,
  };

  return (
    <article
      className="expense-item animate-fade-in"
      id={`transaction-item-${expense.id}`}
      aria-label={`Transaction: ${expense.title}`}
    >
      <div className="expense-left">
        {/* Category Icon */}
        <div
          className="category-icon-wrapper"
          style={{ backgroundColor: category.bgLight, color: category.color }}
          title={category.name}
        >
          {category.icon}
        </div>

        {/* Details & Tags */}
        <div className="expense-details">
          <div className="expense-title-row">
            <h3 className="expense-title" title={expense.title}>
              {expense.title}
            </h3>

            {/* Type badge */}
            <span
              style={{
                fontSize: '0.68rem',
                fontWeight: 700,
                padding: '0.1rem 0.45rem',
                borderRadius: 'var(--radius-full)',
                textTransform: 'uppercase',
                background: isIncome ? 'var(--color-success-bg)' : 'rgba(239, 68, 68, 0.12)',
                color: isIncome ? 'var(--color-success)' : 'var(--color-danger)',
              }}
            >
              {isIncome ? 'Income' : 'Expense'}
            </span>

            {/* Category tag */}
            <span
              className="expense-category-tag"
              style={{
                backgroundColor: category.bgLight,
                color: category.color,
                border: `1px solid ${category.color}40`,
              }}
            >
              <span>{category.name}</span>
            </span>
          </div>

          <div className="expense-meta-row">
            <span className="expense-date">📅 {getRelativeDateLabel(expense.date)}</span>
            {expense.notes && (
              <>
                <span>•</span>
                <span className="expense-notes" title={expense.notes}>
                  {expense.notes}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="expense-right">
        {/* Amount with +/- sign */}
        <div
          className="expense-amount"
          style={{
            color: isIncome ? 'var(--color-success)' : 'var(--text-primary)',
            fontWeight: 800,
          }}
        >
          {isIncome ? '+' : '-'}
          {formatCurrency(expense.amount, state.currency)}
        </div>

        {/* Actions */}
        <div className="item-actions">
          <button
            id={`edit-btn-${expense.id}`}
            className="action-btn"
            onClick={() => openEditModal(expense)}
            title="Edit this transaction"
            aria-label={`Edit ${expense.title}`}
          >
            ✏️
          </button>
          <button
            id={`delete-btn-${expense.id}`}
            className="action-btn delete"
            onClick={() => promptDelete(expense)}
            title="Delete this transaction"
            aria-label={`Delete ${expense.title}`}
          >
            🗑️
          </button>
        </div>
      </div>
    </article>
  );
};
