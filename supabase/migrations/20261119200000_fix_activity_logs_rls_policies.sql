-- Migration: Fix Row-Level Security Policies for activity_logs table
-- Enables UPDATE and DELETE policies on activity_logs for employees and administrators
-- Resolves Postgres error 42501 ("new row violates row-level security policy (USING expression) for table activity_logs") during upsert operations.

-- 1. Ensure RLS is enabled on activity_logs
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- 2. Ensure SELECT policies are in place
DROP POLICY IF EXISTS "Employees can view own activity logs" ON public.activity_logs;
CREATE POLICY "Employees can view own activity logs"
    ON public.activity_logs FOR SELECT
    TO authenticated
    USING (auth.uid() = employee_id);

DROP POLICY IF EXISTS "Admin and HR can view all activity logs" ON public.activity_logs;
DROP POLICY IF EXISTS "Admin can view all activity logs" ON public.activity_logs;
CREATE POLICY "Admin can view all activity logs"
    ON public.activity_logs FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE profiles.id = auth.uid() 
            AND (profiles.role = 'Admin' OR profiles.role = 'Super Admin')
        )
    );

-- 3. Ensure INSERT policy is in place
DROP POLICY IF EXISTS "Employees can insert own activity logs" ON public.activity_logs;
CREATE POLICY "Employees can insert own activity logs"
    ON public.activity_logs FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = employee_id);

-- 4. Enable UPDATE policies (Previously missing, causing upsert 42501 failures on existing rows)
DROP POLICY IF EXISTS "Employees can update own activity logs" ON public.activity_logs;
CREATE POLICY "Employees can update own activity logs"
    ON public.activity_logs FOR UPDATE
    TO authenticated
    USING (auth.uid() = employee_id)
    WITH CHECK (auth.uid() = employee_id);

DROP POLICY IF EXISTS "Admin and HR can update all activity logs" ON public.activity_logs;
DROP POLICY IF EXISTS "Admin can update all activity logs" ON public.activity_logs;
CREATE POLICY "Admin can update all activity logs"
    ON public.activity_logs FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE profiles.id = auth.uid() 
            AND (profiles.role = 'Admin' OR profiles.role = 'Super Admin')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE profiles.id = auth.uid() 
            AND (profiles.role = 'Admin' OR profiles.role = 'Super Admin')
        )
    );

-- 5. Enable DELETE policy for administrators
DROP POLICY IF EXISTS "Admin can delete activity logs" ON public.activity_logs;
CREATE POLICY "Admin can delete activity logs"
    ON public.activity_logs FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE profiles.id = auth.uid() 
            AND (profiles.role = 'Admin' OR profiles.role = 'Super Admin')
        )
    );
