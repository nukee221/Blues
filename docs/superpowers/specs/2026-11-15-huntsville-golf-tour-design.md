# Huntsville Golf Tour — App Design

Date: 2026-11-15
Status: Draft, awaiting commissioner approval

## 1. Intent and why

The Huntsville Golf Tour (HGT) runs a season of 8–10 events. Players earn
season points from their finishes; the top 8 qualify for a 54-hole Season
Championship. The tour wants its own app, modeled on what they like about
GolfXI and Squabbit, that runs the whole season: events, registration, tee
sheets, live scoring, handicaps, points, standings, and match play.

What they like and want kept:

- **GolfXI-style scoring flow**: tee sheets emailed to players, a group
  enters a code to open its scorecard, and a card needs two signatures
  (scorer + one other) to be final.
- **GolfXI-style publishing**: events are drafts, invisible to players,
  until a commissioner publishes them. (Squabbit's "appears immediately"
  behavior is explicitly not wanted.)

Success: the tour runs its 2027 season on this app, starting with the
February opener, with the full feature set working by the Masters (April
2027). By end of 2027, the same product is available as an installable
phone app.

## 2. Users and roles

- **Commissioners** (3 people): full control. Create courses, players,
  events; publish; build tee sheets; edit handicaps; reopen and correct
  signed cards; manage points tables and match-play brackets.
- **Players** (registered tour members): register for events, view
  standings and leaderboards, view their own history.
- **Group at the course**: anyone holding a group's code can open that
  group's scorecard. One person in the group is the scorer; a second group
  member co-signs.

## 3. Goals

### Season and events
- Season with 8–10 events, each with a type (regular, major, Ryder Cup,
  Season Championship) and a format.
- Events have a lifecycle: **Draft → Published (registration open) →
  Registration closed → Tee sheet sent → In progress → Final**.
  Drafts are visible only to commissioners.
- Multi-round events: majors (Masters, Open) are 36 holes; the Season
  Championship is 54 holes. Rounds may be on different days/courses.

### Registration
- Players log in (email magic link — no passwords) and register for
  published events.
- Commissioners can see the registration list, add/remove players
  manually, and close registration.

### Tee sheets and group codes
- Commissioners build groups (players + tee time/starting hole) for each
  round, then send the tee sheet.
- Sending emails every player their group, tee time, and the group's
  **code** (and a link that pre-fills it).
- Entering the code opens that group's scorecard — no account required.

### Live scoring and signing
- Hole-by-hole score entry on a phone, designed for use on the course
  (large tap targets, works on poor signal, saves locally and syncs when
  connection returns).
- One designated **scorer** enters scores for the group.
- Live leaderboard visible to everyone as scores come in.
- At the end of the round, the scorer and **one other group member** each
  sign. The card is official only after both signatures.
- *Builder's call:* signatures are tied to people with a **4-digit
  personal PIN** each player sets on first login. Signing = pick your name
  from the group + enter your PIN, so the scorer cannot sign for someone
  else. The scorer can be handed off mid-round. In Ryder Cup and match-play
  groups, the co-signer must be from the opposing side.
- A card left unsigned after the round is flagged to commissioners, who
  can finalize it.
- Once signed, the card is locked. Only commissioners can reopen and edit
  it; edits are logged (who, when, what changed).

### Handicaps
- Each player has a handicap index plus a source label (GHIN, TheGrint,
  18Birdies, other). Commissioners update indexes, singly or via bulk paste
  (name + index list).
- When a round's tee sheet is sent, each player's index is **snapshotted**
  for that round; later index changes don't affect it.
- Course handicap = index × slope / 113 + (course rating − par), per WHS,
  for the tees being played.
- Each event (or each segment, for the Ryder Cup) sets **gross or net**
  and a **handicap allowance %**. Strokes are allocated by hole handicap
  ranking.
- Courses are stored once with tees (rating, slope, par) and per-hole par
  and handicap ranking, then reused.

### Formats (scoring engine)
Each format supports individual and/or team play as the format allows,
gross or net, with an allowance %:

| Format | Notes |
|---|---|
| Stroke play | Individual; basis for majors and Season Championship |
| Best ball | Team; best N net/gross scores per hole count (N configurable, default 1) |
| Shamble | Team picks best drive, then each plays own ball; scored like best ball |
| Stableford | Points per hole vs par (configurable table, standard default) |
| Quota | Points per hole (default: bogey 1, par 2, birdie 4, eagle 8); quota = 36 − course handicap; result = points − quota |
| Forward tee | Stroke play from forward tees — a tee selection on the event, not a separate scoring rule |
| 4-club | Stroke play with a 4-club restriction — an honor-system rule shown to players, not a separate scoring rule |
| Ryder Cup 6-6-6 | Two teams; holes 1–6 best ball, 7–12 modified alt shot, 13–18 singles; match play, points per segment match |

