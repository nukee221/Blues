# Huntsville Golf Tour: runbook

For the person deploying the app (parts 1 to 5) and the commissioners (parts 6 to 8). Plain steps, nothing clever.

## 1. Create the Supabase project

1. Sign up at supabase.com and create a new project. Pick a region near Alabama (US East). Save the database password somewhere safe.
2. Note the **project ref**: in the dashboard open **Project Settings > General**, it is the "Reference ID" (also the first part of your project URL, `https://<ref>.supabase.co`).
3. Open **Project Settings > API**. Copy three values: the **Project URL**, the **anon (public) key** and the **service_role key**. The service_role key is a master key: only ever put it in Vercel, never in chat, email or git.

## 2. Set up the database

**2a. Migrations** (the tables and security rules). From a computer with this repo and Node 22:

```
npx supabase@2 login
npx supabase@2 link --project-ref <your project ref>      # asks for the database password from step 1
npx supabase@2 db push
```

This applies `supabase/migrations/0001` to `0007`. It creates empty tables only: **no season, no points tables, no course and no players**, and `db push` never runs `seed.sql`.

**2b. Starting data, once.** Open the Supabase dashboard, **SQL Editor > New query**, paste the whole of `supabase/seed-production.sql` and press **Run**. It adds Cherokee Ridge Country Club (blue tee), the 2027 season and that season's three points tables (regular, match play, major). If you run it twice it stops with "The 2027 season already exists" and changes nothing.

Do **not** run `supabase/seed.sql` on the real project: it is test data with 12 fake players (`player01@example.test` to `player12@example.test`). The app has no screen for creating a season, so a new season (2028 and later) is also added in the SQL editor, see "Next season" at the end.

**2c. The first commissioner, once.** Nobody can sign in until they are on the players list, and only a commissioner can add players, so the first one is added by hand. In the SQL editor, edit the three marked values and run:

```sql
-- EDIT: your real name, the email you will sign in with, your handicap index
-- (a plus handicap is negative here: +1.2 is -1.2).
insert into public.players (name, email, handicap_index, handicap_source, is_commissioner)
values ('YOUR NAME', 'you@yourdomain.com', 8.4, 'GHIN', true);
```

Everything else (the other two commissioners, the roster, more courses and tees) is then done in the app (parts 5 and 6).

## 3. Environment variables (Vercel)

Import the repo into Vercel, set the **Root Directory** to `apps/web`, (leave "Include source files outside of the Root Directory" on, the app uses the `packages/scoring` folder), then add these under **Settings > Environment Variables** (Production):

| Name | What it is for |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | The Project URL from step 1. Used by browsers and the server. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The anon key. Safe to be public; the database security rules protect the data. |
| `SUPABASE_SERVICE_ROLE_KEY` | The service_role key. Server only. Lets the app do commissioner writes and link accounts. Never expose it. |
| `RESEND_API_KEY` | API key from resend.com. Sends tee sheets and match-card emails. |
| `MAIL_FROM` | The "from" line, e.g. `Huntsville Golf Tour <noreply@yourdomain.com>`. Must be on the domain you verify in Resend (part 4). |
| `APP_URL` | The public address of the app with no trailing slash, e.g. `https://golf.yourdomain.com`. Used in the links inside emails. |
| `GOLFCOURSE_API_KEY` | Optional. A key from golfcourseapi.com that turns on "Look up a course" on the admin course page. The free plan allows about 35 requests a day (each Search or Load tees tap is one), and the key is personal to the account that signed up for it. Without it the lookup shows "not set up" and you type courses in by hand as before. Server only; never exposed to the browser. |
| `CRON_SECRET` | A long random password you make up (for example 40 random letters and numbers). The Supabase timer (below) sends it with each call, so nobody else can trigger the reminders. Without it automatic reminders never send (the Send button still works). |
| `MAILER` | Optional. Leave it unset in production. `MAILER=fake` turns email off (nothing is sent, nothing is stored); use it only for tests. If it is unset and `RESEND_API_KEY` is missing, production refuses to send rather than silently dropping mail. |

`NEXT_PUBLIC_*` values are baked in at build time: change one, then redeploy.

