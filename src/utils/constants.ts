/**
 * Shared-room expense categories.
 *
 * The database stores `category` as free text, so these are only the choices
 * offered in the UI. No sample or seed financial data lives here.
 */

export interface ExpenseCategory {
  id: string;
  name: string;
  icon: string;
}

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  { id: 'groceries', name: 'Groceries & Food', icon: '🛒' },
  { id: 'utilities', name: 'Utilities & Bills', icon: '⚡' },
  { id: 'rent', name: 'Rent & Housing', icon: '🏠' },
  { id: 'household', name: 'Household & Supplies', icon: '🧻' },
  { id: 'cleaning', name: 'Cleaning', icon: '🧽' },
  { id: 'internet', name: 'Internet & Phone', icon: '📶' },
  { id: 'transport', name: 'Transport & Fuel', icon: '🚗' },
  { id: 'maintenance', name: 'Repairs & Maintenance', icon: '🔧' },
  { id: 'entertainment', name: 'Entertainment', icon: '🎬' },
  { id: 'other', name: 'Other', icon: '📦' },
];

export const DEFAULT_EXPENSE_CATEGORY = EXPENSE_CATEGORIES[0]?.id ?? 'other';
