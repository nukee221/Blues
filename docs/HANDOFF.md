# Handoff for a new work session

Read `docs/ROADMAP.md` first: it has the plan, the working style, and the next unticked step.

## The person you're working with
One of the tour's three commissioners. Not a programmer: explain in plain language, keep
replies short, and ask before anything that changes scope. They work about 15 minutes a day
and want token use kept low — do ONE roadmap step per session, no subagents unless asked,
no per-step reviewer (one review per batch).

## Each session
1. Read `docs/ROADMAP.md`; take the next unticked step in the current batch.
2. Build it test-first where it has logic; run only the tests for what you changed, plus
   typecheck. Run the full suites at batch review, not every day.
3. Commit, push to `claude/golf-league-app-jftcbi`, tick the step in `docs/ROADMAP.md`,
   and tell the commissioner in a few lines what changed and what is next.
4. If a step turns out bigger than one short session, split it in the roadmap and stop at a
   working point.

## The code
- pnpm monorepo. `packages/scoring`: pure TypeScript golf rules (no React/Next/Supabase).
  `apps/web`: Next.js 15 (App Router) + Tailwind + Supabase. Migrations in `supabase/migrations`
  (0001–0013; add new numbered files, never edit old ones). Profile photos live in the
  `player_photos` table (small JPEGs, no client access), served by `/photo/<id>` to signed-in players.
- Design: `docs/superpowers/specs/2026-11-15-huntsville-golf-tour-design.md`.
  Deploy guide: `docs/RUNBOOK.md`. Open small items: `docs/KNOWN-ISSUES.md`.
- Brand artwork: `apps/web/public/brand/` (see Brand in the roadmap). Season posters (the
  look to follow): `docs/brand/`.

## Where Batch 1 left off (2026-11-20, steps 1–14 done; step 15 deploy is next, planned for January)
- **Look:** poster style (Anton headlines `.display`, Oswald labels `.eyebrow`, gold
  `.text-gold-grad`, `.ribbon`, `.row-card`, `.card-dark`, `.btn-red`, `.btn-gold`; all in
  `src/app/globals.css`). Restyled pages are listed in `src/lib/darkPages.ts`; everything else
  (admin pages) still sits on a light card. Leaderboard and bracket were restyled in 13a and the
  scorecard (`/c`, `/c/[code]`) in 13b: tap targets kept at 56 px; when scoring, each name sits above
  its − score + row so long names fit. When you
  restyle a page, add it there.
- **Reusable pieces:** `Avatar` (photo or initials), `LogoTile` (event logo framed gold/red),
  `EventRowCard`, `Icon`; `src/lib/eventCards.ts` (rows, logos by name, ribbon text, courses
  in round order); `src/lib/champions.ts` (2026 champions typed in from the poster;
  `defendingChampion`); `src/lib/reminders.ts` (scheduled + Send now, rounds and matches).
- **Event setup checklist (step 9):** `src/lib/eventSetup.ts` (steps, done/current/to do; match play adds
  "Close the play-in and draw the bracket"), shown by `SetupSteps` at the top of the admin event page.
  Step 10: `NextStepBox` above it — the next step as a button; while the event is in progress, live counts
  for the round being played (`src/lib/eventDay.ts`, service-role read of groups; `LiveRefresh` every 30 s).
- **Pairings (step 11):** `pairGroups` in `src/lib/groups.ts` (handicap / balanced / random, even group sizes);
  "Make groups" box in `TeeSheetEditor` (replaced the old Auto-group button; opener e2e updated).
- **Start times (step 12):** `src/lib/startTimes.ts`; "Start times" box in `TeeSheetEditor` (tee times or shotgun);
  Make groups and Add group follow it; the opener e2e sets 08:00 there.
- **Pairing rules (11b):** `pairing_rules` table (0013; service role only, one rule per pair, smaller id
  first), `src/actions/pairingRules.ts`, `PairingRules` box on the round groups page; `applyPairingRules`
  in `src/lib/groups.ts` swaps players (similar handicaps first) after pairing and reports unmet rules.
