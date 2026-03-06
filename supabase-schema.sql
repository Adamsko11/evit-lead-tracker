-- =====================================================
-- EVIT Lead Tracker — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- =====================================================

CREATE TABLE leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  personal_linkedin TEXT,
  company_name TEXT,
  company_linkedin TEXT,
  job_title TEXT,
  headcount INTEGER,
  location TEXT,
  status TEXT DEFAULT 'New' CHECK (status IN ('New', 'In Progress', 'Done')),
  notes TEXT,
  added_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Allow all operations via anon key (internal tool)
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON leads FOR ALL USING (true) WITH CHECK (true);

-- Enable realtime so both users see live updates
ALTER PUBLICATION supabase_realtime ADD TABLE leads;
