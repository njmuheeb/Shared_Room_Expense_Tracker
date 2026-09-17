import type {
  Category,
  CategoryMetric,
  DashboardMetrics,
  Transaction,
  TransactionFilter,
} from '../models/expense';
import { CATEGORIES } from './constants';

/**
 * Computes dashboard statistics (Income, Expenses, Net Balance) from transactions.
 */
export function calculateMetrics(
  transactions: Transaction[],
  categories: Category[]
): DashboardMetrics {
  const transactionCount = transactions.length;

  let totalIncome = 0;
  let totalExpense = 0;

  transactions.forEach((item) => {
    if (item.type === 'income') {
      totalIncome += item.amount;
    } else {
      totalExpense += item.amount;
    }
  });

  const netBalance = totalIncome - totalExpense;

  // Aggregate expenses by category for breakdown
  const categoryTotalsMap = new Map<string, { total: number; count: number }>();

  categories.forEach((cat) => {
    categoryTotalsMap.set(cat.id, { total: 0, count: 0 });
  });

  // Calculate breakdown for expenses
  transactions
    .filter((item) => item.type === 'expense')
    .forEach((item) => {
      const current = categoryTotalsMap.get(item.categoryId) || { total: 0, count: 0 };
      categoryTotalsMap.set(item.categoryId, {
        total: current.total + item.amount,
        count: current.count + 1,
      });
    });

  const categoryBreakdown: CategoryMetric[] = [];
  categoryTotalsMap.forEach((val, catId) => {
    if (val.total > 0) {
      const category = CATEGORIES[catId as keyof typeof CATEGORIES] || {
        id: catId,
        name: catId,
        icon: '📌',
        color: '#64748b',
        bgLight: 'rgba(100, 116, 139, 0.15)',
        type: 'expense',
      };

      const percentage = totalExpense > 0 ? (val.total / totalExpense) * 100 : 0;
      categoryBreakdown.push({
        category,
        total: val.total,
        count: val.count,
        percentage: Number(percentage.toFixed(1)),
      });
    }
  });

  categoryBreakdown.sort((a, b) => b.total - a.total);

  return {
    totalIncome,
    totalExpense,
    netBalance,
    transactionCount,
    categoryBreakdown,
  };
}

/**
 * Filters and sorts transactions based on current filter state.
 */
export function filterAndSortTransactions(
  transactions: Transaction[],
  filter: TransactionFilter
): Transaction[] {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  return transactions
    .filter((item) => {
      // 1. Transaction Type filter (All, Income, Expense)
      if (filter.type !== 'all' && item.type !== filter.type) {
        return false;
      }

      // 2. Text search query in title and notes
      if (filter.searchQuery.trim()) {
        const query = filter.searchQuery.toLowerCase().trim();
        const matchesTitle = item.title.toLowerCase().includes(query);
        const matchesNotes = item.notes ? item.notes.toLowerCase().includes(query) : false;
        if (!matchesTitle && !matchesNotes) {
          return false;
        }
      }

      // 3. Category filter
      if (filter.categoryId !== 'all' && item.categoryId !== filter.categoryId) {
        return false;
      }

      // 4. Date range filter
      if (filter.dateRange !== 'all') {
        const [y, m, d] = item.date.split('-').map(Number);
        const itemDate = new Date(y, m - 1, d);

        if (filter.dateRange === 'this-month') {
          if (itemDate.getFullYear() !== currentYear || itemDate.getMonth() !== currentMonth) {
            return false;
          }
        } else if (filter.dateRange === 'this-year') {
          if (itemDate.getFullYear() !== currentYear) {
            return false;
          }
        } else if (filter.dateRange === 'last-30-days') {
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          if (itemDate < thirtyDaysAgo) {
            return false;
          }
        }
      }

      return true;
    })
    .sort((a, b) => {
      let comparison = 0;
      if (filter.sortBy === 'date') {
        comparison = new Date(b.date).getTime() - new Date(a.date).getTime();
      } else if (filter.sortBy === 'amount') {
        comparison = b.amount - a.amount;
      } else if (filter.sortBy === 'title') {
        comparison = a.title.localeCompare(b.title);
      }

      return filter.sortOrder === 'desc' ? comparison : -comparison;
    });
}
