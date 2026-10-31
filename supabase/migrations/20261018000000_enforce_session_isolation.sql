-- Migration: Enforce Strict Cross-User Session Isolation and Immutable Ownership
-- Prevents duplicate active sessions, cross-account reassignment, and unauthorized session tampering.

-- 1. Enforce at most ONE active ('working' or 'on_break') session per employee at any time
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_session_per_employee 
ON public.time_sessions (employee_id) 
WHERE status IN ('working', 'on_break', 'Working', 'On Break');

-- 2. Trigger to ensure employee_id is strictly immutable once a session is created
CREATE OR REPLACE FUNCTION public.check_session_ownership_immutable()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.employee_id <> OLD.employee_id THEN
        RAISE EXCEPTION 'Security Violation: Cannot reassign session ownership from % to %', OLD.employee_id, NEW.employee_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_session_ownership_immutable ON public.time_sessions;
CREATE TRIGGER trg_session_ownership_immutable
    BEFORE UPDATE ON public.time_sessions
    FOR EACH ROW
    EXECUTE FUNCTION public.check_session_ownership_immutable();

-- 3. Trigger to ensure session_breaks cannot be detached or reassigned to a different session
CREATE OR REPLACE FUNCTION public.check_break_session_immutable()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.session_id <> OLD.session_id THEN
        RAISE EXCEPTION 'Security Violation: Cannot reassign break record to a different session.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_break_session_immutable ON public.session_breaks;
CREATE TRIGGER trg_break_session_immutable
    BEFORE UPDATE ON public.session_breaks
    FOR EACH ROW
    EXECUTE FUNCTION public.check_break_session_immutable();

-- 4. Trigger to ensure activity_logs cannot have employee_id or session_id reassigned
CREATE OR REPLACE FUNCTION public.check_activity_log_immutable()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.employee_id <> OLD.employee_id OR NEW.session_id <> OLD.session_id THEN
        RAISE EXCEPTION 'Security Violation: Cannot reassign activity log ownership or session.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_activity_log_immutable ON public.activity_logs;
CREATE TRIGGER trg_activity_log_immutable
    BEFORE UPDATE ON public.activity_logs
    FOR EACH ROW
    EXECUTE FUNCTION public.check_activity_log_immutable();

-- 5. Harden Row Level Security (RLS) Policies

-- time_sessions policies
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
    USING (auth.uid() = employee_id)
    WITH CHECK (auth.uid() = employee_id);

-- session_breaks policies
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
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.time_sessions
            WHERE time_sessions.id = session_breaks.session_id
            AND time_sessions.employee_id = auth.uid()
        )
    );

-- activity_logs policies
DROP POLICY IF EXISTS "Employees can view own activity logs" ON public.activity_logs;
CREATE POLICY "Employees can view own activity logs"
    ON public.activity_logs FOR SELECT
    USING (auth.uid() = employee_id);

DROP POLICY IF EXISTS "Employees can insert own activity logs" ON public.activity_logs;
CREATE POLICY "Employees can insert own activity logs"
    ON public.activity_logs FOR INSERT
    WITH CHECK (auth.uid() = employee_id);

DROP POLICY IF EXISTS "Employees can update own activity logs" ON public.activity_logs;
CREATE POLICY "Employees can update own activity logs"
    ON public.activity_logs FOR UPDATE
    USING (auth.uid() = employee_id)
    WITH CHECK (auth.uid() = employee_id);
