begin;
-- arena_admin_question must not be STABLE: PostgREST then runs it read-only, but the admin check writes.
alter function public.arena_admin_question(uuid) volatile;
notify pgrst, 'reload schema';
commit;