- *Builder's calls (configurable per event):* in stroke-based events
  (individual or team), each player gets full allowance strokes off their
  own course handicap. In match play (singles, best ball matches, Ryder
  Cup), strokes are given **off the low player** in the match. Allowance is
  applied to course handicap, then rounded to the nearest whole stroke.
- *Builder's call:* teams for team formats are **assigned by
  commissioners** per event (team size configurable, 2 or 4); a tee group
  may hold more than one team.

### Season points and standings
- Commissioners configure a **points table** (points by finishing
  position) and a **multiplier per event type** (e.g., majors 2×).
- Team events: a configurable rule converts team finish into points for
  each team member (default: each member receives the team position's
  points).
- Ties: positions split points evenly (default; configurable).
- **Standings page**: rank, player, total points, and a tap-through
  showing points earned at each event. The top-8 qualifying line is
  shown clearly.
- *Builder's call:* withdrawals, no-shows, and disqualifications earn 0
  points by default; commissioners can override. Multi-round events award
  points on the combined total only.
- Season Championship field = top 8 in standings when the regular season
  closes.

### Match play
- Individual and team match-play brackets running alongside the season.
- Commissioners seed the bracket and enter or confirm match results;
  matches can also be scored live via the same group-code scorecard,
  showing match status (e.g., "2 UP thru 12").

## 4. Non-goals (for 2027 web launch)

- Native App Store / Play Store apps (planned for end of 2027 — see §7).
- Automatic handicap sync from GHIN/TheGrint/18Birdies (no usable public
  APIs; manual entry instead).
- Tour-calculated handicaps.
- Payments, side games/skins, chat, GPS/yardages.
- Multi-league / other tours using the app.

## 5. Anti-goals

- Events appearing to players before a commissioner publishes them.
- Scores becoming official without two signatures.
- Changing a player's handicap after the fact silently altering past
  results.
- Scoring on the course that fails or loses scores because of bad signal.

## 6. Constraints

- **Deadline**: core usable for the February 2027 opener; complete by the
  Masters in April 2027.
- Small scale: tens of players, ~10 events per year. Hosting should be
  free or low-cost (~$25/month).
- Must work well on phones on a golf course.

## 7. Approaches considered

1. **Mobile-friendly web app (chosen).** Players use a link or add it to
   their home screen. Fast to ship and update between February and April,
   no app-store review, cheap hosting. Trade-off: no App Store presence;
   iPhone push notifications are limited, so email does most of the
   notifying.
2. **Native iOS/Android apps now.** Better app-store presence and
   notifications, but double the work, store reviews on every update, and
   developer fees — too risky for an April deadline.
3. **No-code builder (Glide/Bubble).** Fast to start, but cannot handle
   quota scoring, modified alt shot, handicap allowances, and two-person
   card signing. Ruled out.

Decision: the tour chose the web app now, with a real phone app by the end
of 2027. The build must therefore keep the scoring engine and business
logic separate from the web UI so they can be reused by the app.

## 8. Technical direction (builder's calls, stated)

- **Next.js + TypeScript** web app, hosted on Vercel.
- **Supabase**: Postgres database, email magic-link auth, realtime updates
  for live leaderboards, row-level security for commissioner vs player.
- **Scoring engine as a standalone TypeScript package** (pure functions,
  thoroughly unit-tested): handicap math, stroke allocation, every format,
  match-play status, points calculation. Reused by the future phone app.
- Transactional email via a provider such as Resend.
- Scorecard works offline-first (local storage + sync queue).
- Phone app path for end of 2027: Expo/React Native reusing the scoring
  package and Supabase backend (or a Capacitor wrapper if that proves
  sufficient). Decide in Q3 2027.

## 9. Phasing (proposal)

**Phase 1 — February opener**
- Courses, tees, holes; players and handicap indexes (with bulk update)
- Seasons, events, draft/publish, registration
- Tee sheets, group codes, tee-sheet emails
- Live scoring, two-person signing, commissioner reopen/edit with log
- Live leaderboard
- Formats: stroke play (gross/net with allowance), plus the formats used
  in the February and March events
- Points table, standings page with per-event breakdown

**Phase 2 — by the Masters (April)**
- Remaining formats (of best ball, shamble, Stableford, quota, forward
  tee, 4-club)
- Multi-round events (36-hole majors; 54-hole Championship)
- Ryder Cup 6-6-6
- Individual and team match-play brackets
- Season Championship qualification (top 8)

**Phase 3 — end of 2027**
- Installable phone app; push notifications.

## 10. Left to the builder

- Data model and table design.
- UI layout and visual design (mobile-first, clean, legible outdoors).
- Exact sync/conflict handling for offline scoring (single scorer
  simplifies this).
- Email templates.
- Code format (short, easy to type, e.g. 6 characters).
