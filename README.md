# GuessMe

A live party guessing game. Players take turns in the "hot seat": one person secretly fills in a paper of categories (a place, a song, a number, a car, a food, a restaurant…), everyone else guesses their answers, then the answers are revealed and scored. Then the next player takes the hot seat.

## Features

- **Accounts**: sign up and log in with a username and password (passwords are hashed with scrypt).
- **Live rooms**: create a room, invite friends with a link or a short code. Everyone's screen updates live.
- **Turns**: the game rotates through every player. The hot-seat player's answers stay hidden from everyone until the reveal.
- **Game modes**: 1, 3 or 5 guesses per category. All guesses are typed and submitted at once; any one that matches scores the point.
- **180+ built-in categories** in 10 themes, a 🎲 "Surprise me" button, your own custom categories, and an option to deal a fresh random paper every turn.
- **Hot-seat player can add their own categories** to their paper before locking in.
- **Smart matching**: ignores case, accents, punctuation, "the/a/an", small typos, and number formats ("7" = "seven"). The hot-seat player or host can tap any guess to mark it right or wrong ("close enough!").
- **Scores**: per-round scores, a running leaderboard with each player's points, correct/total and accuracy, and past-turn history.
- **Stats dashboard**: guesses made, correct guesses, accuracy, days played, day streak, games played, papers guessed, turns in the hot seat, a 14-day activity chart, who knows you best, and who you know best.
- **Shareable**: invite links get rich link previews ("Naef invited you to play…"), the native share sheet on phones, and it can be added to a phone's home screen.
- Mobile-first design with light and dark mode.

## Run it on your computer

You need [Node.js](https://nodejs.org) 22.5 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000. To try multiplayer on one computer, open a second browser (or a private window) and sign up as another player.

Run the tests with `npm test`.

## Put it online

The app is one Node server with a SQLite database file, so it needs a host that keeps a **persistent disk** (otherwise accounts are wiped on each deploy).

**Render (easiest)**: push this folder to a GitHub repo, then in Render choose *New → Blueprint* and pick the repo. `render.yaml` sets everything up, including a 1 GB disk (the Starter plan, about $7/month, is needed for a disk).

**Railway**: create a project from the GitHub repo, add a Volume mounted at `/data`, and set the variable `DATA_DIR=/data`.

**Fly.io / any Docker host**: use the included `Dockerfile` and mount a volume at `/data`.

Once it's online, set up a custom domain in your host's settings so the invite links look nice.

## Settings (environment variables)

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `DATA_DIR` | `./data` | Folder for the SQLite database |
| `APP_NAME` | `GuessMe` | Game name shown in titles and link previews |
| `SIGNUP_LIMIT` / `LOGIN_LIMIT` | `30` | Attempts allowed per IP every 15 minutes |

To rename the game everywhere, set `APP_NAME` and change the name in `public/index.html` and `public/manifest.webmanifest`.

## How it's built

- `server.js`: Express API, sessions, game rules, live updates (Server-Sent Events), stats.
- `db.js`: SQLite schema using Node's built-in `node:sqlite` (no native modules to compile).
- `match.js`: the forgiving answer matcher.
- `categories.js`: the category bank.
- `public/`: the front end (plain HTML, CSS and JavaScript; no build step).
