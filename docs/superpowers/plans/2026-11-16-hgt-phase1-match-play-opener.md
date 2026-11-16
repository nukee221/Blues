# HGT Phase 1 (February Match-Play Opener) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A mobile-first web app the Huntsville Golf Tour can run its February 2027 match-play opener on: courses, players and handicaps, draft/publish events, registration, emailed tee sheets with group codes, live scoring with two-person signing, a net stroke-play play-in, a random-draw single-elimination bracket with player-scheduled matches, FedExCup-style season points, and standings.

**Architecture:** pnpm monorepo. `packages/scoring` is a pure TypeScript library (no React, no Supabase) holding every golf rule — handicaps, leaderboards, match status, brackets, points — so the end-of-2027 phone app can reuse it. `apps/web` is a Next.js App Router app on Supabase (Postgres, magic-link auth, realtime, row-level security). Anonymous group-code access and PIN signing go through server actions using the service-role client; everything else uses the user's session and RLS.

**Tech Stack:** Node 22, pnpm 10, TypeScript 5 (strict), Vitest, Next.js 15 (App Router), Tailwind CSS, Supabase (CLI for local dev, `@supabase/ssr`, `@supabase/supabase-js`), pgTAP via `supabase test db`, Resend for email, bcryptjs for PINs, Playwright for E2E.

**Spec:** `docs/superpowers/specs/2026-11-15-huntsville-golf-tour-design.md`

## Global Constraints

- Must be usable for the February 2027 opener (date TBD); Phase 2 by the Masters, April 2027.
- Hosting free or ~$25/month (Vercel hobby/pro + Supabase free/pro).
- Mobile-first: every player-facing screen works one-handed on a phone outdoors (min tap target 44px, high-contrast text).
- `packages/scoring` imports nothing from React, Next, Supabase, or the DOM.
- Events in `draft` status are never visible to non-commissioners (enforced by RLS, not just UI).
- Scores are official only after the scorer **and** one other group member sign; signed cards are editable only by commissioners, and every such edit writes an audit row.
- A player's handicap index is snapshotted per round when the tee sheet is sent; later index changes never alter that round.
- Course handicap = index × slope / 113 + (course rating − par) (WHS).
- Play-in advance count: 6 if 15 or fewer registered, 8 if 16 or more.
- Bracket placement and byes by random draw. Only players who advance from the play-in earn season points.
- Season points are stored and displayed to 2 decimal places.
- Season points modeled on FedExCup: regular events 500 to the winner, majors 750; tied positions split points evenly; table editable by commissioners.
- Withdrawals, no-shows, DQs earn 0 points by default; commissioners can override.
- Only 3 commissioners; players log in by email magic link (no passwords); signing uses a 4-digit personal PIN.

## Review Focus

1. **Signal drops mid-round** — scores entered offline survive a page reload and sync exactly once when the connection returns (Task 14 test `offline queue survives reload and flushes once`).
2. **Plus handicaps** (negative index, e.g. +2.1) — the player *gives* strokes back on the easiest holes (stroke index 18, 17, …), never receives any (Task 2 test `plus handicap gives back strokes on easiest holes`).
3. **Odd bracket sizes** — 6 advancers produce an 8-slot bracket with 2 byes, byes never meet each other, and bye winners appear in round 2 automatically (Task 5 test `six players get two byes that never meet`).
4. **Two phones open the same group code** — only the device holding the scorer role can write scores; others see a live read-only card (Task 14 test `non-scorer device is read-only`).
5. **Index edited after tee sheet sent** — the round's strokes and results don't change (Task 13 test `index change after send does not change snapshot`).

---

## File Structure

```
package.json, pnpm-workspace.yaml, tsconfig.base.json, .github/workflows/ci.yml
packages/scoring/
  src/types.ts            shared types (TeeInfo, HoleInfo, RankedRow, …)
  src/handicap.ts         course/playing handicap, strokes per hole, net
  src/rank.ts             rankWithTies
  src/strokePlay.ts       stroke-play leaderboard
  src/matchPlay.ts        match strokes + live match status
  src/playIn.ts           advanceCount, playInCut
  src/bracket.ts          drawBracket, recordWinner, bracketFinishPositions
  src/points.ts           FedExCup tables, awardPoints
  src/standings.ts        season standings with breakdown
  src/index.ts            re-exports
  test/*.test.ts          one file per src module
supabase/
  migrations/0001_core.sql        schema
  migrations/0002_rls.sql         policies + helper functions
  tests/rls.test.sql              pgTAP
  seed.sql                        dev data (1 course, 12 players, 3 commissioners)
apps/web/
  src/lib/supabase/{server,browser,admin}.ts
  src/lib/auth.ts                 requireUser, requireCommissioner
  src/lib/codes.ts                generateGroupCode
  src/lib/handicapPaste.ts        parseHandicapPaste
  src/lib/mailer.ts               Mailer interface + Resend + fake
  src/lib/scoreQueue.ts           offline queue
  src/app/(public)/…              login, events, standings, leaderboard, bracket, code entry, scorecard
  src/app/admin/…                 courses, players, events, tee sheet, bracket, cards
  src/actions/*.ts                server actions per area
  test/*.test.ts                  Vitest unit tests for lib + actions
  e2e/opener.spec.ts              Playwright end-to-end
```

---

