import type { Transaction } from '../models/expense';
import { DEFAULT_CURRENCY, SAMPLE_TRANSACTIONS } from '../utils/constants';

const STORAGE_KEYS = {
  TRANSACTIONS: 'personal_expense_tracker_data_v2',
  CURRENCY: 'personal_expense_tracker_currency_v1',
  THEME: 'personal_expense_tracker_theme_v1',
  INITIALIZED: 'personal_expense_tracker_initialized_v2',
};

export const storageService = {
  getTransactions(): Transaction[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.TRANSACTIONS);
      const isInitialized = localStorage.getItem(STORAGE_KEYS.INITIALIZED);

      if (!isInitialized && !raw) {
        this.saveTransactions(SAMPLE_TRANSACTIONS);
        localStorage.setItem(STORAGE_KEYS.INITIALIZED, 'true');
        return SAMPLE_TRANSACTIONS;
      }

      if (!raw) return [];

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];

      return parsed.filter(
        (item): item is Transaction =>
          item &&
          typeof item.id === 'string' &&
          typeof item.title === 'string' &&
          typeof item.amount === 'number' &&
          (item.type === 'income' || item.type === 'expense') &&
          typeof item.categoryId === 'string' &&
          typeof item.date === 'string'
      );
    } catch (err) {
      console.error('Failed to load transactions from localStorage:', err);
      return [];
    }
  },

  saveTransactions(transactions: Transaction[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(transactions));
      localStorage.setItem(STORAGE_KEYS.INITIALIZED, 'true');
    } catch (err) {
      console.error('Failed to save transactions to localStorage:', err);
    }
  },

  getCurrency(): string {
    try {
      return localStorage.getItem(STORAGE_KEYS.CURRENCY) || DEFAULT_CURRENCY;
    } catch {
      return DEFAULT_CURRENCY;
    }
  },

  saveCurrency(currencySymbol: string): void {
    try {
      localStorage.setItem(STORAGE_KEYS.CURRENCY, currencySymbol);
    } catch (err) {
      console.error('Failed to save currency:', err);
    }
  },

  getTheme(): 'dark' | 'light' {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.THEME);
      if (stored === 'light' || stored === 'dark') return stored;

      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        return 'light';
      }
      return 'dark';
    } catch {
      return 'dark';
    }
  },

  saveTheme(theme: 'dark' | 'light'): void {
    try {
      localStorage.setItem(STORAGE_KEYS.THEME, theme);
    } catch (err) {
      console.error('Failed to save theme:', err);
    }
  },

  loadSampleData(): Transaction[] {
    this.saveTransactions(SAMPLE_TRANSACTIONS);
    return SAMPLE_TRANSACTIONS;
  },

  clearAllTransactions(): void {
    try {
      localStorage.removeItem(STORAGE_KEYS.TRANSACTIONS);
      localStorage.setItem(STORAGE_KEYS.INITIALIZED, 'true');
    } catch (err) {
      console.error('Failed to clear transactions:', err);
    }
  },
};
