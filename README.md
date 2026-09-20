# 🏠 Shared Room Expense Tracker

A simple and modern web application for managing shared room finances, contributions, expenses, and reimbursements among roommates.

## 🔗 Live Demo

🌐 **Live Application:**  
https://shared-room-expense-tracker.njmuheeb.workers.dev/

## 📌 About the Project

The **Shared Room Expense Tracker** is a web application designed to help roommates manage their shared finances in one place.

It allows members of a shared room to create or join a room, contribute money to a common fund, record shared expenses, manage reimbursements, and monitor the overall fund balance.

The goal of the project is to replace manual calculations, paper records, spreadsheets, and scattered messages with a simple and organized digital solution.

## 🎯 Problem / Purpose

Managing money in a shared room can become difficult when multiple people contribute money and make expenses.

Common methods such as paper records, WhatsApp messages, notes, spreadsheets, or manual calculations can make it difficult to track:

- Who contributed money
- How much money is available
- Where the shared money was spent
- Who paid for an expense
- Reimbursements between members
- The current room fund balance

The purpose of this project is to provide a centralized and easy-to-use platform where roommates can manage their shared finances with greater transparency and less manual calculation.


## ✨ Features

### 🔐 Authentication
- User registration and login
- Email/password authentication
- Magic-link authentication
- Password recovery
- Secure user sessions

### 🏠 Room Management
- Create a shared room
- Join an existing room using a room code
- Support for multiple room members
- Room-based financial data

### 💰 Shared Fund
- Record member contributions
- Track total contributions
- Monitor the available room balance
- Automatically reflect expenses in the fund

### 🧾 Expense Management
- Record shared expenses
- Add expense descriptions
- Record expense amount and payer
- Track expense history
- Automatically update the shared fund balance

### 💸 Reimbursements
- Record reimbursement transactions
- Track reimbursement activity
- Keep payment records organized

### 📊 Dashboard
- View total contributions
- View total expenses
- View current fund balance
- View recent transactions
- View member activity
- Monitor overall room finances

### 🇮🇳 Indian Rupee Support
- Financial amounts displayed in Indian Rupees (₹)
- Indian number formatting
- Centralized currency formatting throughout the application


## 🔄 How It Works

1. Create an account or log in.
2. Create a new shared room or join an existing room using a room code.
3. Room members contribute money to the shared fund.
4. Record shared expenses whenever money is spent.
5. Record reimbursements when a member needs to be reimbursed.
6. The application automatically keeps track of contributions, expenses, and the available fund balance.
7. Members can monitor the room's financial activity from the dashboard.


## 🛠️ Technology Stack

### Frontend
- React
- TypeScript
- Vite
- HTML
- CSS

### Backend & Database
- Supabase
- PostgreSQL
- Supabase Authentication
- Row Level Security (RLS)
- PostgreSQL RPC functions

### Development Tools
- Visual Studio Code
- Git
- GitHub
- npm

### Deployment
- Cloudflare Workers


## 🗄️ Database

The application uses **Supabase PostgreSQL** for storing and managing shared room data.

The main data entities include:

- `rooms` — Shared room information
- `members` — Members belonging to each room
- `contributions` — Money contributed by members
- `expenses` — Shared room expenses
- `reimbursements` — Reimbursement records

The application also uses database views and PostgreSQL functions to calculate and manage room balances and member activity.


## 🔒 Security

The application uses Supabase Authentication and database-level security features to help protect user and room data.

Security features include:

- Supabase Authentication for user accounts and sessions
- Row Level Security (RLS) for database access control
- Room-based data access
- Protected database operations
- Environment variables for Supabase configuration

Sensitive credentials and secret keys are not included in the source code or public repository.


## 🚀 Run Locally

### 1. Clone the repository

```bash
git clone https://github.com/njmuheeb/Shared_Room_Expense_Tracker.git

### 2. Open the project

cd Shared_Room_Expense_Tracker

### 3. Install dependencies

npm install

### 4. Configure environment variables

Create a .env file in the project root:

VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

Do not add your .env file or Supabase service-role key to the GitHub repository.

### 5. Start the development server
npm run dev

The application will normally be available at:

http://localhost:5173

### ⚠️ One thing to check

Make sure this GitHub URL is actually your repository:

```text
https://github.com/njmuheeb/Shared_Room_Expense_Tracker.git

If your repository has a different name, replace that URL with your actual repository URL.

Then press Ctrl + S.


## 🌐 Deployment

The application is deployed using **Cloudflare Workers**.

### Production

🌐 **Live Application:**  
https://shared-room-expense-tracker.njmuheeb.workers.dev/

### Deployment Workflow

The project follows a Git-based deployment workflow:

```text
Local Changes
      ↓
Git Commit
      ↓
Git Push
      ↓
GitHub
      ↓
Cloudflare Build & Deployment
      ↓
Live Application


## 🔮 Future Improvements

Some features planned for future versions include:

- 📱 Progressive Web App (PWA) support
- 🔔 Push notifications
- 📊 Advanced expense reports and analytics
- 📅 Monthly and yearly expense summaries
- 📈 Visual charts and financial insights
- 📤 CSV and Excel export
- 🧾 PDF reports
- 👥 Improved member management
- 🌙 Dark mode
- 💰 Budget management
- 📱 Further improvements to the mobile experience


## 📌 Project Status

🟢 **Active Development**

The core functionality of the Shared Room Expense Tracker is implemented, including:

- User authentication
- Room creation and joining
- Member management
- Shared fund contributions
- Expense tracking
- Reimbursements
- Dashboard and financial summaries
- Supabase database integration
- Cloudflare deployment

The project is still open for improvements and additional features.


## 👨‍💻 Author

**Muheeb Mushtaq**

B.Tech Computer Science Engineering

🔗 **GitHub:**  
https://github.com/njmuheeb



## 📄 License

This project is currently intended for educational and portfolio purposes.