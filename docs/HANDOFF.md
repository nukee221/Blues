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
  (0001–0009; add new numbered files, never edit old ones).
- Design: `docs/superpowers/specs/2026-11-15-huntsville-golf-tour-design.md`.
  Deploy guide: `docs/RUNBOOK.md`. Open small items: `docs/KNOWN-ISSUES.md`.
- Brand artwork: `apps/web/public/brand/` (see Brand in the roadmap).

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
- Deploying for the trial (roadmap step 15, planned for January).
- Checking the seeded FedExCup points table against the PGA Tour's published one.
- Regenerating the GolfCourseAPI key (it appeared in a screenshot) and putting the new one in
  the hosting settings at deploy time.
- Feedback from the other two commissioners, if any.
