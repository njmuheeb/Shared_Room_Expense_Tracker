import React, { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import type {
  DashboardMetrics,
  Transaction,
  TransactionFilter,
} from '../models/expense';
import { storageService } from '../services/storageService';
import { calculateMetrics, filterAndSortTransactions } from '../utils/aggregations';
import { CATEGORY_LIST, DEFAULT_CURRENCY } from '../utils/constants';

interface TransactionState {
  transactions: Transaction[];
  filter: TransactionFilter;
  currency: string;
  theme: 'dark' | 'light';
  isModalOpen: boolean;
  editingTransaction: Transaction | null;
  transactionToDelete: Transaction | null;
  isClearAllModalOpen: boolean;
}

type TransactionAction =
  | { type: 'ADD_TRANSACTION'; payload: Transaction }
  | { type: 'UPDATE_TRANSACTION'; payload: Transaction }
  | { type: 'DELETE_TRANSACTION'; payload: string }
  | { type: 'SET_FILTER'; payload: Partial<TransactionFilter> }
  | { type: 'RESET_FILTER' }
  | { type: 'SET_CURRENCY'; payload: string }
  | { type: 'SET_THEME'; payload: 'dark' | 'light' }
  | { type: 'OPEN_ADD_MODAL' }
  | { type: 'OPEN_EDIT_MODAL'; payload: Transaction }
  | { type: 'CLOSE_MODAL' }
  | { type: 'PROMPT_DELETE'; payload: Transaction }
  | { type: 'CANCEL_DELETE' }
  | { type: 'PROMPT_CLEAR_ALL' }
  | { type: 'CANCEL_CLEAR_ALL' }
  | { type: 'CLEAR_ALL' }
  | { type: 'LOAD_SAMPLE_DATA'; payload: Transaction[] };

const initialFilter: TransactionFilter = {
  searchQuery: '',
  type: 'all',
  categoryId: 'all',
  dateRange: 'all',
  sortBy: 'date',
  sortOrder: 'desc',
};

function transactionReducer(state: TransactionState, action: TransactionAction): TransactionState {
  switch (action.type) {
    case 'ADD_TRANSACTION': {
      const updated = [action.payload, ...state.transactions];
      storageService.saveTransactions(updated);
      return { ...state, transactions: updated, isModalOpen: false, editingTransaction: null };
    }
    case 'UPDATE_TRANSACTION': {
      const updated = state.transactions.map((item) =>
        item.id === action.payload.id ? action.payload : item
      );
      storageService.saveTransactions(updated);
      return { ...state, transactions: updated, isModalOpen: false, editingTransaction: null };
    }
    case 'DELETE_TRANSACTION': {
      const updated = state.transactions.filter((item) => item.id !== action.payload);
      storageService.saveTransactions(updated);
      return { ...state, transactions: updated, transactionToDelete: null };
    }
    case 'SET_FILTER':
      return { ...state, filter: { ...state.filter, ...action.payload } };
    case 'RESET_FILTER':
      return { ...state, filter: initialFilter };
    case 'SET_CURRENCY':
      storageService.saveCurrency(action.payload);
      return { ...state, currency: action.payload };
    case 'SET_THEME':
      storageService.saveTheme(action.payload);
      return { ...state, theme: action.payload };
    case 'OPEN_ADD_MODAL':
      return { ...state, isModalOpen: true, editingTransaction: null };
    case 'OPEN_EDIT_MODAL':
      return { ...state, isModalOpen: true, editingTransaction: action.payload };
    case 'CLOSE_MODAL':
      return { ...state, isModalOpen: false, editingTransaction: null };
    case 'PROMPT_DELETE':
      return { ...state, transactionToDelete: action.payload };
    case 'CANCEL_DELETE':
      return { ...state, transactionToDelete: null };
    case 'PROMPT_CLEAR_ALL':
      return { ...state, isClearAllModalOpen: true };
    case 'CANCEL_CLEAR_ALL':
      return { ...state, isClearAllModalOpen: false };
    case 'CLEAR_ALL':
      storageService.clearAllTransactions();
      return { ...state, transactions: [], isClearAllModalOpen: false };
    case 'LOAD_SAMPLE_DATA':
      storageService.saveTransactions(action.payload);
      return { ...state, transactions: action.payload };
    default:
      return state;
  }
}

interface ExpenseContextType {
  state: TransactionState;
  filteredTransactions: Transaction[];
  metrics: DashboardMetrics;
  overallMetrics: DashboardMetrics;
  addTransaction: (data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateTransaction: (id: string, data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) => void;
  deleteTransaction: (id: string) => void;
  setFilter: (partial: Partial<TransactionFilter>) => void;
  resetFilter: () => void;
  setCurrency: (symbol: string) => void;
  toggleTheme: () => void;
  openAddModal: () => void;
  openEditModal: (transaction: Transaction) => void;
  closeModal: () => void;
  promptDelete: (transaction: Transaction) => void;
  cancelDelete: () => void;
  confirmDelete: () => void;
  promptClearAll: () => void;
  cancelClearAll: () => void;
  confirmClearAll: () => void;
  loadSampleData: () => void;

  // Backwards compatibility aliases
  expenses: Transaction[];
  filteredExpenses: Transaction[];
  addExpense: (data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) => void;
  deleteExpense: (id: string) => void;
}

const ExpenseContext = createContext<ExpenseContextType | undefined>(undefined);

export const ExpenseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(transactionReducer, null, () => ({
    transactions: storageService.getTransactions(),
    filter: initialFilter,
    currency: storageService.getCurrency() || DEFAULT_CURRENCY,
    theme: storageService.getTheme(),
    isModalOpen: false,
    editingTransaction: null,
    transactionToDelete: null,
    isClearAllModalOpen: false,
  }));

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', state.theme);
  }, [state.theme]);

  const filteredTransactions = useMemo(() => {
    return filterAndSortTransactions(state.transactions, state.filter);
  }, [state.transactions, state.filter]);

  // Category breakdown uses filtered data (respects active filter)
  const metrics = useMemo(() => {
    return calculateMetrics(filteredTransactions, CATEGORY_LIST);
  }, [filteredTransactions]);

  // Overall metrics always reflect the FULL portfolio (unaffected by filters)
  const overallMetrics = useMemo(() => {
    return calculateMetrics(state.transactions, CATEGORY_LIST);
  }, [state.transactions]);

  const addTransaction = (data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newTransaction: Transaction = {
      ...data,
      id: crypto.randomUUID ? crypto.randomUUID() : `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    dispatch({ type: 'ADD_TRANSACTION', payload: newTransaction });
  };

  const updateTransaction = (id: string, data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) => {
    const existing = state.transactions.find((item) => item.id === id);
    if (!existing) return;

    const updated: Transaction = {
      ...existing,
      ...data,
      updatedAt: Date.now(),
    };
    dispatch({ type: 'UPDATE_TRANSACTION', payload: updated });
  };

  const deleteTransaction = (id: string) => {
    dispatch({ type: 'DELETE_TRANSACTION', payload: id });
  };

  const confirmDelete = () => {
    if (state.transactionToDelete) {
      dispatch({ type: 'DELETE_TRANSACTION', payload: state.transactionToDelete.id });
    }
  };

  const setFilter = (partial: Partial<TransactionFilter>) => {
    dispatch({ type: 'SET_FILTER', payload: partial });
  };

  const resetFilter = () => {
    dispatch({ type: 'RESET_FILTER' });
  };

  const setCurrency = (symbol: string) => {
    dispatch({ type: 'SET_CURRENCY', payload: symbol });
  };

  const toggleTheme = () => {
    const next = state.theme === 'dark' ? 'light' : 'dark';
    dispatch({ type: 'SET_THEME', payload: next });
  };

  const openAddModal = () => dispatch({ type: 'OPEN_ADD_MODAL' });
  const openEditModal = (tx: Transaction) => dispatch({ type: 'OPEN_EDIT_MODAL', payload: tx });
  const closeModal = () => dispatch({ type: 'CLOSE_MODAL' });
  const promptDelete = (tx: Transaction) => dispatch({ type: 'PROMPT_DELETE', payload: tx });
  const cancelDelete = () => dispatch({ type: 'CANCEL_DELETE' });
  const promptClearAll = () => dispatch({ type: 'PROMPT_CLEAR_ALL' });
  const cancelClearAll = () => dispatch({ type: 'CANCEL_CLEAR_ALL' });
  const confirmClearAll = () => dispatch({ type: 'CLEAR_ALL' });

  const loadSampleData = () => {
    const samples = storageService.loadSampleData();
    dispatch({ type: 'LOAD_SAMPLE_DATA', payload: samples });
  };

  return (
    <ExpenseContext.Provider
      value={{
        state,
        filteredTransactions,
        metrics,
        overallMetrics,
        addTransaction,
        updateTransaction,
        deleteTransaction,
        setFilter,
        resetFilter,
        setCurrency,
        toggleTheme,
        openAddModal,
        openEditModal,
        closeModal,
        promptDelete,
        cancelDelete,
        confirmDelete,
        promptClearAll,
        cancelClearAll,
        confirmClearAll,
        loadSampleData,

        // Backwards compatibility aliases
        expenses: state.transactions,
        filteredExpenses: filteredTransactions,
        addExpense: addTransaction,
        deleteExpense: deleteTransaction,
      }}
    >
      {children}
    </ExpenseContext.Provider>
  );
};

export function useExpenses(): ExpenseContextType {
  const context = useContext(ExpenseContext);
  if (!context) {
    throw new Error('useExpenses must be used within an ExpenseProvider');
  }
  return context;
}
