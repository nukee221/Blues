# Huntsville Golf Tour: runbook

For the person deploying the app (parts 1 to 5) and the commissioners (parts 6 to 8). Plain steps, nothing clever.

## 1. Create the Supabase project

1. Sign up at supabase.com and create a new project. Pick a region near Alabama (US East). Save the database password somewhere safe.
2. In the project, open **Project Settings > API**. Copy three values: the **Project URL**, the **anon (public) key** and the **service_role key**. The service_role key is a master key: only ever put it in Vercel, never in chat, email or git.

## 2. Run the migrations

From a computer with this repo and Node 22:

```
npx supabase@2 login
npx supabase@2 link --project-ref <your project ref>
npx supabase@2 db push
```

This applies `supabase/migrations/0001` to `0007` (tables, security rules, signing, PIN lockout, live scores, withdrawals).

**Do not run `supabase/seed.sql` on the real project as is.** It is test data: Cherokee Ridge Country Club (blue tees), a 2027 season with the points tables, and 12 fake players (`player01@example.test` to `player12@example.test`, the first three are commissioners). For the real tour:

- Keep the course and season rows if they are right, or add your own under **Admin > Courses** and in the database.
- Replace the fake players with your real roster (name, real email, handicap index) under **Admin > Players**, or by editing the insert in a copy of `seed.sql` before running it once.
- Make sure at least one real commissioner exists before anyone logs in (part 6).

## 3. Environment variables (Vercel)

Import the repo into Vercel, set the **Root Directory** to `apps/web`, then add these under **Settings > Environment Variables** (Production):

| Name | What it is for |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | The Project URL from step 1. Used by browsers and the server. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The anon key. Safe to be public; the database security rules protect the data. |
| `SUPABASE_SERVICE_ROLE_KEY` | The service_role key. Server only. Lets the app do commissioner writes and link accounts. Never expose it. |
| `RESEND_API_KEY` | API key from resend.com. Sends tee sheets and match-card emails. |
| `MAIL_FROM` | The "from" line, e.g. `Huntsville Golf Tour <noreply@yourdomain.com>`. Must be on the domain you verify in Resend (part 4). |
| `APP_URL` | The public address of the app with no trailing slash, e.g. `https://golf.yourdomain.com`. Used in the links inside emails. |
| `MAILER` | Optional. Leave it unset in production. `MAILER=fake` turns email off (nothing is sent, nothing is stored); use it only for tests. If it is unset and `RESEND_API_KEY` is missing, production refuses to send rather than silently dropping mail. |

`NEXT_PUBLIC_*` values are baked in at build time: change one, then redeploy.

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

- Open the site on a phone, sign in with a commissioner email, open **Admin**.
- Only emails that exist in the players list can sign in. Anyone else sees "not on the roster".

## 6. Adding the three commissioners

1. **Admin > Players**: add each person (real email, handicap index) and tick **Commissioner**. An existing commissioner has to do this. For the very first one, in the Supabase **SQL editor** run:
   `update players set is_commissioner = true where email = 'you@example.com';`
2. Each commissioner signs in once with that email so the account links to the player. The app will not remove the last commissioner.

## 7. Check the points table (do this once per season)

The seed uses a FedExCup style table for a 500 point event (1st 500, 2nd 300, 3rd 190, 4th 135, 5th 110 and so on), 750 for majors. It was typed in from memory, so **compare it with the PGA Tour's published table** before the season:

1. Open the PGA Tour's current FedExCup points distribution page and find the column for the winner's points you use.
2. In the app go to **Admin > Season points** for the season and compare every place, 1st down to the last row.
3. Fix any row that differs and save. The app lists each change. Events already final keep their points until you press **Recalculate** on them.

Ties share the average of the places they cover (two players tied 3rd get the average of 3rd and 4th).

## 8. Event day checklist

Before: the event is **draft** until you are ready.

1. **Publish** the event (Admin > Events). Players can now see it and register until the registration deadline. Tell the group chat.
2. **Close registration** when the deadline passes. You can still add or remove people under Registered on the event page.
3. **Groups and tee sheet**: open *Round 1 groups*, tap **Auto-group**, set the first tee time, adjust by tapping a player and *Move*, choose a **scorer** for each group, **Save groups**, then **Send tee sheet**. Each player gets an email with their group code. The event moves to *in progress*. Resending is safe; codes do not change.
4. **During the round**: the scorer opens `/c/CODE` (or **Enter Code**), taps "keep score on this phone" and enters scores. Everyone else sees live scores. If a scorer's phone dies, open the group in the tee sheet and tap **Free scorer phone**.
5. **Watch unsigned cards**: the event page lists *Unsigned cards*. A card is signed by the scorer and one other player, each with their 4-digit PIN (set under **Me > PIN**). If someone has no PIN or forgot it, open the card and sign for them (audited). A player who did not play: mark them **WD** on the card so the card can finish.
6. **Close the play-in** (Admin > Match-play bracket > Close play-in) once every card is signed. The top players advance (top 6 up to 15 entrants, top 8 at 16 or more). If there is a tie for the last spot, you pick who advances.
7. **Draw the bracket**. It is random and cannot be redone. Byes go to the lucky ones.
8. **Matches, deadlines and forfeits**: set a deadline for each round on the bracket page. Either player in a match taps **Start match card** on the bracket page; the two players are emailed a code, play, and the opponent attests with a PIN. Signing records the winner. Matches past the deadline show in red: use **Award forfeit** when someone does not play.
9. **Finalize** the event once the final is decided. Points are awarded and show on **Standings**. If a result was wrong, reopen (audited), fix it and finalize again.

## Practical notes

- All dates and times are US Central.
- The commissioner can fix almost anything: edit a score, reopen a signed card, change registrations. Every such change is written to the audit log with who did it.
- Before a real event, do a dry run with a throwaway event and a few friends; delete nothing, just leave the event in draft.
- Running the automated rehearsal (developers only): start Supabase locally, `npx supabase@2 db reset`, then `pnpm e2e` from the repo root.
