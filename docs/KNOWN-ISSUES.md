# Known issues and follow-ups (Phase 1)

Collected from the step-by-step reviews and the final whole-build review.
Nothing here blocks running an event; the first list should be done before the app goes live.
(Login rate-limit answers, the `APP_URL` redirect origin, the scorecard offline cache, the event season confirm
and orphaned round rows were fixed in the course-lookup hardening pass.)

## Before the app goes live (small hardening)

- Check the seeded FedExCup points table against the PGA Tour's published table.

## Can wait (reviewers judged these low risk at tour scale)

- Task 7: minor (deferred): visibility helper functions executable by authenticated (oracle, low risk); seed CASE simplification; groups column-grant comment.
- Task 8: minor (deferred): linkPlayerByEmail concurrent no-op returns ok; shouldCreateUser:true creates stray auth users; requireUser select('*') pulls pin_hash; /forbidden is 200 not 403.
- Task 10: minor (deferred): savePlayer update on missing id returns ok; last-commissioner check not atomic; applyHandicapUpdates non-atomic + no dup-id check; stale error banner in PlayersAdmin; applyHandicapUpdates test name vs assertion; single-space paste fallback untested.
- Task 11: minor (deferred): status update + audit insert not atomic.
- Task 12: minor (deferred): registration-open rule duplicated in page and action; audit insert non-atomic; eq mock ignores args.
- Task 13: minor (deferred): no transaction around scores-check+delete; sendBatch partial-chunk failure re-emails; gross null-index snapshot; sendTeeSheet(mailer) exported from 'use server' module; auto-group no confirm.
- Task 14: minor (deferred): server-rejected score stays in scorer's grid/cache (clear cell on reject); asOf across server clocks; updateCachedCell keeps old asOf; saveCachedView lacks groupId check; anonymous code lookups not rate-limited (griefing claim); match label only for 2-player groups; lock check not atomic with score write (T15 to close).
- Task 14b: minor (deferred): test setup calls discard ActionResult (add mustOk helper).
- Task 15: minor (deferred): pin_locked message says "10 minutes" (now escalates) — fix in T16 dispatch; player who scored a signed card undeletable by any role; commissioner session can edit group_players/holes/tees under a signed card; unsigned-card flag not tied to round end.
- Task 16: minor (deferred): never-started/DNF player blocks "Advancing" markers (T17 closePlayIn decides the real cut); "Net" header → "Net to par"; scores query unbounded (1000-row cap ≈56 players); no Live.tsx component test; poll while tab hidden.
- Task 17: minor (deferred): concurrent forfeit+card-result restore can null the winner's label (skip restore on alreadyDecided / guard it); draw repair has no UI button (BracketAdmin hides Draw when drawn); reopen-guard narrow race; awardForfeit doesn't check deadline passed; event-form pre-made rounds unused for matches.
- Task 18: minor (deferred): multi-round stroke event with an empty later round finalizes with 0 awards (should refuse); saveEventTypePoints lacks 2-decimal check; award writes non-transactional; standings query 1000-row cap; missing major row falls back to 500 table (label/flag).
- Task 19: minor (deferred): orphan auth.users for non-roster emails (shouldCreateUser).
- Course lookup / hardening pass: the per-IP sign-in limit is in memory per server instance (blunts bursts only; Supabase's email limit is the backstop); the scorecard worker prunes old `/_next/static` files when a scorecard page sends its list, not at activate (it cannot know the build then); a looked-up tee with a missing value shows 0 in the form until fixed.

## From the course-lookup and hardening review (all minor)

- Removing a round on the event form is not one transaction with the rest of the save; a group
  created in the instant between the check and the delete would be removed with the round.
- The sign-in limit is best effort: per server instance, keyed on the first forwarded address,
  skipped when no address is known. Supabase's own limit is the real backstop.
- In development, `APP_URL=localhost` while browsing on 127.0.0.1 drops the session cookies.
  A malformed `APP_URL` makes every request fail loudly.
- Scorecard offline cache: old static files are pruned on the next online scorecard visit, not
  at once; the "20 most recent" cap may evict by first-saved order.
- Some form tests are occasionally slow enough to fail under heavy CPU load and pass on a rerun;
  give the test setup a longer shared timeout.

## From the Batch 1 review (2026-11-20)

Fixed in the review: the round-2 standings and the event-day "started scoring" count now read
every score (no silent 1000-row cut-off); a never-signed card's tee time is read as Central time
for "first in, last out"; signed-out pages (login, scorecard) no longer pre-load Home in the
background (it only redirects to login, and in the 127.0.0.1 test setup Next rewrites that
redirect to `localhost`, which the browser blocks as another site).

Minor, can wait:
- The round leaderboard's own scores query still has the 1000-row cap (Task 16 note; about 56 players).
- Past champions are matched to players by name; a renamed player stops matching until
  `src/lib/champions.ts` is updated.
- Pairing rules are best effort: a chain of "plays with" larger than one group cannot all be met;
  Make groups says which ones it missed.
- Any new link to a signed-in page shown on login or the scorecard will raise the same
  127.0.0.1 → localhost browser error in the rehearsal unless it has `prefetch={false}`.
