import React from 'react';
import { useExpenses } from '../../context/ExpenseContext';
import type { CategoryId, SortField, TransactionType } from '../../models/expense';
import { CATEGORY_LIST } from '../../utils/constants';

export const ExpenseFilters: React.FC = () => {
  const { state, setFilter, resetFilter } = useExpenses();
  const { filter } = state;

  const isFiltered =
    Boolean(filter.searchQuery) ||
    filter.type !== 'all' ||
    filter.categoryId !== 'all' ||
    filter.dateRange !== 'all' ||
    filter.sortBy !== 'date' ||
    filter.sortOrder !== 'desc';

  return (
    <div className="filter-toolbar animate-fade-in" role="search" aria-label="Filter and Search Transactions">
      {/* Search Input */}
      <div className="search-box">
        <span className="search-icon" aria-hidden="true">
          🔍
        </span>
        <input
          id="search-expenses-input"
          type="text"
          className="search-input"
          placeholder="Search transactions..."
          value={filter.searchQuery}
          onChange={(e) => setFilter({ searchQuery: e.target.value })}
        />
        {filter.searchQuery && (
          <button
            id="clear-search-btn"
            className="clear-search-btn"
            onClick={() => setFilter({ searchQuery: '' })}
            title="Clear search"
          >
            ✕
          </button>
        )}
      </div>

      {/* Filter Options */}
      <div className="filters-group">
        {/* Type Filter */}
        <select
          id="type-filter-select"
          className="select-input"
          value={filter.type}
          onChange={(e) => setFilter({ type: e.target.value as TransactionType | 'all' })}
          aria-label="Filter by Type"
        >
          <option value="all">All Types</option>
          <option value="expense">Expenses Only</option>
          <option value="income">Income Only</option>
        </select>

        {/* Category Filter */}
        <select
          id="category-filter-select"
          className="select-input"
          value={filter.categoryId}
          onChange={(e) => setFilter({ categoryId: e.target.value as CategoryId | 'all' })}
          aria-label="Filter by Category"
        >
          <option value="all">All Categories</option>
          {CATEGORY_LIST.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.icon} {cat.name} ({cat.type})
            </option>
          ))}
        </select>

        {/* Date Range Filter */}
        <select
          id="date-range-select"
          className="select-input"
          value={filter.dateRange}
          onChange={(e) =>
            setFilter({
              dateRange: e.target.value as 'all' | 'this-month' | 'last-30-days' | 'this-year',
            })
          }
          aria-label="Filter by Date Range"
        >
          <option value="all">All Time</option>
          <option value="this-month">This Month</option>
          <option value="last-30-days">Past 30 Days</option>
          <option value="this-year">This Year</option>
        </select>

        {/* Sort By Field */}
        <select
          id="sort-by-select"
          className="select-input"
          value={filter.sortBy}
          onChange={(e) => setFilter({ sortBy: e.target.value as SortField })}
          aria-label="Sort By Field"
        >
          <option value="date">Sort by Date</option>
          <option value="amount">Sort by Amount</option>
          <option value="title">Sort by Title</option>
        </select>

        {/* Sort Order Toggle */}
        <button
          id="sort-order-btn"
          className="btn-icon"
          onClick={() => setFilter({ sortOrder: filter.sortOrder === 'desc' ? 'asc' : 'desc' })}
          title={`Order: ${filter.sortOrder === 'desc' ? 'Descending' : 'Ascending'}`}
          aria-label="Toggle sort direction"
        >
          {filter.sortOrder === 'desc' ? '⬇️' : '⬆️'}
        </button>

        {/* Reset Filter Button */}
        {isFiltered && (
          <button
            id="reset-filter-btn"
            className="btn btn-ghost"
            onClick={resetFilter}
            title="Reset all filters"
            style={{ fontSize: '0.825rem' }}
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
};
