# TripleS ERP Time Tracker

A Windows desktop application and ERP integration suite designed for time tracking and activity reporting across TripleS ERP.

---

## 1. System Overview & Technology Stack

- **Desktop Application**: Built with **Electron + React 18 + TypeScript + Vite**.
- **Database & Auth**: Direct integration with existing **Supabase** (`profiles`, `employee_onboarding`, `eod_reports`).
- **Activity Detection**: System-wide input activity tracking using Electron's native `powerMonitor` and foreground process detection on Windows 10/11.
- **Admin Module**: Fully integrated into the existing **TripleS ERP Web Application** (`/time-tracking`), respecting RBAC and layout conventions.
- **Packaging**: Windows executable and NSIS installer generation via `electron-builder`.

---

## 2. Key Features

### Employee Desktop App
- **Minimal, Premium UI**: Custom titlebar with dark and light themes (matching `#0B0F14` dark and `#F8FAFC` light specifications).
- **Employee Identification**: Displays authenticated employee avatar, full name, and designation (e.g., Omkar Sawant, Software Developer).
- **Circular Session Timer**: Real-time SVG circular timer showing elapsed time for today's session.
- **Strictly Two Time Metrics**:
  1. **Worked Hours**: Elapsed time from Clock In to Clock Out, excluding recorded breaks.
  2. **Active Hours**: Time spent actively interacting with the computer, excluding breaks and idle periods.
  *(Per specifications, Break Time is recorded internally for accurate deductions but never displayed as a separate employee metric).*
- **Session Controls**:
  - `Clock In / Start Session`: Begins a new tracking session.
  - `Take a Break` & `Resume Work`: Accurately pauses and resumes active interval measurement.
  - `Clock Out`: Finalizes session and triggers EOD sync.
- **System Tray & Background Resilience**:
  - Closing the window while tracking minimizes to the Windows system tray with a notification.
  - Safely pauses active tracking upon Windows screen lock or system sleep.
  - Recovers state gracefully across app restarts without data loss.

### ERP Admin Time Tracking Module
- Available directly within the TripleS ERP web navigation under **Time Tracking** for Admin and HR.
- **Overview Dashboard**:
  - Total Employees (24, +12% trend) and Currently Working (18, +5% trend).
  - Dual-bar Work Hours Overview chart (Worked Hours vs. Active Hours by hour from 9 AM to 6 PM).
  - Department filter dropdown.
- **Employee Time Reports**:
  - Search by employee name or designation.
  - Department and date filtering.
  - Status indicators (`Working`, `Idle`, `Offline`).
  - Formatted Worked Hours and Active Hours columns.
  - Last activity timestamps.
- **Employee Detail Drilldown**:
  - Employee header with status badge and worked/active totals.
  - **Activity Timeline**: Chronological log of clock-in, active foreground apps (e.g. VS Code, Chrome, Postman), and breaks.
  - **Applications Breakdown**: Time spent per foreground application.
  - **EOD Integration Status**: Visual indicator verifying that active hours are synchronized with EOD records.

### Automatic EOD Integration
- Automatically queries the employee's active hours for the current Asia/Kolkata business date.
- Auto-populates the existing `Worked Hours` field when opening the EOD Submission form in TripleS ERP.
- Includes a dedicated `Tracker: Xh YYm` quick-apply button in the EOD form.
- Protects existing approved or submitted EOD reports from accidental overwrite.

---

## 3. Database Migration Instructions

The migration file is located at:
- `supabase/migrations/20261014000000_create_time_tracking.sql`
- Also mirrored in `TripleS-ERP/supabase/migrations/20261014000000_create_time_tracking.sql`

### How to Apply in Supabase:
1. Log into your [Supabase Dashboard](https://supabase.com/dashboard).
2. Open your project: `sfjerymoxnolxblhelho`.
3. Navigate to **SQL Editor** in the left sidebar.
4. Click **New Query**.
5. Copy the contents of `supabase/migrations/20261014000000_create_time_tracking.sql` and paste them into the editor.
6. Click **Run**.
7. The following tables with full RLS policies will be created:
   - `public.time_sessions`: Stores session clock-in/out, worked minutes, and active minutes.
   - `public.session_breaks`: Stores break start, end, and duration.
   - `public.activity_logs`: Stores qualifying active intervals and foreground application names.

---

## 4. Setup & Running Locally

### Prerequisites
- Node.js v18+ (tested on Node v22.14.0)
- npm 9+
- Windows 10 or 11

### Desktop Application (`triples-time-tracker`)
```powershell
# Navigate to the desktop tracker directory
cd "C:\Users\HP\Desktop\Triple S Production\triples-time-tracker"

# Install dependencies
npm install

# Run automated tests
npm test

# Run desktop app in development mode
npm run dev

# Or launch with Electron
npm run electron:dev

# Build production bundle & Windows executable
npm run electron:build
```

### Existing TripleS ERP Web App
The ERP web application now includes:
- `/time-tracking`: Admin Time Tracking overview, employee reports, and detail view.
- `/api/time-tracking/session`: Session lifecycle endpoints.
- `/api/time-tracking/summary`: Daily active hours aggregation for EOD.
- `/api/time-tracking/admin/reports`: Admin report aggregation.
- Auto-fill integration in `EODSubmissionForm.tsx`.

To start the ERP server:
```powershell
cd "C:\Users\HP\Desktop\Triple S Production\TripleS-ERP"
npm run dev
```

---

## 5. Security & Privacy Principles

1. **No Keylogging**: Keypress counts and timestamps are queried, never keystroke content or passwords.
2. **No Screenshots**: Explicitly omitted in this release in adherence to privacy and compliance directives.
3. **Context Isolation**: Electron renderer has `nodeIntegration: false` and `contextIsolation: true`. Privileged operations are mediated through a restricted preload bridge.
4. **Zero Secret Exposure**: The Supabase service-role key is never exposed in the Electron client or packaged installer.
