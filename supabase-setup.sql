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
