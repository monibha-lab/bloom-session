
-- Profiles
CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE,
  avatar_url TEXT,
  stars INTEGER NOT NULL DEFAULT 0,
  blue_flames INTEGER NOT NULL DEFAULT 0,
  sessions_completed INTEGER NOT NULL DEFAULT 0,
  total_seconds INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  last_session_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles viewable by everyone authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- Username validation
CREATE OR REPLACE FUNCTION public.validate_username() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.username IS NOT NULL THEN
    IF length(NEW.username) < 3 OR length(NEW.username) > 20 THEN
      RAISE EXCEPTION 'Username must be 3-20 characters';
    END IF;
    IF NEW.username ~ '\s' THEN
      RAISE EXCEPTION 'Username cannot contain spaces';
    END IF;
  END IF;
  RETURN NEW;
END;$$;
CREATE TRIGGER validate_username_trg BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.validate_username();

-- Auto create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.profiles (id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Sessions
CREATE TABLE public.sessions (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code TEXT UNIQUE,
  mode TEXT NOT NULL DEFAULT 'solo',  -- solo, group
  template_url TEXT,
  template_name TEXT,
  timer_type TEXT NOT NULL DEFAULT 'custom', -- custom, pomodoro
  duration_seconds INTEGER NOT NULL DEFAULT 1500,
  status TEXT NOT NULL DEFAULT 'lobby', -- lobby, active, completed, failed
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  code_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view sessions they belong to" ON public.sessions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Host can insert" ON public.sessions FOR INSERT TO authenticated WITH CHECK (auth.uid() = host_id);
CREATE POLICY "Host can update" ON public.sessions FOR UPDATE TO authenticated USING (auth.uid() = host_id);
CREATE POLICY "Host can delete" ON public.sessions FOR DELETE TO authenticated USING (auth.uid() = host_id);

-- Session members
CREATE TABLE public.session_members (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(session_id, user_id)
);
ALTER TABLE public.session_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members viewable by authenticated" ON public.session_members FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users insert own membership" ON public.session_members FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own membership" ON public.session_members FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Tasks
CREATE TABLE public.tasks (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tasks viewable by authenticated" ON public.tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users insert own tasks" ON public.tasks FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own tasks" ON public.tasks FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own tasks" ON public.tasks FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Session results
CREATE TABLE public.session_results (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stars_delta INTEGER NOT NULL DEFAULT 0,
  flames_delta INTEGER NOT NULL DEFAULT 0,
  succeeded BOOLEAN NOT NULL DEFAULT false,
  tasks_completed INTEGER NOT NULL DEFAULT 0,
  tasks_total INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.session_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Results viewable by owner" ON public.session_results FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Service role inserts" ON public.session_results FOR INSERT TO authenticated WITH CHECK (true);

-- Study logs
CREATE TABLE public.study_logs (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  succeeded BOOLEAN NOT NULL DEFAULT false,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.study_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Logs viewable by owner" ON public.study_logs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Logs insertable by owner" ON public.study_logs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.session_members;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
ALTER TABLE public.sessions REPLICA IDENTITY FULL;
ALTER TABLE public.session_members REPLICA IDENTITY FULL;
ALTER TABLE public.tasks REPLICA IDENTITY FULL;

-- Storage bucket for templates
INSERT INTO storage.buckets (id, name, public) VALUES ('templates', 'templates', true);
CREATE POLICY "Templates publicly readable" ON storage.objects FOR SELECT USING (bucket_id = 'templates');
CREATE POLICY "Authenticated can upload templates" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'templates' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users delete own templates" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'templates' AND auth.uid()::text = (storage.foldername(name))[1]);
