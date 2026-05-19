-- Migration: commission_settings
-- Version:   20260519120000
-- Applied:   2026-05-19
--
-- CONTEXT
-- -------
-- Manual commission fallback for brokers that send commission = 0
-- (e.g. LucidProp, some Tradovate prop accounts).
-- When ingest receives commission = 0 for a trade, it looks up
-- commission_settings for that user+instrument and applies:
--   effective_commission = rate_per_contract * quantity
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- 1. Creates public.commission_settings table.
-- 2. Creates index on user_id for fast per-user lookups on every ingest call.
-- 3. Enables RLS with strict user-scoped policy (no USING true).
--    API routes use SUPABASE_SERVICE_ROLE_KEY which bypasses RLS.
--    The policy protects direct browser/anon access.
--
-- ROLLBACK
-- --------
-- DROP TABLE IF EXISTS public.commission_settings;

CREATE TABLE IF NOT EXISTS public.commission_settings (
  id          UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  instrument  TEXT          NOT NULL,
  commission  NUMERIC(10,4) NOT NULL,
  updated_at  TIMESTAMPTZ   DEFAULT NOW(),
  UNIQUE (user_id, instrument)
);

CREATE INDEX IF NOT EXISTS commission_settings_user_id_idx
  ON public.commission_settings (user_id);

ALTER TABLE public.commission_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_own_commission_settings" ON public.commission_settings;

CREATE POLICY "users_own_commission_settings"
  ON public.commission_settings
  FOR ALL
  TO authenticated
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);