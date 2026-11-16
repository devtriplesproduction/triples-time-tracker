# Automatic Daily Time Reset & Audit Logging Specification

## 1. Overview & Purpose
In accordance with enterprise workplace tracking, ERP synchronization, and automated labor accountability standards, the **TripleS Time Tracker** implements an **Automatic Daily Time Reset** architecture at **12:00 AM midnight** in each employee's configured timezone (default `'Asia/Kolkata'`).

This system replaces manual session restart/discard controls with a fully automated, continuous rollover process:
1. **Zero Employee Action Required**: Eliminates manual button presses, confirmation modals, or human error.
2. **Daily Metrics Reset**: Daily **Worked Hours** and **Active Hours** automatically reset to `00:00:00` at 12:00:00 AM local time.
3. **Immutable Daily Audit Trail**: Immediately captures previous-day totals (worked hours, active hours, session metadata) into immutable local storage (`tracker-store.json`) and Supabase (`public.time_reset_audit_logs`).
4. **Seamless Midnight Continuation (Zero Time Loss & Zero Double-Counting)**: If an employee works or takes a break across midnight, the session is cleanly finalized at the midnight boundary (`dayEndMs`), and an uninterrupted continuation session is spawned at 00:00:00 (`dayEndMs`).
5. **Duplicate Reset Prevention**: Employs `lastRolloverDate` tracking to guarantee rollover and audit logging run strictly once per calendar date transition.
6. **Offline Synchronization**: All rollover audits and finalized sessions are safely enqueued to `pendingSyncQueue` (`reset_audit` and `session` types) for reliable synchronization once connectivity is restored.
7. **Complete Historical Preservation**: All prior days' completed sessions remain strictly immutable and unaltered.
8. **Unchanged Tracking Parameters**: Retains the verified 60-second inactivity threshold and idle detection without alteration.

---

## 2. Midnight Rollover & Session Splitting Architecture

### Boundary Mathematical Model
* In the employee's configured timezone (e.g. `'Asia/Kolkata'`):
  * **Day 1 Ends**: `dayEndMs = new Date('YYYY-MM-DDT00:00:00+05:30').getTime()` of the next day.
  * **Day 1 Session Finalized**: `clock_out = new Date(dayEndMs).toISOString()`, `status = 'completed'`.
  * **Day 2 Continuation Session**: `clock_in = new Date(dayEndMs).toISOString()`, `status = 'working'` (or `'on_break'`), `worked_minutes = 0`.
* **Zero Double-Counting**: `calculateSessionWorkedMsForDate` strictly clips intervals:
  $$\text{effectiveStart} = \max(\text{clockInMs}, \text{dayStartMs}), \quad \text{effectiveEnd} = \min(\text{clockOutMs}, \text{dayEndMs})$$
  Because $\text{dayEndMs}_{\text{Day 1}} = \text{dayStartMs}_{\text{Day 2}}$, Day 1 receives $[clockInMs, dayEndMs]$ and Day 2 receives $[dayStartMs, nowMs]$. Overlap duration is mathematically 0 ms.

### Break Splitting
* If an employee is on a break at 23:45:00:
  * The Day 1 break is cleanly finalized at midnight with `end_time = dayEndMs` and `duration_minutes = 15`.
  * The continuation session on Day 2 initializes with `status = 'on_break'` and an open break starting at `dayEndMs` (00:00:00).

---

## 3. Audit Table Schema

