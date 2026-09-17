export type TransactionType = 'income' | 'expense';

export type CategoryId =
  // Expense Categories
  | 'food'
  | 'housing'
  | 'transportation'
  | 'utilities'
  | 'entertainment'
  | 'healthcare'
  | 'shopping'
  // Income Categories
  | 'salary'
  | 'freelance'
  | 'investment'
  | 'gift'
  | 'other_income'
  | 'other';

export interface Category {
  id: CategoryId;
  name: string;
  icon: string;
  color: string;
  bgLight: string;
  type: TransactionType;
}

export interface Transaction {
  id: string;
  title: string;
  amount: number;
  type: TransactionType;
  categoryId: CategoryId;
  date: string; // ISO format 'YYYY-MM-DD'
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

// Backwards-compatible alias
export type Expense = Transaction;

export type SortField = 'date' | 'amount' | 'title';
export type SortOrder = 'asc' | 'desc';

export interface TransactionFilter {
  searchQuery: string;
  type: TransactionType | 'all';
  categoryId: CategoryId | 'all';
  dateRange: 'all' | 'this-month' | 'last-30-days' | 'this-year';
  sortBy: SortField;
  sortOrder: SortOrder;
}

export type ExpenseFilter = TransactionFilter;

export interface CategoryMetric {
  category: Category;
  total: number;
  percentage: number;
  count: number;
}

export interface DashboardMetrics {
  totalIncome: number;
  totalExpense: number;
  netBalance: number;
  transactionCount: number;
  categoryBreakdown: CategoryMetric[];
}

export interface CurrencyConfig {
  code: string;
  symbol: string;
  label: string;
}