**Evening-before reminders (one-time setup).** Each event's admin page has a **Reminders** box: send automatically the evening before each round at a time you pick (6:00 PM by default), or only when you tap **Send reminder now**. The automatic ones need a timer that calls the app every 15 minutes. Supabase has one built in (free):

1. In Supabase, **Database > Extensions**: turn on **pg_cron** and **pg_net**.
2. **SQL Editor > New query**, paste this with your `APP_URL` and `CRON_SECRET` filled in, and **Run**:

   ```sql
   select cron.schedule(
     'hgt-reminders',
     '*/15 * * * *',
     $$ select net.http_get(
          url := 'https://golf.yourdomain.com/api/cron/reminders',
          headers := jsonb_build_object('Authorization', 'Bearer YOUR-CRON-SECRET')
        ) $$
   );
   ```

3. To check it: `select * from cron.job_run_details order by start_time desc limit 5;` shows each run. To change the secret later, run `select cron.unschedule('hgt-reminders');` and step 2 again.

A reminder goes to everyone playing that round (the grouped players with their tee time once the tee sheet is out, otherwise every registered player), once per round; **Send again** on the admin page re-sends on purpose.

Deploy. Then in Supabase **Authentication > URL Configuration**:

- **Site URL**: the same value as `APP_URL`.
- **Redirect URLs**: add `APP_URL/auth/callback` (for example `https://golf.yourdomain.com/auth/callback`). Sign-in links fail without this.

## 4. Email: Resend domain and Supabase SMTP

Two kinds of email: the app's own (tee sheets, match cards, sent through Resend with `RESEND_API_KEY`) and Supabase's sign-in magic links (sent by Supabase). Set up both on your domain, otherwise sign-in emails come from a shared address with a very low limit.

1. In Resend, **Domains > Add domain**, add the DNS records it shows at your domain host, wait until it says Verified.
2. Create an API key in Resend (step for `RESEND_API_KEY`).
3. In Supabase **Authentication > Emails > SMTP Settings**, turn on custom SMTP: host `smtp.resend.com`, port `465`, username `resend`, password = your Resend API key, sender = an address on the verified domain.
4. Test: open the app, enter a roster email, and check the sign-in link arrives and lands you in the app.

## 5. Checks after deploying

- Open the site on a phone and enter your commissioner email. You get a sign-in link; tap it and you land on **Events**. Tap **Admin** at the bottom.
- Only emails on the players list can sign in. Anyone else is sent back to the sign-in page with "Ask a commissioner to add you."
- Supabase's built-in email sender allows only a few emails per hour: finish part 4 before inviting everyone.

## 6. Adding the other commissioners and the roster

Signed in as the first commissioner, open **Admin > Players**:

1. Add each person: name, the email they will sign in with, handicap index (type a plus handicap as `+2.1`) and source. Tick **Commissioner** for the other two commissioners. You can also paste a whole list of "name, index" lines to update handicaps.
2. Each person signs in once with that email; the account then links to their player. They can set their signing PIN under **Me > PIN**.
3. The app will not let you remove the last commissioner.

Courses and tees are added under **Admin > Courses** (Cherokee Ridge is already there from step 2b).

## 7. Check the points table (do this once per season)

`seed-production.sql` uses a FedExCup style table for a 500 point event (1st 500, 2nd 300, 3rd 190, 4th 135, 5th 110 and so on), 750 for majors. It was typed in from memory, so **compare it with the PGA Tour's published table** before the season:

1. Open the PGA Tour's current FedExCup points distribution page and find the column for the winner's points you use.
2. In the app go to **Admin > 2027 points & finalize** for the season and compare every place, 1st down to the last row.
3. Fix any row that differs and save. The app lists each change. Events already final keep their points until you press **Recalculate** on them.

Ties share the average of the places they cover (two players tied 3rd get the average of 3rd and 4th).

## 8. Event day checklist

Before: the event is **draft** until you are ready.

