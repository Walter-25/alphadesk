-- Migration: account_aliases
-- Version:   20260828000000
-- Applied:   2026-08-28
--
-- CONTEXT
-- -------
-- Fase 1 dell'alias conto (display-only). Il nome tecnico del conto resta
-- l'identita' immutabile usata ovunque per dedup/filtri/query: colonna
-- `account` sulla tabella trades e dentro il ninja_id (ingest, csvParsers,
-- atasJournalParser, bridge C#) — NIENTE di tutto questo viene toccato.
--
-- Questa tabella memorizza solo un'etichetta persistente scelta dall'utente
-- per un conto tecnico, applicata SOLO in visualizzazione lato frontend
-- (vedi app/lib/useAccountAliases.ts e /api/account-aliases). Cancellare la
-- riga fa tornare il conto a mostrare il nome tecnico.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- 1. Creates public.account_aliases (user_id, account tecnico, display_name).
-- 2. Unique (user_id, account): un solo alias per conto tecnico per utente.
-- 3. Enables RLS con policy user-scoped, stesso pattern di commission_settings.
--    Le API route usano SUPABASE_SERVICE_ROLE_KEY e bypassano RLS: la policy
--    protegge solo l'accesso diretto browser/anon.
--
-- ROLLBACK
-- --------
-- DROP TABLE IF EXISTS public.account_aliases;

CREATE TABLE IF NOT EXISTS public.account_aliases (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account      TEXT        NOT NULL,
  display_name TEXT        NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, account)
);

CREATE INDEX IF NOT EXISTS account_aliases_user_id_idx
  ON public.account_aliases (user_id);

ALTER TABLE public.account_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_own_account_aliases" ON public.account_aliases;

CREATE POLICY "users_own_account_aliases"
  ON public.account_aliases
  FOR ALL
  TO authenticated
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
