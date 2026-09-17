import React, { useEffect, useState } from 'react';
import { useExpenses } from '../../context/ExpenseContext';
import type { CategoryId, TransactionType } from '../../models/expense';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../../utils/constants';

export const ExpenseModal: React.FC = () => {
  const { state, closeModal, addTransaction, updateTransaction } = useExpenses();
  const { isModalOpen, editingTransaction, currency } = state;

  const [type, setType] = useState<TransactionType>('expense');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState<CategoryId>('food');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');

  const [errors, setErrors] = useState<{
    title?: string;
    amount?: string;
    date?: string;
  }>({});

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  useEffect(() => {
    if (editingTransaction) {
      setType(editingTransaction.type);
      setTitle(editingTransaction.title);
      setAmount(editingTransaction.amount.toString());
      setCategoryId(editingTransaction.categoryId);
      setDate(editingTransaction.date);
      setNotes(editingTransaction.notes || '');
    } else {
      setType('expense');
      setTitle('');
      setAmount('');
      setCategoryId('food');
      setDate(todayStr);
      setNotes('');
    }
    setErrors({});
  }, [editingTransaction, isModalOpen]);

  // When type changes (in add mode), reset to a valid category for that type
  const handleTypeChange = (newType: TransactionType) => {
    setType(newType);
    if (!editingTransaction) {
      if (newType === 'income') {
        setCategoryId('salary');
      } else {
        setCategoryId('food');
      }
    }
  };

  // Close modal on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isModalOpen) {
        closeModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen, closeModal]);

  if (!isModalOpen) return null;

  const validate = () => {
    const newErrors: { title?: string; amount?: string; date?: string } = {};

    if (!title.trim()) {
      newErrors.title = 'Title is required';
    } else if (title.trim().length > 80) {
      newErrors.title = 'Title must be 80 characters or fewer';
    }

    const numAmount = parseFloat(amount);
    if (!amount || isNaN(numAmount) || numAmount <= 0) {
      newErrors.amount = 'Please enter a valid amount greater than 0';
    }

    if (!date) {
      newErrors.date = 'Date is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const parsedAmount = parseFloat(parseFloat(amount).toFixed(2));

    if (editingTransaction) {
      updateTransaction(editingTransaction.id, {
        title: title.trim(),
        amount: parsedAmount,
        type,
        categoryId,
        date,
        notes: notes.trim() || undefined,
      });
    } else {
      addTransaction({
        title: title.trim(),
        amount: parsedAmount,
        type,
        categoryId,
        date,
        notes: notes.trim() || undefined,
      });
    }
  };

  const activeCategories = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  return (
    <div
      className="modal-overlay animate-fade-in"
      onClick={closeModal}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div className="modal-content animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title" id="modal-title">
            {editingTransaction
              ? `✏️ Edit ${editingTransaction.type === 'income' ? 'Income' : 'Expense'}`
              : '✨ New Transaction'}
          </h2>
          <button
            id="close-modal-btn"
            className="action-btn"
            onClick={closeModal}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {/* Transaction Type Switcher */}
            <div className="form-group">
              <label className="form-label">Transaction Type</label>
              <div
                className="type-toggle-bar"
                style={{
                  display: 'flex',
                  background: 'var(--bg-muted)',
                  padding: '4px',
                  borderRadius: 'var(--radius-md)',
                  gap: '4px',
                }}
              >
                <button
                  type="button"
                  id="type-expense-btn"
                  className={`btn ${type === 'expense' ? 'active' : ''}`}
                  onClick={() => handleTypeChange('expense')}
                  style={{
                    flex: 1,
                    padding: '0.5rem',
                    borderRadius: 'var(--radius-sm)',
                    background: type === 'expense' ? 'var(--color-danger)' : 'transparent',
                    color: type === 'expense' ? '#ffffff' : 'var(--text-secondary)',
                    fontWeight: 600,
                  }}
                >
                  📤 Expense
                </button>
                <button
                  type="button"
                  id="type-income-btn"
                  className={`btn ${type === 'income' ? 'active' : ''}`}
                  onClick={() => handleTypeChange('income')}
                  style={{
                    flex: 1,
                    padding: '0.5rem',
                    borderRadius: 'var(--radius-sm)',
                    background: type === 'income' ? 'var(--color-success)' : 'transparent',
                    color: type === 'income' ? '#ffffff' : 'var(--text-secondary)',
                    fontWeight: 600,
                  }}
                >
                  📥 Income
                </button>
              </div>
            </div>

            {/* Title Field */}
            <div className="form-group">
              <label htmlFor="transaction-title-input" className="form-label">
                Description / Title *
              </label>
              <input
                id="transaction-title-input"
                type="text"
                className="form-input"
                placeholder={type === 'income' ? 'e.g. Monthly Salary or Bonus' : 'e.g. Grocery Store Run'}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
              {errors.title && <span className="form-error">{errors.title}</span>}
            </div>

            {/* Amount Field */}
            <div className="form-group">
              <label htmlFor="transaction-amount-input" className="form-label">
                Amount ({currency}) *
              </label>
              <input
                id="transaction-amount-input"
                type="number"
                step="0.01"
                min="0.01"
                className="form-input"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              {errors.amount && <span className="form-error">{errors.amount}</span>}
            </div>

            {/* Category Field */}
            <div className="form-group">
              <label className="form-label">Category *</label>
              <div className="category-selection-grid">
                {activeCategories.map((cat) => {
                  const isSelected = categoryId === cat.id;
                  return (
                    <button
                      type="button"
                      key={cat.id}
                      className={`category-pill-btn ${isSelected ? 'active' : ''}`}
                      onClick={() => setCategoryId(cat.id)}
                    >
                      <span style={{ fontSize: '1.15rem' }}>{cat.icon}</span>
                      <span>{cat.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Date Field */}
            <div className="form-group">
              <label htmlFor="transaction-date-input" className="form-label">
                Date *
              </label>
              <input
                id="transaction-date-input"
                type="date"
                className="form-input"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
              {errors.date && <span className="form-error">{errors.date}</span>}
            </div>

            {/* Notes Field */}
            <div className="form-group">
              <label htmlFor="transaction-notes-input" className="form-label">
                Notes (Optional)
              </label>
              <textarea
                id="transaction-notes-input"
                className="form-textarea"
                rows={2}
                placeholder="Add extra details, account, or location..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="modal-footer">
            <button
              id="cancel-modal-btn"
              type="button"
              className="btn btn-secondary"
              onClick={closeModal}
            >
              Cancel
            </button>
            <button
              id="submit-transaction-btn"
              type="submit"
              className="btn btn-primary"
            >
              {editingTransaction ? 'Save Changes' : `Add ${type === 'income' ? 'Income' : 'Expense'}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