### Task 1: Monorepo and scoring package scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.github/workflows/ci.yml`
- Create: `packages/scoring/package.json`, `packages/scoring/tsconfig.json`, `packages/scoring/src/index.ts`, `packages/scoring/src/types.ts`
- Test: `packages/scoring/test/smoke.test.ts`

**Interfaces:**
- Produces: package `@hgt/scoring`; root scripts `pnpm test` (all workspaces), `pnpm -F @hgt/scoring test`.
- Produces in `types.ts`:
  ```ts
  export type HoleInfo = { number: number; par: number; strokeIndex: number };
  export type TeeInfo = { rating: number; slope: number; par: number; holes: HoleInfo[] };
  export type RankedRow<T> = { item: T; position: number; tied: boolean };
  export type Placing = { playerId: string; position: number; tied: boolean };
  ```

- [ ] **Step 1:** Write `test/smoke.test.ts`: `expect(typeof scoring).toBe('object')` importing `* as scoring from '../src'`.
- [ ] **Step 2:** Run `pnpm install && pnpm -F @hgt/scoring test` — Expected: FAIL (module not found).
- [ ] **Step 3:** Create the workspace files (strict TS, `"type": "module"`, Vitest), `types.ts`, and `index.ts` re-exporting types. CI runs `pnpm install --frozen-lockfile && pnpm -r typecheck && pnpm -r test`.
- [ ] **Step 4:** Run `pnpm -F @hgt/scoring test` — Expected: PASS.
- [ ] **Step 5:** Commit `chore: monorepo and scoring package scaffold`.

---

### Task 2: Handicap math

**Files:**
- Create: `packages/scoring/src/handicap.ts`
- Test: `packages/scoring/test/handicap.test.ts`

**Interfaces:**
- Consumes: `TeeInfo`, `HoleInfo`.
- Produces:
  ```ts
  courseHandicapExact(index: number, tee: TeeInfo): number      // unrounded, WHS
  playingHandicap(index: number, tee: TeeInfo, allowancePct: number): number // round(exact × pct/100), .5 rounds away from zero
  strokesOnHole(playing: number, strokeIndex: number, holeCount?: number): number // default 18; negative for plus
  netScore(gross: number, strokes: number): number
  ```

- [ ] **Step 1: Write failing tests**
  ```ts
  const tee = { rating: 71.2, slope: 128, par: 72, holes: /* 18 holes, strokeIndex 1..18 */ };
  test('course handicap exact', () => expect(courseHandicapExact(10.4, tee)).toBeCloseTo(10.4*128/113 + (71.2-72), 6)); // 10.98
  test('playing handicap 100%', () => expect(playingHandicap(10.4, tee, 100)).toBe(11));
  test('playing handicap 85%', () => expect(playingHandicap(10.4, tee, 85)).toBe(9)); // 9.33
  const flat = { ...tee, slope: 113, rating: 72 }; // exact = index
  test('half rounds away from zero', () => { expect(playingHandicap(4.5, flat, 100)).toBe(5); expect(playingHandicap(-4.5, flat, 100)).toBe(-5); });
  test('11 strokes land on SI 1-11', () => { expect(strokesOnHole(11, 11)).toBe(1); expect(strokesOnHole(11, 12)).toBe(0); });
  test('22 strokes: 2 on SI 1-4, 1 elsewhere', () => { expect(strokesOnHole(22, 4)).toBe(2); expect(strokesOnHole(22, 5)).toBe(1); });
  test('plus handicap gives back strokes on easiest holes', () => {
    expect(strokesOnHole(-2, 18)).toBe(-1); expect(strokesOnHole(-2, 17)).toBe(-1); expect(strokesOnHole(-2, 16)).toBe(0); expect(strokesOnHole(-2, 1)).toBe(0);
  });
  test('net', () => expect(netScore(5, 1)).toBe(4));
  ```
- [ ] **Step 2:** Run `pnpm -F @hgt/scoring test handicap` — Expected: FAIL.
- [ ] **Step 3:** Implement in `handicap.ts`. Strokes: `base = trunc(playing / holeCount)`, remainder `r = playing − base×holeCount`; for `r > 0` add 1 when `strokeIndex ≤ r`; for `r < 0` subtract 1 when `strokeIndex > holeCount + r`.
- [ ] **Step 4:** Run tests — Expected: PASS.
- [ ] **Step 5:** Commit `feat(scoring): WHS handicap and stroke allocation`.

---

### Task 3: Ranking and stroke-play leaderboard

**Files:**
- Create: `packages/scoring/src/rank.ts`, `packages/scoring/src/strokePlay.ts`
- Test: `packages/scoring/test/rank.test.ts`, `packages/scoring/test/strokePlay.test.ts`

**Interfaces:**
- Consumes: Task 2 functions, `TeeInfo`, `RankedRow`.
- Produces:
  ```ts
  rankWithTies<T>(items: T[], score: (t: T) => number): RankedRow<T>[] // ascending; equal scores share position (1,2,2,4)
  export type PlayerCard = { playerId: string; playing: number; gross: (number | null)[] }; // index = hole-1
  export type LeaderboardRow = { playerId: string; thru: number; gross: number; net: number; toPar: number; position: number; tied: boolean };
  strokePlayLeaderboard(cards: PlayerCard[], tee: TeeInfo, mode: 'gross' | 'net'): LeaderboardRow[]
  ```
  `toPar` is vs par of holes played (net or gross per mode). Players with `thru = 0` sort last, position by `toPar` (so a partial round compares fairly mid-round).

