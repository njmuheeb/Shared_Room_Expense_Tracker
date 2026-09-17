import React from 'react';
import { useExpenses } from '../../context/ExpenseContext';
import { formatCurrency } from '../../utils/formatters';

export const CategoryBreakdown: React.FC = () => {
  const { metrics, state, setFilter } = useExpenses();
  const { categoryBreakdown } = metrics;
  const currency = state.currency;

  if (categoryBreakdown.length === 0) {
    return null;
  }

  return (
    <section className="breakdown-card animate-fade-in" aria-label="Category Spending Breakdown">
      <div className="breakdown-header">
        <h2 className="section-title">
          <span>🏷️</span>
          <span>Category Breakdown</span>
        </h2>
        <span className="results-badge">
          {categoryBreakdown.length} {categoryBreakdown.length === 1 ? 'Category' : 'Categories'} Active
        </span>
      </div>

      {/* Multi-segment distribution proportional bar */}
      <div
        className="multi-progress-bar"
        title="Proportional category spending breakdown"
        aria-hidden="true"
      >
        {categoryBreakdown.map((item) => (
          <div
            key={item.category.id}
            className="bar-segment"
            style={{
              width: `${item.percentage}%`,
              backgroundColor: item.category.color,
            }}
            title={`${item.category.name}: ${item.percentage}% (${formatCurrency(item.total, currency)})`}
          />
        ))}
      </div>

      {/* Grid of category items */}
      <div className="breakdown-grid">
        {categoryBreakdown.map((item) => {
          const isCurrentFilter = state.filter.categoryId === item.category.id;

          return (
            <div
              key={item.category.id}
              className="category-stat-item"
              onClick={() => {
                // Clicking category toggles filter on/off
                setFilter({
                  categoryId: isCurrentFilter ? 'all' : item.category.id,
                });
              }}
              style={{
                cursor: 'pointer',
                borderColor: isCurrentFilter ? item.category.color : undefined,
                boxShadow: isCurrentFilter ? `0 0 0 2px ${item.category.color}40` : undefined,
              }}
              role="button"
              tabIndex={0}
              title={`Click to ${isCurrentFilter ? 'clear filter' : 'filter by ' + item.category.name}`}
            >
              <div className="cat-stat-top">
                <div className="cat-stat-name">
                  <span>{item.category.icon}</span>
                  <span>{item.category.name}</span>
                </div>
                <div className="cat-stat-amount">{formatCurrency(item.total, currency)}</div>
              </div>

              {/* Progress bar */}
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{
                    width: `${item.percentage}%`,
                    backgroundColor: item.category.color,
                  }}
                />
              </div>

              <div className="cat-stat-footer">
                <span>{item.percentage}% of total</span>
                <span>
                  {item.count} {item.count === 1 ? 'entry' : 'entries'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
