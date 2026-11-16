-- 0006_realtime_scores.sql — publish score changes over Supabase realtime so the live
-- leaderboard can refresh as scores arrive. RLS still applies to what each subscriber
-- receives (scores_select: non-draft events only). Idempotent.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'scores'
  ) then
    alter publication supabase_realtime add table public.scores;
  end if;
end $$;
