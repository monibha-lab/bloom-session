ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public';

ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_visibility_check;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_visibility_check CHECK (visibility IN ('public','secret'));