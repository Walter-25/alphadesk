
-- ─── TABELLE AGGIUNTIVE FASE 6 ────────────────────────────────────────────────

-- Performance reports aggregati (da CSV)
CREATE TABLE IF NOT EXISTS public.perf_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  account TEXT NOT NULL,
  source TEXT DEFAULT 'csv',
  stats JSONB NOT NULL,
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, account)
);
ALTER TABLE public.perf_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "perf_reports_policy" ON public.perf_reports;
CREATE POLICY "perf_reports_policy" ON public.perf_reports FOR ALL USING (true);

-- Sync status per conto
CREATE TABLE IF NOT EXISTS public.account_syncs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  account TEXT NOT NULL,
  broker TEXT DEFAULT 'csv',
  source TEXT DEFAULT 'csv',
  last_sync TIMESTAMPTZ DEFAULT NOW(),
  trade_count INTEGER DEFAULT 0,
  config JSONB,
  UNIQUE(user_id, account)
);
ALTER TABLE public.account_syncs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "account_syncs_policy" ON public.account_syncs;
CREATE POLICY "account_syncs_policy" ON public.account_syncs FOR ALL USING (true);

-- Aggiorna tabella trades con colonne mancanti
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'csv';
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS emotion_tags TEXT[] DEFAULT '{}';
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS rule_followed BOOLEAN;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS setup_quality INTEGER;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS strategy TEXT DEFAULT 'Manual';

-- ─── API KEYS per CoreTraderExporter ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_keys (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  key TEXT UNIQUE NOT NULL,
  label TEXT DEFAULT 'NinjaTrader',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "api_keys_policy" ON public.api_keys;
CREATE POLICY "api_keys_policy" ON public.api_keys FOR ALL USING (true);

-- Campo extra per dati aggiuntivi CoreTrader (MAE ticks, MFE ticks, efficiency, ecc.)
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS extra JSONB;

-- Aggiunge colonna per chiave CoreTraders (per il forwarding automatico)
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS coretraders_key TEXT;
