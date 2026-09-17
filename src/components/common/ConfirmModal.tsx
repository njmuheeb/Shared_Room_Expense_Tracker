import React, { useEffect } from 'react';
import { useExpenses } from '../../context/ExpenseContext';
import { formatCurrency } from '../../utils/formatters';

export const ConfirmModal: React.FC = () => {
  const {
    state,
    cancelDelete,
    confirmDelete,
    cancelClearAll,
    confirmClearAll,
  } = useExpenses();

  const { transactionToDelete, isClearAllModalOpen, currency } = state;
  const isOpen = Boolean(transactionToDelete) || isClearAllModalOpen;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        if (transactionToDelete) cancelDelete();
        if (isClearAllModalOpen) cancelClearAll();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, transactionToDelete, isClearAllModalOpen, cancelDelete, cancelClearAll]);

  if (!isOpen) return null;

  const isDeletingSingle = Boolean(transactionToDelete);

  return (
    <div
      className="modal-overlay animate-fade-in"
      onClick={isDeletingSingle ? cancelDelete : cancelClearAll}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div
        className="modal-content animate-slide-up"
        style={{ maxWidth: 440 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="modal-title" id="confirm-dialog-title">
            {isDeletingSingle ? '⚠️ Delete Transaction?' : '🚨 Clear All Data?'}
          </h2>
          <button
            id="close-confirm-modal-btn"
            className="action-btn"
            onClick={isDeletingSingle ? cancelDelete : cancelClearAll}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          {isDeletingSingle && transactionToDelete ? (
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Are you sure you want to delete{' '}
              <strong style={{ color: 'var(--text-primary)' }}>{transactionToDelete.title}</strong>{' '}
              ({formatCurrency(transactionToDelete.amount, currency)})? This action cannot be undone.
            </p>
          ) : (
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Are you sure you want to clear <strong>all {state.transactions.length} transactions</strong>?
              Your saved data in local storage will be permanently wiped.
            </p>
          )}
        </div>

        <div className="modal-footer">
          <button
            id="cancel-confirm-btn"
            type="button"
            className="btn btn-secondary"
            onClick={isDeletingSingle ? cancelDelete : cancelClearAll}
          >
            Cancel
          </button>
          <button
            id="action-confirm-btn"
            type="button"
            className="btn btn-danger"
            onClick={isDeletingSingle ? confirmDelete : confirmClearAll}
          >
            {isDeletingSingle ? 'Delete Transaction' : 'Clear All'}
          </button>
        </div>
      </div>
    </div>
  );
};
