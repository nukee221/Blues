-- 0012_reminder_settings.sql: commissioners choose how each event's evening-before reminder goes out.
--   reminder_mode 'auto'   : sent the evening before each round at reminder_time (Central).
--                 'manual' : only when a commissioner taps "Send reminder now".
-- The scheduler runs every 15 minutes (see RUNBOOK), so times are in 15-minute steps.

alter table public.events
  add column reminder_mode text not null default 'auto' check (reminder_mode in ('auto', 'manual')),
  add column reminder_time time not null default '18:00'
    check (extract(minute from reminder_time)::int % 15 = 0 and extract(second from reminder_time) = 0);
