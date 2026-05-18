-- Migration: rls_hardening_safe
-- Version:   20260518163304
-- Applied:   2026-05-18
--
-- CONTEXT
-- -------
-- All five core tables (trades, profiles, perf_reports, account_syncs, api_keys)
-- had permissive policies with USING (true) applied to the 'public' role.
-- Because Supabase evaluates PERMISSIVE policies with OR logic, a single
-- USING (true) policy overrides any user-scoped policy on the same table,
-- effectively making every row readable by any authenticated (or even anon)
-- session that bypasses the API layer.
--
-- The backend already uses SUPABASE_SERVICE_ROLE_KEY on all API routes,
-- which bypasses RLS automatically. The permissive policies were therefore
-- redundant for the backend and dangerous for direct client access.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- 1. Drops all USING (true) permissive policies.
-- 2. Creates user-scoped (auth.uid() = user_id) policies for ALL operations
--    on trades, perf_reports, account_syncs, api_keys.
-- 3. For profiles:
--    - SELECT own profile (every authenticated user)
--    - SELECT all profiles (admin only, via is_admin() helper)
--    - INSERT / DELETE remain unguarded by RLS because they are performed
--      exclusively by API routes using service_role (RLS bypass), so no
--      client-facing policy is required.
--    - No UPDATE policy: no frontend code path updates profiles directly.
-- 4. Creates public.is_admin() as SECURITY DEFINER to avoid the recursive
--    RLS evaluation that would occur if the admin policy queried profiles
--    directly inside a profiles SELECT policy.
--
-- ROLLBACK
-- --------
-- See bottom of this file for the exact rollback SQL.

-- ============================================================
-- STEP 0 — Helper function (anti-recursion, SECURITY DEFINER)
-- ============================================================
-- SECURITY DEFINER causes this function to execute with the privileges
-- of its owner (postgres), bypassing RLS on profiles.
-- This prevents infinite recursion when the admin_select_all_profiles
-- policy calls is_admin(), which itself reads from profiles.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id   = auth.uid()
      AND role = 'admin'
  );
$$;

-- ============================================================
-- STEP 1 — Drop permissive (USING true) policies
-- ============================================================

DROP POLICY IF EXISTS "Service role trades"       ON public.trades;
DROP POLICY IF EXISTS "Service role full access"  ON public.profiles;
DROP POLICY IF EXISTS "perf_reports_policy"       ON public.perf_reports;
DROP POLICY IF EXISTS "account_syncs_policy"      ON public.account_syncs;
DROP POLICY IF EXISTS "api_keys_policy"           ON public.api_keys;

-- ============================================================
-- STEP 2 — trades
-- Frontend (useTrades.ts) performs UPDATE via anon/authenticated client.
-- All other operations go through API routes with service_role.
-- ============================================================

DROP POLICY IF EXISTS "Users see own trades" ON public.trades;
DROP POLICY IF EXISTS "users_own_trades"     ON public.trades;

CREATE POLICY "users_own_trades" ON public.trades
  FOR ALL
  TO authenticated
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- STEP 3 — profiles (conservative, per-operation)
-- INSERT → api/admin/create-user (service_role) — no policy needed
-- DELETE → api/admin/delete-user (service_role) — no policy needed
-- UPDATE → no frontend path found — no policy added
-- SELECT → two policies: own row + admin sees all
-- ============================================================

DROP POLICY IF EXISTS "Users can view own profile"  ON public.profiles;
DROP POLICY IF EXISTS "users_select_own_profile"    ON public.profiles;
DROP POLICY IF EXISTS "admin_select_all_profiles"   ON public.profiles;

-- Every authenticated user can read their own profile row
CREATE POLICY "users_select_own_profile" ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- Admin users can read all profile rows (required by AdminPanel.tsx SELECT *)
-- Uses is_admin() SECURITY DEFINER to prevent recursive RLS evaluation
CREATE POLICY "admin_select_all_profiles" ON public.profiles
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- ============================================================
-- STEP 4 — perf_reports
-- All access via API routes with service_role; policy added for safety.
-- ============================================================

DROP POLICY IF EXISTS "users_own_perf_reports" ON public.perf_reports;

CREATE POLICY "users_own_perf_reports" ON public.perf_reports
  FOR ALL
  TO authenticated
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- STEP 5 — account_syncs
-- Written by sync API routes with service_role.
-- ============================================================

DROP POLICY IF EXISTS "users_own_account_syncs" ON public.account_syncs;

CREATE POLICY "users_own_account_syncs" ON public.account_syncs
  FOR ALL
  TO authenticated
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- STEP 6 — api_keys
-- Read/written by API routes with service_role.
-- ============================================================

DROP POLICY IF EXISTS "users_own_api_keys" ON public.api_keys;

CREATE POLICY "users_own_api_keys" ON public.api_keys
  FOR ALL
  TO authenticated
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- ROLLBACK (run manually if needed — do NOT run on forward migration)
-- ============================================================
--
-- DROP POLICY IF EXISTS "users_own_trades"          ON public.trades;
-- DROP POLICY IF EXISTS "users_select_own_profile"  ON public.profiles;
-- DROP POLICY IF EXISTS "admin_select_all_profiles" ON public.profiles;
-- DROP POLICY IF EXISTS "users_own_perf_reports"    ON public.perf_reports;
-- DROP POLICY IF EXISTS "users_own_account_syncs"   ON public.account_syncs;
-- DROP POLICY IF EXISTS "users_own_api_keys"        ON public.api_keys;
-- DROP FUNCTION IF EXISTS public.is_admin();
--
-- CREATE POLICY "Service role trades"        ON public.trades        FOR ALL    TO public USING (true);
-- CREATE POLICY "Users see own trades"       ON public.trades        FOR ALL    TO public USING (auth.uid() = user_id);
-- CREATE POLICY "Service role full access"   ON public.profiles      FOR ALL    TO public USING (true);
-- CREATE POLICY "Users can view own profile" ON public.profiles      FOR SELECT TO public USING (auth.uid() = id);
-- CREATE POLICY "perf_reports_policy"        ON public.perf_reports  FOR ALL    TO public USING (true);
-- CREATE POLICY "account_syncs_policy"       ON public.account_syncs FOR ALL    TO public USING (true);
-- CREATE POLICY "api_keys_policy"            ON public.api_keys      FOR ALL    TO public USING (true);