- [ ] **Step 1:** Failing tests: `rankWithTies` on scores `[70,72,72,75]` → positions `[1,2,2,4]`, tied flags `[false,true,true,false]`; leaderboard: two complete cards where A gross 80 playing 10 and B gross 75 playing 2 → net mode A first (70 vs 73), gross mode B first; mid-round card thru 9 at +1 ranks above a complete card at +3; card with no scores is last with `thru: 0`.
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3:** Implement both files.
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5:** Commit `feat(scoring): tie-aware ranking and stroke-play leaderboard`.

---

### Task 4: Match play status

**Files:**
- Create: `packages/scoring/src/matchPlay.ts`
- Test: `packages/scoring/test/matchPlay.test.ts`

**Interfaces:**
- Consumes: `strokesOnHole`, `HoleInfo`.
- Produces:
  ```ts
  matchStrokes(aPlaying: number, bPlaying: number, mode: 'full' | 'offLow'): [number, number]
  export type MatchState = { up: number; thru: number; finished: boolean; winner: 'A' | 'B' | 'halved' | null; label: string };
  matchStatus(holes: HoleInfo[], aGross: (number|null)[], bGross: (number|null)[], aStrokes: number, bStrokes: number, opts: { allowExtraHoles: boolean }): MatchState
  ```
  `up` > 0 means A leads. Extra hole *n* (index ≥ 18) uses `holes[n % 18]` with the same strokes as that hole (builder's call, from spec: elimination halves go to extra holes, sudden death).

- [ ] **Step 1:** Failing tests:
  - `matchStrokes(12, 5, 'offLow')` → `[7, 0]`; `'full'` → `[12, 5]`.
  - A wins holes 1–3, rest halved through 12 → `{ up: 3, thru: 12, finished: false, label: 'A 3 UP thru 12' }`.
  - A 4 UP thru 14 (dormie) → `finished: false, label: 'A 4 UP thru 14'`; A 5 UP thru 14 → `finished: true, winner: 'A', label: '5&4'`.
  - All square after 18, `allowExtraHoles: false` → `winner: 'halved', label: 'Halved'`.
  - All square after 18, `allowExtraHoles: true`, A wins hole 19 → `winner: 'A', label: 'A wins on 19th'`.
  - 1 up after 18 → `label: '1 UP'`.
  - Net: hole where A gets a stroke and both gross 5 → A wins the hole.
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3:** Implement; stop counting once finished; `thru` = last consecutive hole both sides have a score.
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5:** Commit `feat(scoring): match play strokes and live status`.

---

### Task 5: Play-in cut and random-draw bracket

**Files:**
- Create: `packages/scoring/src/playIn.ts`, `packages/scoring/src/bracket.ts`
- Test: `packages/scoring/test/playIn.test.ts`, `packages/scoring/test/bracket.test.ts`

**Interfaces:**
- Consumes: `LeaderboardRow`, `Placing`.
- Produces:
  ```ts
  export type PlayInRule = { threshold: number; below: number; atOrAbove: number };
  export const DEFAULT_PLAY_IN: PlayInRule = { threshold: 16, below: 6, atOrAbove: 8 };
  advanceCount(registered: number, rule?: PlayInRule): number
  playInCut(rows: LeaderboardRow[], count: number): { advanced: string[]; tiebreak: { spots: number; playerIds: string[] } | null }
  export type BracketMatch = { id: string; round: number; slot: number; a: string | null; b: string | null; winner: string | null; isBye: boolean };
  export type Bracket = { size: number; rounds: number; matches: BracketMatch[] };
  drawBracket(playerIds: string[], rng: () => number): Bracket
  recordWinner(bracket: Bracket, matchId: string, winnerId: string): Bracket   // pure; returns new bracket
  bracketFinishPositions(bracket: Bracket): Placing[]
  ```
  Match ids `R{round}M{slot}`. `drawBracket`: Fisher–Yates shuffle with `rng`, assign shuffled players to seeds 1..N, `size` = next power of two, seeds > N are byes, place seeds in standard order (size 8: `[1,8,4,5,2,7,3,6]`, generated recursively), and auto-advance bye winners into round 2. Finish positions: champion 1, runner-up 2, losers in round *r* share position `size / 2^(rounds − r) + 1` with `tied: true` (8-bracket: semifinal losers T3, quarterfinal losers T5). Byes are not players and get no position.

- [ ] **Step 1:** Failing tests:
  - `advanceCount(12)` → 6, `advanceCount(15)` → 6, `advanceCount(16)` → 8, `advanceCount(30)` → 8.
  - `playInCut` with 6 spots and positions `1,2,3,4,5,6,7` (untied) → 6 advanced, `tiebreak: null`; with positions `1,2,3,4,5,T6,T6` → 5 advanced, `tiebreak: { spots: 1, playerIds: [two ids] }`.
  - `six players get two byes that never meet`: `drawBracket(6 ids, seededRng)` → `size 8`, exactly 2 round-1 matches with `isBye`, no match where both sides are null, and the two bye winners already sit in round-2 matches.
  - Same rng seed → identical bracket (deterministic); different seeds → different placement for at least one of 20 seeds.
  - `recordWinner` through the final, then `bracketFinishPositions` on 8 players → one 1, one 2, two T3, four T5.
  - `recordWinner` with a player not in that match throws.
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3:** Implement both files. Use a small seedable rng (mulberry32) in tests only; production passes `Math.random` or `crypto`.
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5:** Commit `feat(scoring): play-in cut and random-draw elimination bracket`.

---

### Task 6: FedExCup-style points and standings

**Files:**
- Create: `packages/scoring/src/points.ts`, `packages/scoring/src/standings.ts`
- Test: `packages/scoring/test/points.test.ts`, `packages/scoring/test/standings.test.ts`

**Interfaces:**
- Consumes: `Placing`.
- Produces:
  ```ts
  export const FEDEX_500: readonly number[]; // index 0 = 1st place
  pointsTable(winnerPoints: number, base?: readonly number[]): number[] // scales base by winnerPoints/500, rounded to 2 decimals
  awardPoints(placings: Placing[], table: readonly number[]): { playerId: string; points: number }[] // tied players share avg of occupied positions; beyond table = 0
  export type Award = { playerId: string; eventId: string; points: number };
  export type StandingsRow = { playerId: string; total: number; position: number; tied: boolean; qualified: boolean; byEvent: { eventId: string; points: number }[] };
  seasonStandings(awards: Award[], qualifyingSpots?: number): StandingsRow[] // default 8; descending
  ```
  `FEDEX_500` default values (positions 1–30), builder's call based on the PGA Tour 500-point distribution — **commissioners must verify against the current published FedExCup table before launch** and can edit it in admin:
  `500, 300, 190, 135, 110, 100, 90, 85, 80, 75, 70, 65, 60, 57, 55, 53, 51, 49, 47, 45, 43, 41, 39, 37, 35.5, 34, 32.5, 31, 29.5, 28`.
  `qualified` = position ≤ qualifyingSpots (ties at the line all show qualified; commissioner resolves).

- [ ] **Step 1:** Failing tests: `pointsTable(750)[0]` → 750, `[1]` → 450; `awardPoints` with positions `1, T2, T2, 4` on `FEDEX_500` → `500, 245, 245, 135`; position 40 → 0; `seasonStandings` sums across events, sorts descending, `byEvent` lists each event, 9th player `qualified: false`.
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3:** Implement both files and export everything from `index.ts`.
- [ ] **Step 4:** Run `pnpm -F @hgt/scoring test` — Expected: all PASS.
- [ ] **Step 5:** Commit `feat(scoring): FedExCup-style points and season standings`.

---

### Task 7: Database schema and row-level security

**Files:**
- Create: `supabase/config.toml` (via `supabase init`), `supabase/migrations/0001_core.sql`, `supabase/migrations/0002_rls.sql`, `supabase/tests/rls.test.sql`, `supabase/seed.sql`

**Interfaces:**
- Produces tables (all `id uuid pk default gen_random_uuid()`, `created_at timestamptz default now()`):
  - `players(user_id uuid unique null references auth.users, name text, email citext unique, handicap_index numeric(4,1), handicap_source text check in ('GHIN','TheGrint','18Birdies','Other'), is_commissioner bool default false, pin_hash text null)`
  - `courses(name)`, `tees(course_id, name, rating numeric(4,1), slope int, par int)`, `holes(tee_id, number int, par int, stroke_index int, unique(tee_id, number))`
  - `seasons(year int unique)`
  - `points_tables(season_id, event_type text, winner_points numeric, table_values numeric[])`
  - `events(season_id, name, event_type text check in ('regular','major','ryder_cup','championship','match_play'), format text, status text check in ('draft','published','registration_closed','in_progress','final') default 'draft', registration_deadline timestamptz, handicap_mode text check in ('gross','net'), allowance_pct int default 100, match_strokes text check in ('full','offLow') default 'full')`
  - `registrations(event_id, player_id, status text check in ('registered','withdrawn'), unique(event_id, player_id))`
  - `rounds(event_id, round_number int, tee_id, play_date date, kind text check in ('stroke','match'))`
  - `groups(round_id, tee_time time null, start_hole int default 1, code text unique, scorer_player_id uuid null, scorer_device_token text null, signed_at timestamptz null, locked bool default false)`
  - `group_players(group_id, player_id, index_snapshot numeric(4,1), playing_handicap int, unique(group_id, player_id))`
  - `scores(group_id, player_id, hole int, gross int, client_ts timestamptz, unique(group_id, player_id, hole))`
  - `signatures(group_id, player_id, role text check in ('scorer','attest'), signed_at, unique(group_id, role))`
  - `brackets(event_id unique, size int, rounds int, state jsonb)` — `state` stores the `Bracket` from Task 5
  - `bracket_matches(bracket_id, match_key text, round int, deadline timestamptz, group_id uuid null, result text null, forfeit bool default false, unique(bracket_id, match_key))`
  - `points_awards(event_id, player_id, points numeric, override bool default false, unique(event_id, player_id))`
  - `audit_log(actor_player_id, entity text, entity_id uuid, before jsonb, after jsonb, at timestamptz default now())`
- Produces SQL helpers: `is_commissioner() returns bool` (security definer, by `auth.uid()`), `current_player_id() returns uuid`.
- RLS: commissioners full access to all tables; authenticated players read courses/tees/holes/seasons, read events where `status <> 'draft'`, read/insert/update **own** registrations only while event is `published` and before deadline, read groups/scores/signatures/brackets/points/standings of non-draft events; `players` readable (name, handicap only via a `public_players` view), update own row only for `pin_hash`. `scores`, `signatures`, `audit_log` writes only via service role (server actions).

- [ ] **Step 1:** Write `supabase/tests/rls.test.sql` (pgTAP) asserting: a non-commissioner sees 0 rows from a `draft` event and 1 from a `published` one; a player cannot insert a registration for another player; a player cannot register after `registration_deadline`; a player cannot insert into `scores`; a commissioner can update `events.status`.
- [ ] **Step 2:** Run `supabase start && supabase test db` — Expected: FAIL (tables missing).
- [ ] **Step 3:** Write both migrations and `seed.sql` (1 placeholder course with one tee and 18 holes — real Cherokee Ridge CC data is entered by commissioners from the club scorecard, never guessed, 2027 season with FedEx tables for `regular`/`match_play` 500 and `major` 750, 12 players, 3 of them commissioners).
- [ ] **Step 4:** Run `supabase db reset && supabase test db` — Expected: PASS.
- [ ] **Step 5:** Commit `feat(db): core schema and row-level security`.

---

### Task 8: Web app scaffold and magic-link auth

**Files:**
- Create: `apps/web/` via `create-next-app` (TS, Tailwind, App Router, `src/`), `apps/web/src/lib/supabase/{server,browser,admin}.ts`, `apps/web/src/lib/auth.ts`, `apps/web/src/middleware.ts`, `apps/web/src/app/login/page.tsx`, `apps/web/src/app/auth/callback/route.ts`, `apps/web/src/app/layout.tsx`, `apps/web/.env.example`
- Test: `apps/web/test/auth.test.ts`

**Interfaces:**
- Consumes: Task 7 schema.
- Produces:
  ```ts
  createServerClient(): SupabaseClient   // cookie session
  createAdminClient(): SupabaseClient    // service role; server-only (import 'server-only')
  requireUser(): Promise<{ userId: string; player: PlayerRow }>        // redirects to /login
  requireCommissioner(): Promise<{ userId: string; player: PlayerRow }> // 403 page otherwise
  ```
  On first login, the callback links `auth.users.id` to the `players` row with the same email; an email not on the roster sees "Ask a commissioner to add you."
  `.env.example`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `MAIL_FROM`, `APP_URL`.
  Layout: bottom tab bar on mobile — Events, Standings, Enter Code, Me; Admin tab only for commissioners.

- [ ] **Step 1:** Failing tests (Vitest with mocked Supabase client): `requireCommissioner` throws/redirects for a non-commissioner player; callback links a matching email and rejects an unknown email.
- [ ] **Step 2:** Run `pnpm -F web test` — Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run tests — PASS; `pnpm -F web build` — succeeds.
- [ ] **Step 5:** Commit `feat(web): Next.js scaffold with magic-link auth and roles`.

---

### Task 9: Courses admin

**Files:**
- Create: `apps/web/src/actions/courses.ts`, `apps/web/src/app/admin/courses/page.tsx`, `apps/web/src/app/admin/courses/[id]/page.tsx`
- Test: `apps/web/test/courses.test.ts`

**Interfaces:**
- Produces: `saveCourse(input: { id?: string; name: string; tees: { id?: string; name: string; rating: number; slope: number; par: number; holes: { number: number; par: number; strokeIndex: number }[] }[] }): Promise<{ id: string }>`; validation via zod.
- Exports `getTeeInfo(teeId: string): Promise<TeeInfo>` for later tasks.

- [ ] **Step 1:** Failing tests: rejects a tee whose 18 stroke indexes aren't exactly 1–18; rejects slope outside 55–155; rejects par sum ≠ tee par; accepts a valid course.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement action (calls `requireCommissioner`) and pages (hole grid editable on phone: 18 rows of par + SI).
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(web): course and tee management`.

---

### Task 10: Players and handicap bulk update

**Files:**
- Create: `apps/web/src/lib/handicapPaste.ts`, `apps/web/src/actions/players.ts`, `apps/web/src/app/admin/players/page.tsx`
- Test: `apps/web/test/handicapPaste.test.ts`, `apps/web/test/players.test.ts`

**Interfaces:**
- Produces:
  ```ts
  parseHandicapPaste(text: string, roster: { id: string; name: string }[]): { matched: { playerId: string; index: number }[]; unmatched: string[]; errors: { line: number; message: string }[] }
  savePlayer(input: { id?: string; name: string; email: string; handicapIndex: number; handicapSource: 'GHIN'|'TheGrint'|'18Birdies'|'Other'; isCommissioner: boolean }): Promise<{ id: string }>
  applyHandicapUpdates(updates: { playerId: string; index: number }[]): Promise<{ updated: number }>
  ```
  Paste accepts one player per line, name then index, separated by tab, comma, or 2+ spaces; plus indexes written `+2.1`; names matched case-insensitively ignoring extra spaces. Index range −10.0 to 54.0.

- [ ] **Step 1:** Failing tests: `"John Smith\t12.4"` matches; `"jane  doe, +2.1"` → index −2.1; unknown name → `unmatched`; `"Bob 99"` → error line 1; blank lines ignored.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement; admin page shows a preview of matched/unmatched before applying.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(web): player roster and handicap bulk paste`.

---

### Task 11: Events with draft/publish lifecycle

**Files:**
- Create: `apps/web/src/actions/events.ts`, `apps/web/src/app/admin/events/page.tsx`, `apps/web/src/app/admin/events/[id]/page.tsx`, `apps/web/src/app/events/page.tsx`, `apps/web/src/app/events/[id]/page.tsx`
- Test: `apps/web/test/events.test.ts`

**Interfaces:**
- Produces:
  ```ts
  saveEvent(input: { id?: string; seasonId: string; name: string; eventType: EventType; format: 'stroke'|'match_play'; handicapMode: 'gross'|'net'; allowancePct: number; matchStrokes: 'full'|'offLow'; registrationDeadline: string; rounds: { roundNumber: number; teeId: string; playDate: string | null; kind: 'stroke'|'match' }[] }): Promise<{ id: string }>
  setEventStatus(eventId: string, to: EventStatus): Promise<void>
  ```
  Allowed transitions only: `draft→published`, `published→registration_closed`, `registration_closed→published` (reopen), `registration_closed→in_progress`, `in_progress→final`, and commissioner `final→in_progress` (reopen, audited). A match-play event is created with round 1 `kind: 'stroke'` (the play-in).

- [ ] **Step 1:** Failing tests: `draft→final` throws; `draft→published` succeeds and writes audit row; non-commissioner call throws; player events list query excludes drafts (via RLS, integration against local Supabase).
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement. Player event page shows name, date, course, format, deadline, and registered list.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(web): events with draft and publish lifecycle`.

---

### Task 12: Registration

**Files:**
- Create: `apps/web/src/actions/registration.ts`; modify `apps/web/src/app/events/[id]/page.tsx`, `apps/web/src/app/admin/events/[id]/page.tsx`
- Test: `apps/web/test/registration.test.ts`

**Interfaces:**
- Produces: `register(eventId: string): Promise<void>`, `withdraw(eventId: string): Promise<void>`, `adminSetRegistration(eventId: string, playerId: string, status: 'registered'|'withdrawn'): Promise<void>`. The event page shows the live count and, for match play, "Top 6 advance (8 at 16+ players)" using `advanceCount`.

- [ ] **Step 1:** Failing tests: register on `published` before deadline succeeds; twice is idempotent; after deadline throws "Registration is closed"; on `draft` throws; commissioner can add a player after close.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(web): event registration`.

---

### Task 13: Tee sheet, group codes, handicap snapshot, email

**Files:**
- Create: `apps/web/src/lib/codes.ts`, `apps/web/src/lib/mailer.ts`, `apps/web/src/actions/teeSheet.ts`, `apps/web/src/app/admin/events/[id]/rounds/[roundId]/page.tsx`, `apps/web/src/emails/teeSheet.tsx`
- Test: `apps/web/test/codes.test.ts`, `apps/web/test/teeSheet.test.ts`

**Interfaces:**
- Consumes: `playingHandicap` (Task 2), `getTeeInfo` (Task 9).
- Produces:
  ```ts
  generateGroupCode(rng?: () => number): string // 6 chars from 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  interface Mailer { send(msg: { to: string; subject: string; html: string }): Promise<void> }
  createResendMailer(apiKey: string, from: string): Mailer; createFakeMailer(): Mailer & { sent: {to:string;subject:string;html:string}[] }
  saveGroups(roundId: string, groups: { id?: string; teeTime: string | null; startHole: number; playerIds: string[]; scorerPlayerId: string | null }[]): Promise<void>
  sendTeeSheet(roundId: string, mailer: Mailer): Promise<{ sent: number }>
  ```
  `sendTeeSheet` (idempotent on resend: codes and snapshots unchanged unless a group's players changed): assigns a unique code per group, writes `index_snapshot` and `playing_handicap` per `group_players` row from current index, event allowance, and the round's tee, then emails each player their tee time, group mates, code, and a link `APP_URL/c/{code}`. Moves event to `in_progress` if it was `registration_closed`. Auto-groups helper: `suggestGroups(playerIds, size = 4)` in random order for commissioners to adjust.

- [ ] **Step 1:** Failing tests: code is 6 chars from the alphabet; 1,000 codes have no `0`, `O`, `1`, `I`, `L`; `sendTeeSheet` with fake mailer sends one email per player, each containing that player's group code; `index change after send does not change snapshot`: update player's index then reload group → `index_snapshot` and `playing_handicap` unchanged; resend doesn't change codes.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement; admin page lets commissioners drag/tap players into groups and pick the scorer.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(web): tee sheets, group codes, handicap snapshot, email`.

---

### Task 14: Group-code scorecard with offline queue

**Files:**
- Create: `apps/web/src/lib/scoreQueue.ts`, `apps/web/src/actions/scorecard.ts`, `apps/web/src/app/c/page.tsx` (code entry), `apps/web/src/app/c/[code]/page.tsx`, `apps/web/src/app/c/[code]/Scorecard.tsx`
- Test: `apps/web/test/scoreQueue.test.ts`, `apps/web/test/scorecard.test.ts`

**Interfaces:**
- Consumes: `strokesOnHole`, `matchStatus`, `matchStrokes` for on-card net/match display.
- Produces:
  ```ts
  openGroup(code: string): Promise<GroupView>   // sets httpOnly cookie `hgt_dev` device token if absent
  claimScorer(code: string, playerId: string): Promise<void> // records scorer_player_id + scorer_device_token = this device; allowed if no scorer device yet, or by commissioner (hand-off)
  saveScores(code: string, entries: { playerId: string; hole: number; gross: number; clientTs: string }[]): Promise<{ accepted: number }>
  type GroupView = { groupId: string; locked: boolean; isScorerDevice: boolean; players: { id: string; name: string; playingHandicap: number }[]; holes: HoleInfo[]; scores: Record<string, (number|null)[]>; kind: 'stroke'|'match' }
  createScoreQueue(storage: Storage, send: (entries) => Promise<{accepted:number}>): { enqueue(e): void; flush(): Promise<void>; pending(): number }
  ```
  `saveScores` rejects if group is `locked` or the request's device token ≠ `scorer_device_token`; upsert keeps the entry with the latest `client_ts`. Gross scores 1–15 only. Scorecard UI: one hole per screen, +/− big buttons per player defaulting to par, swipe/next to advance, shows net and (for match rounds) match status; queue flushes on `online` event and every 15 s. Read-only devices subscribe to Supabase realtime on `scores` for the group.

- [ ] **Step 1:** Failing tests:
  - `offline queue survives reload and flushes once`: enqueue 3 entries with a failing `send`, create a new queue over the same storage, then flush with a working `send` → `send` called once with 3 entries; `pending()` → 0; second flush does not call `send`.
  - `non-scorer device is read-only`: `saveScores` from a different device token throws "Only the scorer can enter scores".
  - older `client_ts` does not overwrite newer score.
  - `saveScores` on a locked group throws "Card is signed".
  - gross 0 or 16 rejected.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(web): group-code scorecard with offline sync`.

---

### Task 15: PIN setup, two-person signing, commissioner reopen

**Files:**
- Create: `apps/web/src/actions/signing.ts`, `apps/web/src/app/me/pin/page.tsx`, `apps/web/src/app/c/[code]/Sign.tsx`, `apps/web/src/app/admin/cards/[groupId]/page.tsx`
- Test: `apps/web/test/signing.test.ts`

**Interfaces:**
- Produces:
  ```ts
  setPin(pin: string): Promise<void>  // logged-in player; exactly 4 digits; bcrypt hash
  signCard(code: string, playerId: string, pin: string, role: 'scorer'|'attest'): Promise<{ locked: boolean }>
  reopenCard(groupId: string, reason: string): Promise<void>  // commissioner; unlocks, clears signatures, audit row
  adminEditScore(groupId: string, playerId: string, hole: number, gross: number): Promise<void> // commissioner; audit row with before/after
  ```
  Rules: `scorer` role must be the group's `scorer_player_id`; `attest` must be a different player in the group; in match rounds the attester must be from the opposing side; signing requires every player to have 18 scores (or match finished); card locks when both roles are signed. Five wrong PINs in 10 minutes for a player blocks that player's signing for 10 minutes. Player with no PIN sees "Set your PIN in the app (Me → PIN)" and the commissioner can sign on their behalf from admin.

- [ ] **Step 1:** Failing tests: wrong PIN rejected; scorer cannot sign as attester; attester same as scorer rejected; match-round attester from same side rejected; incomplete card rejected; both signatures → `locked: true`; `saveScores` after lock throws; `reopenCard` clears signatures, unlocks, writes audit; 6th wrong PIN within 10 min is blocked even if correct.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(web): PIN signing, card lock, commissioner reopen with audit`.

---

### Task 16: Live leaderboard

**Files:**
- Create: `apps/web/src/actions/leaderboard.ts`, `apps/web/src/app/events/[id]/leaderboard/page.tsx`, `apps/web/src/app/events/[id]/leaderboard/Live.tsx`
- Test: `apps/web/test/leaderboard.test.ts`

**Interfaces:**
- Consumes: `strokePlayLeaderboard` (Task 3), `advanceCount`, `playInCut` (Task 5).
- Produces: `getRoundLeaderboard(roundId: string): Promise<{ rows: (LeaderboardRow & { name: string; signed: boolean })[]; cutLine: number | null }>`. For a match-play event's play-in round, rows show a cut line after `advanceCount(registeredCount)` and an "advancing" marker. Live updates via realtime subscription on `scores` for the round (re-query on change, throttled to 1/2 s).

- [ ] **Step 1:** Failing tests: leaderboard built from DB fixtures matches `strokePlayLeaderboard` output; 12 registered → `cutLine: 6`; draft event → not found for player.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement; columns: Pos, Player, Thru, To Par (net), Gross, signed check.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(web): live round leaderboard with play-in cut line`.

---

### Task 17: Match-play event: cut, draw, matches, deadlines, forfeits

**Files:**
- Create: `apps/web/src/actions/bracket.ts`, `apps/web/src/app/admin/events/[id]/bracket/page.tsx`, `apps/web/src/app/events/[id]/bracket/page.tsx`
- Test: `apps/web/test/bracket.test.ts`

**Interfaces:**
- Consumes: `playInCut`, `drawBracket`, `recordWinner`, `bracketFinishPositions` (Task 5), `matchStatus` (Task 4), `generateGroupCode`, `Mailer` (Task 13).
- Produces:
  ```ts
  closePlayIn(eventId: string, tiebreakWinners?: string[]): Promise<{ advanced: string[] } | { needsTiebreak: { spots: number; playerIds: string[] } }>
  drawEventBracket(eventId: string): Promise<Bracket>       // crypto-backed rng; stores state; refuses if already drawn
  setRoundDeadline(eventId: string, round: number, deadline: string): Promise<void>
  createMatchCard(eventId: string, matchKey: string, playDate: string | null): Promise<{ code: string }> // either player (logged in) or commissioner; creates match round + group with both players, snapshots handicaps, emails both players the code
  finalizeMatch(eventId: string, matchKey: string): Promise<void> // after signed card: reads matchStatus winner → recordWinner; halved not allowed (extra holes enabled)
  awardForfeit(eventId: string, matchKey: string, winnerId: string): Promise<void> // commissioner; audit
  ```
  `closePlayIn` requires every play-in card signed. When a tiebreak is needed, the admin page lists the tied players and the commissioner picks who advances. Match rounds use the event's `match_strokes` setting and `allowExtraHoles: true`. Public bracket page shows each match: players, status ("Not scheduled", "Scheduled 3/2", live "2 UP thru 12", result "3&2"), and the round deadline. Matches past deadline are flagged on the admin page.

- [ ] **Step 1:** Failing tests: 12 registered, all play-in cards signed → `closePlayIn` advances 6; with tie at 6th → returns `needsTiebreak`, then with `tiebreakWinners` advances 6; unsigned card → throws "All play-in cards must be signed"; `drawEventBracket` twice throws; `finalizeMatch` advances the winner into the next round; `awardForfeit` advances and writes audit; non-participant player cannot `createMatchCard`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(web): match-play bracket with player-scheduled matches`.

---

### Task 18: Awarding points and standings page

**Files:**
- Create: `apps/web/src/actions/points.ts`, `apps/web/src/app/standings/page.tsx`, `apps/web/src/app/standings/[playerId]/page.tsx`, `apps/web/src/app/admin/seasons/[id]/points/page.tsx`
- Test: `apps/web/test/points.test.ts`

**Interfaces:**
- Consumes: `pointsTable`, `awardPoints`, `seasonStandings` (Task 6), `bracketFinishPositions` (Task 5), `strokePlayLeaderboard` (Task 3).
- Produces:
  ```ts
  finalizeEvent(eventId: string): Promise<{ awards: { playerId: string; points: number }[] }> // sets status 'final', writes points_awards (non-override rows replaced)
  overridePoints(eventId: string, playerId: string, points: number): Promise<void> // commissioner; override=true; audit
  saveEventTypePoints(seasonId: string, eventType: EventType, winnerPoints: number, values: number[]): Promise<void>
  getStandings(seasonId: string): Promise<(StandingsRow & { name: string })[]>
  ```
  Match-play events: placings from `bracketFinishPositions`; play-in non-advancers get no award row (0). Stroke events: placings from final leaderboard; withdrawn/no-card players get 0. Standings page: Pos, Player, Points, events played; a line under 8th labeled "Season Championship cut"; tap a player → per-event breakdown.

- [ ] **Step 1:** Failing tests: 8-player bracket finished → champion 500, runner-up 300, T3 each (190+135)/2 = 162.5, T5 each (110+100+90+85)/4 = 96.25; play-in non-advancer has no points; override survives re-finalize; standings sum across two events and mark top 8 qualified.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(web): event points, overrides, and season standings`.

---

### Task 19: End-to-end opener rehearsal and deploy

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/opener.spec.ts`, `docs/RUNBOOK.md`

**Interfaces:**
- Consumes: everything above, against local Supabase seeded by `seed.sql`, with the fake mailer (env `MAILER=fake` writes sent mail to a table the test reads).

- [ ] **Step 1:** Write `opener.spec.ts` on a phone viewport (iPhone 14): commissioner creates a match-play event (draft), confirms a player can't see it, publishes; 12 players register; commissioner closes registration, auto-groups the play-in into 3 groups and sends the tee sheet; for each group, open `/c/{code}`, claim scorer, enter 18 holes, sign as scorer and attester with PINs; close play-in → 6 advance; draw bracket → 2 byes; play the 4 remaining matches via match cards; finalize event; standings show 6 players with 500/300/162.5/162.5/… and the rest absent.
- [ ] **Step 2:** Run `pnpm -F web exec playwright test --trace off` — Expected: FAIL until all wiring is correct; fix integration bugs found (each fix gets its own unit test in the owning task's test file).
- [ ] **Step 3:** Run again — Expected: PASS.
- [ ] **Step 4:** Write `docs/RUNBOOK.md`: create Supabase project, run migrations, set env vars on Vercel, configure Resend domain, add the 3 commissioners, verify FedExCup table, and an event-day checklist (send tee sheet, watch unsigned cards, close play-in, draw).
- [ ] **Step 5:** Commit `test(e2e): opener rehearsal; docs: runbook`.

---

## Self-review notes

- Spec coverage (Phase 1 list): courses ✔ T9; players/handicaps/bulk ✔ T10; seasons/events/draft-publish ✔ T7/T11; registration ✔ T12; tee sheets/codes/email ✔ T13; live scoring/signing/reopen/audit ✔ T14–15; leaderboard ✔ T16; net stroke play play-in ✔ T3/T16; match play cut/draw/byes/deadlines/forfeits/live card ✔ T4/T5/T17; points/standings ✔ T6/T18. Ryder Cup, other formats, team match play, pods, multi-round, Championship are Phase 2/2b plans.
- Unflagged spec item handled: unsigned card after round flagged to commissioners → admin event page lists unsigned groups (T15 admin card page + T17 `closePlayIn` guard).
