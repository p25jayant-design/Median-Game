# Median Choice — a repeated median-guessing game

A small self-hosted web app for running the "guess a number, get paid based on
your group's median" game theory exercise in class. Students join with a
short code and no account; the instructor runs everything from a live
dashboard. Built as a static site on Firebase (Hosting + Firestore +
Anonymous Auth) — no server to run, no Cloud Functions, no billing plan
required beyond Firebase's free Spark tier for a normal class size.

## How the game works

- The instructor creates a game: total rounds (default 20), players per
  group (default 8), number of groups, and the payoff table.
- Students open the site, enter the game code and their name, and are
  auto-assigned to the first group with an open seat.
- Each round, every player privately picks a number from 1–14. Once all
  players in a group have chosen, the group's **median** is computed,
  rounded to the nearest whole number (since an 8-person group's median can
  land on a half-value like 6.5), and every player is paid according to
  the payoff table for *(their choice, the group's median)*.
- Scores accumulate over all rounds. By default the next round starts the
  instant a group finishes submitting; the instructor can turn that off and
  advance rounds manually instead, and can pause the whole game, force a
  stuck round to resolve, or remove a no-show player at any time.

## The payoff table

`payoff-table.js` contains the 14×14 table transcribed from the
handout you photographed. One cell — **choice 14, median 14**, the
bottom-right corner — sat on a torn edge of the page and couldn't be read
with certainty; it's currently set to `12.0` as a best estimate from the
surrounding pattern. Before you run the game for real:

1. Go to the instructor console → **Review / edit payoff table** (when
   creating a game) or **Edit** in the dashboard's Payoff table panel.
2. Check that cell against your original handout and correct it if needed.

You can also just edit the numbers directly in `payoff-table.js` if you'd
rather fix it once in the source.

## 1. Create the Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com/) → **Add project**.
2. Once created, click the **web** icon (`</>`) to register a web app. Skip
   Firebase Hosting setup in that wizard — we'll do it from the CLI.
3. Copy the `firebaseConfig` object it shows you into
   `firebase-config.js`, replacing the placeholder values.
4. In the left sidebar, go to **Build → Authentication → Get started**, open
   the **Sign-in method** tab, and enable **Anonymous**.
5. Go to **Build → Firestore Database → Create database**. Choose
   **Production mode** (the rules file in this project supplies the actual
   access rules) and any region close to your class.

## 2. Install the Firebase CLI and deploy

You'll need [Node.js](https://nodejs.org/) installed first.

```bash
npm install -g firebase-tools
firebase login

cd median-game   # the folder containing index.html, firebase.json, etc.
firebase use --add        # pick the project you just created
firebase deploy --only firestore:rules,hosting
```

That's it — the CLI will print a `hosting URL` (something like
`https://your-project.web.app`). That's the link for both students and the
instructor.

To make changes later (e.g. after editing the payoff table in
`payoff-table.js`, or tweaking styles), just re-run:

```bash
firebase deploy --only hosting
```

### Testing locally first (optional)

```bash
firebase emulators:start --only firestore,hosting
```

This serves the site at `http://localhost:5000` against a local Firestore
emulator — handy for a dry run with a few browser tabs standing in for
students before you deploy for real.

## 3. Running it in class

1. Open `<your-url>/admin.html`, fill in the game settings, set an **admin
   passcode** (lets you reopen the same dashboard from a different laptop —
   see the security note below), and click **Create game**. You're taken
   straight to the live dashboard.
2. Share the game code (and/or the link `<your-url>/join.html?code=XXXXX`,
   which pre-fills the code) with the class.
3. Watch students fill up the group cards on the dashboard as they join.
4. Click **Start game** when you're ready for round 1.
5. The dashboard shows each group's live submission count, current round,
   and (once resolved) the group's median. Use **Force resolve** if a
   student is absent and a group is stuck waiting on one more submission,
   or **Advance round** if you turned off auto-resolve and want to control
   pacing manually — e.g. to discuss a round's outcome with the class before
   moving on.
6. **Pause** stops new submissions without losing any state; **End game**
   closes it out for everyone.
7. **Export results (CSV)** on the dashboard downloads every player's
   round-by-round choices, medians and payoffs plus running totals.

## Alternative: host on Vercel instead of Firebase Hosting

Firestore + Anonymous Auth (the backend) always live in Firebase regardless
of where the static files are served from. Every file in this project sits
at a single flat level on purpose — no `public/`, `css/`, or `js/`
subfolders — so it deploys correctly no matter how it lands on GitHub,
including via GitHub's drag-and-drop web uploader (which often flattens
folder structure anyway). To host on Vercel: push this repo to GitHub,
import it at vercel.com/new (no build command or output directory needed —
it's already flat, so Vercel serves it as-is), deploy the Firestore rules
once with the Firebase CLI (`firebase deploy --only firestore:rules`), and
add your Vercel domain under Firebase Console → Authentication → Settings
→ Authorized domains.

## Project structure

Everything is flat — one directory, no subfolders — so it survives being
uploaded any which way:

```
firebase.json            Hosting + Firestore config
firestore.rules          Security rules (see the trust-model note inside)
firestore.indexes.json   (empty — nothing here needs a composite index)
vercel.json              Vercel config (no build step needed)
index.html               Landing page
join.html / join.js      Student join flow
play.html / play.js      Student round-by-round game screen
admin.html / admin.js    Create-a-game / reopen-a-game
dashboard.html / dashboard.js  Live instructor dashboard
game-engine.js           All Firestore reads/writes/transactions
payoff-table.js          The 14×14 payoff table + median/lookup helpers
firebase-init.js         Firebase SDK bootstrap + anonymous sign-in
firebase-config.js       ← put your Firebase project keys here
util.js                  Small shared helpers
style.css                Styling
```

## Security model — please read before using this for anything high-stakes

This is built for the trust level of an in-class exercise, not a
high-stakes or graded-for-money deployment:

- Students never create an account — the app signs them in anonymously and
  they just type a display name, so nothing stops someone from joining
  twice under different names from different browsers.
- Whichever of the 8 group members' browsers gets there first computes and
  writes the whole group's payoffs for a round — there's no server
  double-checking the arithmetic. Firestore's security rules keep students
  from touching *other groups'* data or the payoff table itself, but a
  technically inclined student could, in principle, tamper with their own
  group's round data using the browser dev tools.
- The instructor's admin passcode is a convenience for reopening the
  dashboard on another device, not real secrecy — the game document (which
  includes the passcode) is readable by any signed-in participant. Don't
  reuse a passcode you care about.

If you need stronger guarantees, the natural next step is adding a Cloud
Function to validate round resolution server-side, which requires
upgrading the Firebase project to the pay-as-you-go Blaze plan (still free
at classroom scale, but requires a billing account on file).