- **Champions / standings (11c):** `pairGroups(..., { first })` puts past champions (names in
  `src/lib/champions.ts` matched to player names) in the first group(s). Rounds after the first:
  `standingsBefore` (`src/lib/roundStandings.ts`) totals earlier rounds; `standingsTeeOrder` +
  `standingsGroups` put leaders last (full last group), ties first in, last out by previous card signed time.
- **Reminders:** `events.reminder_mode`/`reminder_time`; `/api/cron/reminders` (CRON_SECRET)
  is called every 15 min by Supabase pg_cron once deployed (RUNBOOK part 3). Admin event page
  has the Reminders box.
- **Commissioner preferences learned:** likes the poster look; wants things lined up and
  tidy; logos small and framed, not big white blocks; multi-day events may use 2–3 courses;
  "Who's next?" ribbon once all dates are set; prefers choice (auto vs manual) for anything
  automatic. Always send phone-sized screenshots of what changed.

## Screenshots for the commissioner (how it was done)
- Start the local database (Commands below), write a throwaway spec in `apps/web/e2e/zz-*.spec.ts`
  that inserts demo data with `adminClient()` and signs in with `phoneAs(browser, baseURL,
  'player03@example.test')`, take `page.screenshot({ fullPage: true })` after adding the style
  `nav[aria-label="Primary"] { position: static !important; }` (so the tab bar does not cover
  content), run `E2E_RESET=1 pnpm e2e zz-name`, then delete the spec. Save pictures in the
  session scratchpad and send them with SendUserFile.
- Emails: render with a throwaway vitest file that writes the HTML, open it in Chromium.
- If docker says it cannot connect: `pkill dockerd; pkill containerd; rm -f /var/run/docker.pid
  /var/run/docker.sock; dockerd >/tmp/dockerd.log 2>&1 &` and wait for `docker ps`.
- Stop the database when done: `npx -y supabase@2 stop`.

## Conventions that must hold
- Server actions return `ActionResult` with stable codes (`src/lib/actionResult.ts`,
  `actionCodes.ts`); user-facing errors are returned, never thrown.
- `requireUser` / `requireCommissioner` run first and outside `toResult`; privileged writes use
  the service-role admin client only after that check; commissioner decisions write `audit_log`.
- Never `select *` on `groups` or `players` with a user client (column-restricted).
- All times shown or entered are America/Chicago (`src/lib/time.ts`).
- Handicaps: index-based by default (`formatHandicap` for display, plus handicaps show as "+1").
- Mobile-first, 44px tap targets. `/c/*` scorecard pages render without the account tab bar.
- Secrets: never write a key into a file, test, log, or command. `GOLFCOURSE_API_KEY` is read
  server-side only; in this workspace the network proxy injects the real key for
  api.golfcourseapi.com (use the placeholder `proxy-injected`). Free plan: about 35 calls a day.

## Commands
- Unit tests: `pnpm test` (or `pnpm -F web test <file>` / `pnpm -F @hgt/scoring test`).
- Typecheck: `pnpm -r typecheck`. Build: `pnpm -F web build`.
- Local database (needed for integration, pgTAP and e2e only):
  `rm -f /var/run/docker.pid; dockerd >/tmp/dockerd.log 2>&1 &` then wait ~15 s, then
  `export SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io` and
  `npx -y supabase@2 start -x studio,imgproxy,edge-runtime,logflare,vector,supabase-pooler,storage-api,postgres-meta`
  (retry once if the database is not ready).
- Integration: `pnpm -F web test:int`. Database tests: `npx -y supabase@2 test db`.
  Rehearsal in a phone-sized browser: `E2E_RESET=1 pnpm e2e` (Chromium is pre-installed;
  never run `playwright install`).
- Some form tests are slow under load and can fail once; rerun before treating it as a bug.

## Waiting on the commissioners
- More event logos (only Masters, Huntsville Open, Hackers Cup are cut from the poster; others
  use the flag). Past champions beyond 2026 go in `src/lib/champions.ts`.
- At deploy: `CRON_SECRET` in Vercel and the pg_cron setup in Supabase (RUNBOOK).
- Deploying for the trial (roadmap step 15, planned for January).
- Checking the seeded FedExCup points table against the PGA Tour's published one.
- Regenerating the GolfCourseAPI key (it appeared in a screenshot) and putting the new one in
  the hosting settings at deploy time.
- Feedback from the other two commissioners, if any.
