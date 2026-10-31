-- Migration: Create Session Screenshots Table and Storage Policies for TripleS Time Tracker
-- Automatically captures a full-screen screenshot every 7 minutes during active sessions.

-- 1. Create table public.session_screenshots
CREATE TABLE IF NOT EXISTS public.session_screenshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.time_sessions(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    session_date DATE NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    storage_path TEXT,
    image_url TEXT,
    image_data TEXT, -- Fallback base64 data URL if Supabase Storage bucket is unavailable
    file_size_bytes INTEGER NOT NULL DEFAULT 0,
    app_name TEXT,
    window_title TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Indexes for high-performance monthly and daily admin queries
CREATE INDEX IF NOT EXISTS idx_session_screenshots_emp_date ON public.session_screenshots (employee_id, session_date);
CREATE INDEX IF NOT EXISTS idx_session_screenshots_session ON public.session_screenshots (session_id);
CREATE INDEX IF NOT EXISTS idx_session_screenshots_captured_at ON public.session_screenshots (captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_screenshots_date ON public.session_screenshots (session_date DESC);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.session_screenshots ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies
-- Employees can view their own screenshots
DROP POLICY IF EXISTS "Employees can view own screenshots" ON public.session_screenshots;
CREATE POLICY "Employees can view own screenshots"
    ON public.session_screenshots FOR SELECT
    USING (auth.uid() = employee_id);

-- Employees can insert their own screenshots
DROP POLICY IF EXISTS "Employees can insert own screenshots" ON public.session_screenshots;
CREATE POLICY "Employees can insert own screenshots"
    ON public.session_screenshots FOR INSERT
    WITH CHECK (auth.uid() = employee_id);

-- Admins and HR can view all screenshots of every user for months
DROP POLICY IF EXISTS "Admin and HR can view all screenshots" ON public.session_screenshots;
CREATE POLICY "Admin and HR can view all screenshots"
    ON public.session_screenshots FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE profiles.id = auth.uid() 
            AND (profiles.role = 'Admin' OR profiles.role = 'Super Admin' OR profiles.role = 'HR')
        )
    );

-- Admins can delete screenshots if needed
DROP POLICY IF EXISTS "Admin can delete screenshots" ON public.session_screenshots;
CREATE POLICY "Admin can delete screenshots"
    ON public.session_screenshots FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE profiles.id = auth.uid() 
            AND (profiles.role = 'Admin' OR profiles.role = 'Super Admin')
        )
    );

-- 5. Set up Supabase Storage Bucket 'screenshots'
INSERT INTO storage.buckets (id, name, public)
VALUES ('screenshots', 'screenshots', true)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS Policies
DROP POLICY IF EXISTS "Authenticated users can upload screenshots" ON storage.objects;
CREATE POLICY "Authenticated users can upload screenshots"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'screenshots');

DROP POLICY IF EXISTS "Anyone authenticated can view screenshots" ON storage.objects;
CREATE POLICY "Anyone authenticated can view screenshots"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (bucket_id = 'screenshots');