1. **Publish** the event (Admin > Events). Players can now see it and register until the registration deadline. Tell the group chat.
2. **Close registration** when the deadline passes. You can still add or remove people under Registered on the event page.
3. **Groups and tee sheet**: open *Round 1 groups*, tap **Auto-group**, set the first tee time, adjust by tapping a player and *Move*, choose a **scorer** for each group, **Save groups**, then **Send tee sheet**. Each player gets an email with their group code. The event moves to *in progress*. Resending is safe; codes do not change.
4. **During the round**: the scorer opens `/c/CODE` (or the **Code** tab), taps "keep score on this phone" and enters scores. Everyone else sees live scores. If a scorer's phone dies (or on a 36-hole day the group wants a different scorer), the group can do it themselves: on any phone with the card open, tap **Take over scoring**, pick your name and enter your own 4-digit PIN; that phone becomes the scorer. The old phone turns read-only and lists any scores it had not sent, so they can be re-entered. You can still open the group in the tee sheet and tap **Free scorer phone** (for example when nobody has a PIN).
5. **Watch unsigned cards**: the event page lists *Unsigned cards*. A card is signed by the scorer and one other player, each with their 4-digit PIN (set under **Me > PIN**). If someone has no PIN or forgot it, open the card and sign for them (audited). A player who did not play: mark them **WD** on the card so the card can finish.
6. **Close the play-in** (Admin > Match-play bracket > Close play-in) once every card is signed. The top players advance (top 6 up to 15 entrants, top 8 at 16 or more). If there is a tie for the last spot, you pick who advances.
7. **Draw the bracket**. It is random and cannot be redone. Byes go to the lucky ones.
8. **Matches, deadlines and forfeits**: set a deadline for each round on the bracket page. Either player in a match taps **Start match card** on the bracket page; the two players are emailed a code, play, and the opponent attests with a PIN. Signing records the winner. Matches past the deadline show in red: use **Award forfeit** when someone does not play.
9. **Finalize** the event once the final is decided. Points are awarded and show on **Standings**. If a result was wrong, reopen (audited), fix it and finalize again.

## Next season

There is no screen for creating a season. For 2028, in the SQL editor (this copies 2027's points tables; change the year in both places):

```sql
with s as (insert into public.seasons (year) values (2028) returning id)
insert into public.points_tables (season_id, event_type, winner_points, table_values)
select s.id, p.event_type, p.winner_points, p.table_values
from s, public.points_tables p
join public.seasons old on old.id = p.season_id and old.year = 2027;
```

## Rules the tour has confirmed

- **The play-in cut counts registered players**, including no-shows and withdrawals (WD): top 6 advance, or top 8 when 16 or more are registered.
- **A commissioner may sign for both players** on a card (scorer and attester). Each such signature is logged in the audit log.
- **Event settings and course numbers can be corrected after play has started.** Change them on the event or course page. If the change affects results already recorded (handicap mode, allowance, handicap basis, match strokes, format, event type, a round's tee or kind, or a tee's rating, slope, par or a hole's par or stroke index under a signed card), the app asks you to confirm first and writes a before/after row to the audit log. Handicaps already locked in on sent tee sheets stay as they were. On a final event, afterwards open **Admin > (year) points & finalize** (a *Recalculate points* link appears after saving) and tap **Recalculate** on the event so the points follow the corrected results.
- **The group can change scorers itself** with **Take over scoring** + PIN (see event day, step 4).

## Operating cautions

- **Supabase free tier pauses a project after 7 idle days.** A paused project means the app cannot log in or load anything until you restore it. Use the paid plan during the season, or set up a keep-alive: a scheduled request (an uptime monitor, once a day) to a page that reads the database, such as `/standings`.
- **Do not deploy during a live round.** Open scorecards hold queued scores in the phone until they can send, and a new deploy changes the server action ids, so open pages must reload before their next save. Deploy before the first tee time or after the last card is signed.
- **Do not regroup after scoring starts.** Moving players between groups after scores exist is refused or leaves cards that do not match the people who played; fix a wrong group before sending the tee sheet, and use **WD** or the commissioner's score edit afterwards.

## Practical notes

- All dates and times are US Central.
- The commissioner can fix almost anything: edit a score, reopen a signed card, change registrations. Every such change is written to the audit log with who did it.
- Before a real event, do a dry run with a throwaway event and a few friends; delete nothing, just leave the event in draft.
- Running the automated rehearsal (developers only): start Supabase locally, `npx supabase@2 db reset`, then `pnpm e2e` from the repo root.
