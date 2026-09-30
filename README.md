# Quote Book (Seinfeld Entry Quoter)

A phone-first page for logging Seinfeld quotes while you watch. Plain HTML/CSS/JS, no build step.
It talks to [SeinfeldAPI](https://github.com/mttmortensen/SeinfeldAPI) (`/api/quotes` and `/api/episodes`).

## Run it

The page talks to the hosted API (`https://api.mortensens.cc/seinfeld/api`, set in `config.js`).

**1. Serve the page** (from this folder)

```bash
python -m http.server 5500 --bind 127.0.0.1
```

**2. Open** <http://localhost:5500> and sign in. Adding, editing and deleting need an **Admin** account.

### Using a local copy of the API instead

Change `apiBase` in `config.js` to `http://localhost:5270/seinfeld/api`, then from `SeinfeldAPI`
(create an empty `wwwroot` folder first if there isn't one; `dotnet run` in Development crashes without it):

```bash
dotnet run --launch-profile http
```

## Using it

- Set season/episode with the steppers (or type the number). They stay put between quotes.
- New episode? A dashed "Add episode title" box appears; **Add quote** unlocks once it has a title.
- Tap an existing title to rename it.
- Type the line, pick who said it, press **Enter** (Shift+Enter for a new line).
- "Just added" shows the last 5 quotes, with edit and delete (tap Delete twice).

Heads up: the API rate-limits to 5 requests per 10 seconds. The page will tell you if you hit it.