### Database Table: `public.time_reset_audit_logs`
Migration: `supabase/migrations/20261116000000_create_time_reset_audit_logs.sql`

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | Unique audit record UUID |
| `session_id` | `UUID` | `NOT NULL` | Session ID finalized or reset |
| `employee_id` | `UUID` | `NOT NULL REFERENCES public.profiles(id)` | Employee who owns the session |
| `employee_email` | `TEXT` | `NOT NULL` | Verified employee email |
| `employee_name` | `TEXT` | `NULLABLE` | Full name of the employee |
| `reset_type` | `VARCHAR(50)` | `CHECK (reset_type IN ('automatic_daily_reset', 'restart_session', 'discard_session'))` | Event classification |
| `previous_clock_in` | `TIMESTAMPTZ` | `NOT NULL` | Original clock-in timestamp |
| `previous_worked_minutes` | `INTEGER` | `NOT NULL DEFAULT 0` | Worked minutes accumulated in prior period |
| `previous_worked_seconds` | `INTEGER` | `NOT NULL DEFAULT 0` | Exact worked seconds accumulated in prior period |
| `previous_active_minutes` | `INTEGER` | `NOT NULL DEFAULT 0` | Active minutes accumulated in prior period |
| `previous_active_seconds` | `INTEGER` | `NOT NULL DEFAULT 0` | Exact active seconds accumulated in prior period |
| `previous_status` | `VARCHAR(50)` | `NOT NULL` | Tracking status before reset (`working`, `on_break`, `completed`) |
| `reason` | `TEXT` | `NOT NULL` | Explanatory reason (e.g., `"Automatic midnight reset at 12:00 AM (Asia/Kolkata)"`) |
| `notes` | `TEXT` | `NULLABLE` | Granular metrics and rollover summary |
| `reset_by` | `UUID` | `NOT NULL REFERENCES public.profiles(id)` | Actor ID (employee or system user) |
| `reset_by_role` | `VARCHAR(50)` | `NULLABLE` | Execution role (`'System'`, `'Admin'`, `'Employee'`) |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Immutable audit timestamp |

---

## 4. Sample Automatic Rollover Audit Record (JSON)

```json
{
  "id": "c8e10427-df2b-4786-9a25-c603b57351ad",
  "session_id": "312b9d4c-e87f-4ea9-a1b5-8dc76395b8d1",
  "employee_id": "3c7e09ef-4bf2-411a-8b15-99d0e2e5843a",
  "employee_email": "alice.roy@triplesproduction.com",
  "employee_name": "Alice Roy",
  "reset_type": "automatic_daily_reset",
  "previous_clock_in": "2026-11-16T20:00:00.000+05:30",
  "previous_worked_minutes": 240,
  "previous_worked_seconds": 14400,
  "previous_active_minutes": 225,
  "previous_active_seconds": 13500,
  "previous_status": "working",
  "reason": "Automatic midnight reset at 12:00 AM (Asia/Kolkata)",
  "notes": "Session seamlessly continued across midnight. Prior day (2026-11-16) finalized: 04:00:00 worked, 03:45:00 active.",
  "reset_by": "3c7e09ef-4bf2-411a-8b15-99d0e2e5843a",
  "reset_by_role": "System",
  "created_at": "2026-11-16T18:30:00.000Z"
}
```

---

## 5. Security & Access Control

* **Row-Level Security (RLS)**:
  * Employees can view only their own audit records (`auth.uid() = employee_id`).
  * Administrators and HR managers can review and export audit records across all employees.
* **Strict Immutability**:
  * No `UPDATE` or `DELETE` SQL policies are granted on `public.time_reset_audit_logs`.
  * Audit records cannot be purged, modified, or truncated.
* **Duplicate Prevention Guard**:
  * `store.lastRolloverDate === newDay` safeguards against multiple executions if multiple ticks occur around midnight or if the app restarts.

---

## 6. Implementation Code References

* **Database Migration**: [`supabase/migrations/20261116000000_create_time_reset_audit_logs.sql`](supabase/migrations/20261116000000_create_time_reset_audit_logs.sql)
* **Core Tracker Engine & Midnight Rollover**: [`electron/activity-tracker.ts`](electron/activity-tracker.ts) (`handleDayRollover`, `start`, `tick`)
* **Local Storage & Rollover State**: [`electron/storage.ts`](electron/storage.ts) (`getLastRolloverDate`, `setLastRolloverDate`, `addResetAuditLog`, `getResetAuditLogs`)
* **Time Calculator & Boundary Math**: [`src/utils/timeCalculator.ts`](src/utils/timeCalculator.ts) (`getDayBounds`, `calculateSessionWorkedMsForDate`, `calculateDailyWorkedSeconds`, `calculateDailyActiveSeconds`)
* **Supabase Synchronization**: [`electron/supabase-service.ts`](electron/supabase-service.ts) (`recordResetAudit`, `getResetAuditLogs`, `syncResetSession`)
* **Settings & Audit Trail UI**: [`src/components/SettingsModal.tsx`](src/components/SettingsModal.tsx)
* **Automated Unit & Integration Test Suite**: [`__tests__/reset-time-feature.test.ts`](__tests__/reset-time-feature.test.ts)
