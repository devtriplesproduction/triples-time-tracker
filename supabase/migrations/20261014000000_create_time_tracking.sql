-- Migration: Create Time Tracking Tables for TripleS Time Tracker (Idempotent & Safe)

-- 1. Tracking Sessions table
CREATE TABLE IF NOT EXISTS public.time_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    session_date DATE NOT NULL,
    clock_in TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    clock_out TIMESTAMPTZ,
    status VARCHAR(50) NOT NULL DEFAULT 'working' CHECK (status IN ('working', 'on_break', 'completed', 'Working', 'On Break', 'Completed')),
    worked_minutes INTEGER NOT NULL DEFAULT 0,
    active_minutes INTEGER NOT NULL DEFAULT 0,
    suspended_seconds INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure suspended_seconds exists if table was already created
ALTER TABLE public.time_sessions ADD COLUMN IF NOT EXISTS suspended_seconds INTEGER NOT NULL DEFAULT 0;

-- Indexes for time_sessions
CREATE INDEX IF NOT EXISTS idx_time_sessions_employee_date ON public.time_sessions (employee_id, session_date);
CREATE INDEX IF NOT EXISTS idx_time_sessions_status ON public.time_sessions (status);

-- 2. Session Breaks table
CREATE TABLE IF NOT EXISTS public.session_breaks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.time_sessions(id) ON DELETE CASCADE,
    start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    end_time TIMESTAMPTZ,
    duration_minutes INTEGER DEFAULT 0,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_breaks_session ON public.session_breaks (session_id);

-- 3. Activity Logs / Intervals table
CREATE TABLE IF NOT EXISTS public.activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.time_sessions(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    active_seconds INTEGER NOT NULL DEFAULT 0,
    app_name TEXT,
    window_title TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_session ON public.activity_logs (session_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_employee_time ON public.activity_logs (employee_id, start_time);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.time_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_breaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for time_sessions
DROP POLICY IF EXISTS "Employees can view own sessions" ON public.time_sessions;
CREATE POLICY "Employees can view own sessions"
    ON public.time_sessions FOR SELECT
    USING (auth.uid() = employee_id);

DROP POLICY IF EXISTS "Employees can insert own sessions" ON public.time_sessions;
CREATE POLICY "Employees can insert own sessions"
    ON public.time_sessions FOR INSERT
    WITH CHECK (auth.uid() = employee_id);

DROP POLICY IF EXISTS "Employees can update own sessions" ON public.time_sessions;
CREATE POLICY "Employees can update own sessions"
    ON public.time_sessions FOR UPDATE
    USING (auth.uid() = employee_id);

DROP POLICY IF EXISTS "Admin and HR can view all sessions" ON public.time_sessions;
DROP POLICY IF EXISTS "Admin can view all sessions" ON public.time_sessions;
CREATE POLICY "Admin can view all sessions"
    ON public.time_sessions FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE profiles.id = auth.uid() 
            AND (profiles.role = 'Admin' OR profiles.role = 'Super Admin')
        )
    );

-- 6. RLS Policies for session_breaks
DROP POLICY IF EXISTS "Employees can view own session breaks" ON public.session_breaks;
CREATE POLICY "Employees can view own session breaks"
    ON public.session_breaks FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.time_sessions
            WHERE time_sessions.id = session_breaks.session_id
            AND time_sessions.employee_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Employees can insert own session breaks" ON public.session_breaks;
CREATE POLICY "Employees can insert own session breaks"
    ON public.session_breaks FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.time_sessions
            WHERE time_sessions.id = session_breaks.session_id
            AND time_sessions.employee_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Employees can update own session breaks" ON public.session_breaks;
CREATE POLICY "Employees can update own session breaks"
    ON public.session_breaks FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.time_sessions
            WHERE time_sessions.id = session_breaks.session_id
            AND time_sessions.employee_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Admin and HR can view all session breaks" ON public.session_breaks;
DROP POLICY IF EXISTS "Admin can view all session breaks" ON public.session_breaks;
CREATE POLICY "Admin can view all session breaks"
    ON public.session_breaks FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE profiles.id = auth.uid() 
            AND (profiles.role = 'Admin' OR profiles.role = 'Super Admin')
        )
    );

-- 7. RLS Policies for activity_logs
DROP POLICY IF EXISTS "Employees can view own activity logs" ON public.activity_logs;
CREATE POLICY "Employees can view own activity logs"
    ON public.activity_logs FOR SELECT
    USING (auth.uid() = employee_id);

DROP POLICY IF EXISTS "Employees can insert own activity logs" ON public.activity_logs;
CREATE POLICY "Employees can insert own activity logs"
    ON public.activity_logs FOR INSERT
    WITH CHECK (auth.uid() = employee_id);

DROP POLICY IF EXISTS "Admin and HR can view all activity logs" ON public.activity_logs;
DROP POLICY IF EXISTS "Admin can view all activity logs" ON public.activity_logs;
CREATE POLICY "Admin can view all activity logs"
    ON public.activity_logs FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE profiles.id = auth.uid() 
            AND (profiles.role = 'Admin' OR profiles.role = 'Super Admin')
        )
    );

