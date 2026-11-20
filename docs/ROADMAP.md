# Huntsville Golf Tour app — roadmap and working notes

Updated 2026-11-20. Read this first at the start of every work session.

## Where things stand
- Phase 1 is built and reviewed on branch `claude/golf-league-app-jftcbi`: the match-play opener
  flow, course lookup (GolfCourseAPI), and go-live hardening. Design: `docs/superpowers/specs/`.
  Setup guide: `docs/RUNBOOK.md`. Open small items: `docs/KNOWN-ISSUES.md`.
- Batch 1 steps 1–11 done (2026-11-20): poster look, Home/Login, Standings, profile photos and
  home clubs, Events and event page, tee-sheet email and player tee sheet, evening-before
  reminders (rounds and bracket matches; per-event automatic time or manual, Send now).
- Not deployed yet. The full e2e rehearsal (`E2E_RESET=1 pnpm e2e`) has not been run since
  step 3; run it at the batch review (step 14).

## Launch plan (decided by the commissioners)
- GolfXI stays the official record through the 2027 season.
- Our app is tried alongside it at real events (website version first).
- Full switch-over at the Season Championship, October 2027.
- A phone-store app by the end of 2027, after the switch-over.

## How we work
- About 15 minutes a day; keep token use low.
- One small step per session: build it, run the tests for what changed, commit, push,
  tick it off below, and name the next step. Start a fresh session each day.
- No per-step reviewer. One review at the end of each batch.

## Brand
- Artwork in `apps/web/public/brand/`: `flag-icon.png` (app icon / header mark),
  `shield-2027.png` (login, Home, emails), `event-banner-example.png` (style for event cards).
  `shield-2027-transparent.png` is the same shield cut out for dark screens (use this one in the app).
- Colors: navy main, red accent, gold highlights (years, points), silver/white trim.
  Dark card-style screens. Our own identity — do not copy other apps' branding.
- Look follows the season poster `docs/brand/season-poster-2027.png`: Anton italic capitals for
  headlines (`.display`), Oswald wide-spaced labels (`.eyebrow`), Inter for text, gold sheen on
  years/positions/points (`.text-gold-grad`), red slanted ribbon (`.ribbon`), dark rows with a
  gold left bar (`.row-card`), pinstriped navy background. Fonts are bundled (no Google call).
  Restyled screens are listed in `src/lib/darkPages.ts`; others sit on a light card until step 13.

## Batch 1 — ready to try at the February 2027 opener
- [x] 1. Theme: brand colors, fonts, header mark, app icon; dark card style on shared layout
- [x] 1b. Poster look (fonts, stripes, gold, ribbon) on Home, Login, Standings, header, tab bar
- [x] 2. Login + Home screen: shield, next event card, Enter code, your standing
- [x] 3. Standings: a column per event (sideways scroll), handicap index beside names
- [x] 4. Profile: photo upload and home club on the Me page; shown on standings/leaderboards
- [x] 5. Event cards and event page restyle (banner style): numbered poster rows like the
      2027 Majors poster (gold number, event logo, name, format line, DATE / TBA). Red ribbon
      reads "TITLES TO DEFEND. TITLES TO TAKE." until dates and courses are announced, then
      "WHO'S NEXT?" (`docs/brand/season-poster-2027-whos-next.png`) with the date and course on
      each row. Under each row's date: "Defending champion" (`defendingChampion` in
      `src/lib/champions.ts`, as on the Home next-event card). Champions strip already on Home.
- [x] 6. Tee-sheet email: locked-in handicap, tees, buttons (leaderboard, tee sheet, event page)
- [x] 7. Reminder emails the evening before each round: per event, automatic at a chosen time
      (6:00 PM default) or manual, plus "Send reminder now" per round (Supabase timer, RUNBOOK)
- [x] 8. Reminder the evening before a self-scheduled match (both players), same setting and Send now
- [x] 9. Guided event setup: steps with check marks (top of the admin event page; the next step is highlighted and links to where you do it)
- [x] 10. Event "next step" box with live counts (groups joined, started scoring, cards signed; refreshes every 30 s)
- [x] 11. Pairings: by handicap, mixed handicaps or random; 2–5 players per group ("Make groups" on the round groups page)
- [x] 11b. Pairing rules (tour-wide): "likes to play with" / "should not be grouped with"; Make groups follows them
      where it can and says which it could not meet (added at the commissioner's request)
- [x] 11c. Round 1: "Put past champions together" (champions list, matched by name). Later rounds: "By standings",
      leaders tee off last; ties first in, last out (finished the previous round earlier = tees off later)
- [ ] 12. Start times: first tee time + interval, or shotgun
- [ ] 13. Restyle scorecard, leaderboard, bracket to the new theme
- [ ] 14. Batch review + fixes
- [ ] 15. Deploy for the trial (January): RUNBOOK walkthrough, real roster

## Batch 2 — ready to try at the Masters, April 2027
- Formats, individual and team: best ball, shamble (Stableford scoring at a set percentage,
  number of scores per hole, rank by average points — as the tour runs it today), Stableford,
  quota, forward tee, 4-club
- 36-hole events; team match play; World Cup-style pods
- Phone-number login (text code)
- Copy an event; field limit with waitlist; per-player handicap override
- Enter all groups' scores on one screen; printable tee sheets and scorecards; check-in list

## Batch 3 — summer 2027, before the Ryder Cup
- Ryder Cup 6-6-6: captains' draft, lineups, scoring, season points
- League chat with automatic posts (registered, final results)
- Following other players; "people you may know"
- TV leaderboard that scrolls on its own

## Batch 4 — before the Season Championship, October 2027
- 54-hole Championship; top-8 qualifying
- Closest-to-the-pin side game; flights; spectators
- Fixes from the trials; switch-over to official record

## Not planned
Card payments, sponsors, other side games, polls.

## Confirmed tour rules (see also the design doc and RUNBOOK)
Index-based handicaps by default; 4-digit PIN signing; play-in cut counts registered players;
commissioners may sign for both players (logged); event settings and course numbers editable
after play with confirm + log; groups can change scorer themselves with PIN; reminders at 6 PM.
