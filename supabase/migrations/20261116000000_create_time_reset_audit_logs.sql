-- Migration: Create Time Reset Audit Logs Table and Security Policies
-- Records all session reset events with pre-reset snapshots, reasons, and responsible user.
-- Guarantees historical records are never corrupted and provides complete accountability.

-- 1. Create table public.time_reset_audit_logs
CREATE TABLE IF NOT EXISTS public.time_reset_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL,
    employee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    employee_email TEXT NOT NULL,
    employee_name TEXT,
    reset_type VARCHAR(50) NOT NULL CHECK (reset_type IN ('automatic_daily_reset', 'restart_session', 'discard_session')),
    previous_clock_in TIMESTAMPTZ NOT NULL,
    previous_worked_minutes INTEGER NOT NULL DEFAULT 0,
    previous_worked_seconds INTEGER NOT NULL DEFAULT 0,
    previous_active_minutes INTEGER NOT NULL DEFAULT 0,
    previous_active_seconds INTEGER NOT NULL DEFAULT 0,
    previous_status VARCHAR(50) NOT NULL,
    reason TEXT NOT NULL,
    notes TEXT,
    reset_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    reset_by_role VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Indexes for fast inspection and audits
CREATE INDEX IF NOT EXISTS idx_time_reset_audit_employee ON public.time_reset_audit_logs (employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_time_reset_audit_session ON public.time_reset_audit_logs (session_id);
CREATE INDEX IF NOT EXISTS idx_time_reset_audit_created ON public.time_reset_audit_logs (created_at DESC);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.time_reset_audit_logs ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies
-- Employees can view their own reset audit records
DROP POLICY IF EXISTS "Employees can view own reset audit logs" ON public.time_reset_audit_logs;
CREATE POLICY "Employees can view own reset audit logs"
    ON public.time_reset_audit_logs FOR SELECT
    USING (auth.uid() = employee_id);

-- Employees can insert their own reset audit records
DROP POLICY IF EXISTS "Employees can insert own reset audit logs" ON public.time_reset_audit_logs;
CREATE POLICY "Employees can insert own reset audit logs"
    ON public.time_reset_audit_logs FOR INSERT
    WITH CHECK (auth.uid() = employee_id);

-- Admins and HR can view all reset audit logs across all employees
DROP POLICY IF EXISTS "Admin and HR can view all reset audit logs" ON public.time_reset_audit_logs;
CREATE POLICY "Admin and HR can view all reset audit logs"
    ON public.time_reset_audit_logs FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE profiles.id = auth.uid() 
            AND (profiles.role = 'Admin' OR profiles.role = 'Super Admin' OR profiles.role = 'HR')
        )
    );
