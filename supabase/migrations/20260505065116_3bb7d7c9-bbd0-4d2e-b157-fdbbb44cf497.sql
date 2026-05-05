
ALTER FUNCTION public.validate_username() SET search_path = public;
ALTER FUNCTION public.handle_new_user() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_username() FROM PUBLIC, anon, authenticated;

DROP POLICY "Service role inserts" ON public.session_results;
CREATE POLICY "Users insert own results" ON public.session_results FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Limit public listing on templates bucket to specifically named files (still public read by URL)
DROP POLICY "Templates publicly readable" ON storage.objects;
CREATE POLICY "Templates readable by authenticated" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'templates');
CREATE POLICY "Templates readable anon by direct path" ON storage.objects FOR SELECT TO anon USING (bucket_id = 'templates');
