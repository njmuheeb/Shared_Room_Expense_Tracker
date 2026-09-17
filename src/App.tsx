import React from 'react';
import { ConfirmModal } from './components/common/ConfirmModal';
import { CategoryBreakdown } from './components/dashboard/CategoryBreakdown';
import { MetricCards } from './components/dashboard/MetricCards';
import { ExpenseFilters } from './components/expense/ExpenseFilters';
import { ExpenseList } from './components/expense/ExpenseList';
import { ExpenseModal } from './components/expense/ExpenseModal';
import { Navbar } from './components/layout/Navbar';
import { ExpenseProvider } from './context/ExpenseContext';

const AppContent: React.FC = () => {
  return (
    <div className="app-layout">
      {/* Top App Navbar */}
      <Navbar />

      {/* Main Dashboard Views */}
      <main className="main-content">
        {/* 1. Overview Analytics */}
        <MetricCards />

        {/* 2. Category Spending Breakdown */}
        <CategoryBreakdown />

        {/* 3. Search & Filters */}
        <ExpenseFilters />

        {/* 4. Filtered Expense List / History */}
        <ExpenseList />
      </main>

      {/* Modal Dialogs */}
      <ExpenseModal />
      <ConfirmModal />

      {/* Footer */}
      <footer className="app-footer">
        <p>
          <strong>ExpenFlow</strong> — 100% Client-Side &amp; Local-First Personal Expense Tracker.
          Data is stored locally in your browser.
        </p>
      </footer>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <ExpenseProvider>
      <AppContent />
    </ExpenseProvider>
  );
};

export default App;
