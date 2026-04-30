-- Esegui questo script nel SQL Editor di Supabase
-- Settings → SQL Editor → New query → incolla e clicca Run

-- 1. Tabella profili utenti
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'trader' CHECK (role IN ('admin', 'trader')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id)
);

-- 2. Abilita Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. Policy: ogni utente vede solo il proprio profilo (e admin vede tutti)
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Admin can view all profiles" ON public.profiles
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admin can insert profiles" ON public.profiles
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Admin can delete profiles" ON public.profiles
  FOR DELETE USING (true);

-- 4. Funzione per creare il profilo admin automaticamente al primo login
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Non fare nulla, i profili vengono creati dall'API admin
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── TABELLA TRADES (NinjaTrader) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trades (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  ninja_id TEXT,
  account TEXT NOT NULL,
  strategy TEXT NOT NULL DEFAULT 'Manual',
  instrument TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('Long', 'Short')),
  entry_time TIMESTAMPTZ,
  exit_time TIMESTAMPTZ,
  duration_min INTEGER DEFAULT 0,
  entry_price NUMERIC(12,4) DEFAULT 0,
  exit_price NUMERIC(12,4) DEFAULT 0,
  quantity INTEGER DEFAULT 1,
  pnl NUMERIC(12,2) DEFAULT 0,
  commission NUMERIC(12,2) DEFAULT 0,
  net_pnl NUMERIC(12,2) DEFAULT 0,
  mae NUMERIC(12,2),
  mfe NUMERIC(12,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(ninja_id, user_id)
);

ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own trades" ON public.trades
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Service role trades" ON public.trades
  FOR ALL USING (true);
