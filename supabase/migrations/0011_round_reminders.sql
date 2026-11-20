-- 0011_round_reminders.sql: the evening-before reminder (roadmap step 7).
-- rounds.reminder_sent_at is set when the 6 PM Central reminder for the round goes out, so the
-- scheduled job never sends it twice. Written only by the job, with the service role.

alter table public.rounds add column reminder_sent_at timestamptz;
