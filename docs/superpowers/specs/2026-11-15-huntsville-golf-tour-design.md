# Huntsville Golf Tour — App Design

Date: 2026-11-15
Status: Draft, awaiting commissioner approval (updated 2026-11-16)

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
| Ryder Cup 6-6-6 | See Ryder Cup section |

- Stroke-based events: each player gets their own course handicap ×
  allowance.
- Match play: a per-event setting chooses **full strokes** (each player's
  own handicap) or **off the low player** (tour does both).
- *Builder's call:* allowance applied to course handicap, then rounded to
  the nearest whole stroke for hole allocation — except where an event is
  set to use **unrounded (2-decimal) net totals** (the Season Championship;
  see below).
- Teams for team formats: per event, either **commissioner-assigned** or
  **players register as a team**. Team size configurable (2 or 4); a tee
  group may hold more than one team.

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
  closes. Season points only qualify players; they don't carry into the
  Championship.

### Season Championship
- 54 holes, decided by **total net score**, to 2 decimal places.
  *Builder's interpretation:* net = gross − unrounded course handicap
  (index × slope/113 + rating − par, × allowance), so ties are rare.
- Ties are settled off-app (18-hole short-course match play, or a horse
  race for 3+ players). Commissioners record the tiebreak result and the
  app shows the final order.

### Match play (the February opener)
The season opens with an individual match-play event. Its structure:

1. **Play-in round.** Registered players play one qualifying round; the
   top finishers advance: **6 if 15 or fewer registered, 8 if 16 or more**
   (this threshold rule is configurable). *Builder's call:* the play-in is
   18-hole net stroke play; ties at the cut line are settled by a
   commissioner.
2. **Bracket.** Advancers are placed by **random draw** into a
   single-elimination bracket. Byes (e.g., 2 byes in a 6-player bracket)
   are also assigned by the draw.
3. **Scheduling.** Players arrange their own dates; each bracket round has
   a **deadline** set by commissioners. Each match gets its own code to
   open a live match scorecard ("2 UP thru 12"). Commissioners can also
   enter a result directly or award a forfeit if the deadline passes.
4. **Points.** Only players who advance from the play-in earn season
   points, by how far they go (configurable table: champion, runner-up,
   semifinal, quarterfinal, first round). Players who don't advance
   earn 0.

General match-play support:
- Individual and team match play (teams assigned or registered as teams).
- Bracket types: **single elimination**, and **pods then single
  elimination** (World Cup style — round-robin pods, top of each pod
  advances).
- Optional play-in qualifier.
- Strokes: full or off-the-low, per event.
- *Builder's call:* halved matches in elimination go to extra holes,
  recorded on the scorecard; in pods a halve is ½ point.

### Ryder Cup 6-6-6
- Two teams, 20–28 players total. Each **tee time is 2 vs 2** and is
  worth **4 points**:
  - Holes 1–6 **best ball** (2v2): 1 point.
  - Holes 7–12 **modified alt shot** (2v2): 1 point. Both players tee
    off; each ball is then played alternate shot until holed; the better
    of the team's two balls counts.
  - Holes 13–18 **singles**: two 1v1 matches, 1 point each.
  - Halved segment/match = ½ point each.
- **Captains' draft.** Two captains draft their teams in an app draft
  room (snake order: team 1 picks 1st, team 2 picks 2nd and 3rd, and so
  on).
- **Lineups.** The team with the first draft pick sends out its pairing
  for each tee time first; the other team then chooses which of its
  pairings to send against it, and chooses the singles matchups for holes
  13–18. The app runs this as turn-by-turn, hidden-until-submitted lineup
  entry for the captains.
- Live team score (e.g., "Team A 22½ – Team B 17½").
- *Builder's call, needs confirming:* season points from the Ryder Cup
  are awarded per player as **season points per match point earned**,
  plus a configurable bonus for members of the winning team.

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

**Phase 1 — February opener (match play)**
- Courses, tees, holes; players and handicap indexes (with bulk update)
- Seasons, events, draft/publish, registration
- Tee sheets, group codes, tee-sheet emails
- Live scoring, two-person signing, commissioner reopen/edit with log
- Live leaderboard
- Net stroke play (for the play-in)
- Individual match play: play-in cut (6/8 rule), random-draw single
  elimination bracket with byes, player-scheduled matches with round
  deadlines, live match scorecard, forfeits
- Points table, standings page with per-event breakdown

**Phase 2 — by the Masters (April)**
- Formats: best ball, shamble, Stableford, quota, forward tee, 4-club
  (individual and team)
- Multi-round events (36-hole majors)
- Team match play; pods + elimination brackets
- Ryder Cup 6-6-6 with draft room and lineups (if the Ryder Cup falls
  after April, it can move to Phase 2b)

**Phase 2b — before the Championship**
- 54-hole Season Championship, top-8 qualification, unrounded net
  totals, tiebreak recording

**Phase 3 — end of 2027**
- Installable phone app; push notifications.

## 10. Left to the builder

- Data model and table design.
- UI layout and visual design (mobile-first, clean, legible outdoors).
- Exact sync/conflict handling for offline scoring (single scorer
  simplifies this).
- Email templates.
- Code format (short, easy to type, e.g. 6 characters).
