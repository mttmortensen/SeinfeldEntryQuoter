# Quote Book (Seinfeld Entry Quoter)

A phone-first page for logging Seinfeld quotes while you watch. Plain HTML/CSS/JS, no build step.
It talks to [SeinfeldAPI](https://github.com/mttmortensen/SeinfeldAPI) (`/api/quotes` and `/api/episodes`).

## Run it

**1. One-time API setup** (in `SeinfeldAPI`)

- Add the unique index on episodes: run `SQL/add_episodes_unique_season_episode.sql` against your database.
- Create an empty `wwwroot` folder if there isn't one (`dotnet run` in Development crashes without it).

**2. Start the API** (listens on `http://localhost:5270`; CORS for localhost is on in Development)

```bash
cd ../SeinfeldAPI
dotnet run --launch-profile http
```

**3. Serve the frontend** (from this folder)

```bash
python -m http.server 5500 --bind 127.0.0.1
```

**4. Open** <http://localhost:5500> and sign in with your SeinfeldAPI account (`/api/auth/register` if you need one).

The API URL is set in `config.js`.

## Using it

- Set season/episode with the steppers (or type the number). They stay put between quotes.
- New episode? A dashed "Add episode title" box appears; **Add quote** unlocks once it has a title.
- Tap an existing title to rename it.
- Type the line, pick who said it, press **Enter** (Shift+Enter for a new line).
- "Just added" shows the last 5 quotes, with edit and delete (tap Delete twice).

Heads up: the API rate-limits to 5 requests per 10 seconds. The page will tell you if you hit it.
