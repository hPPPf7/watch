# Watch

Next.js app for watchlist/history tracking.

## Stack
- Next.js
- Auth.js (`next-auth`)
- Neon Postgres
- Drizzle ORM

## Environment variables

Required:
- `AUTH_SECRET`
- `AUTH_GOOGLE_ID`
- `AUTH_GOOGLE_SECRET`
- `DATABASE_URL`

Optional:
- `TMDB_API_KEY`
- `REDIS_URL` for true realtime watchlist events and friend notice updates via Redis Pub/Sub. If omitted, the app falls back to the existing polling paths.

## Install

```bash
npm install
```

## Run

```bash
npm run dev
```

## Desktop

The desktop build is an Electron shell for the existing site. It loads
`https://watch.han-burger.com` by default, so users keep the same account and
the same Neon-backed data as the web version.

```bash
npm run desktop:dev
```

For local testing against a dev server:

```bash
$env:WATCH_DESKTOP_URL="http://localhost:3000"; npm run desktop:dev
```

Local packaged builds can skip the production update gate while testing:

```bash
$env:WATCH_DESKTOP_SKIP_UPDATE_CHECK="1"; .\dist-desktop\win-unpacked\Watch.exe
```

Create a Windows installer:

```bash
npm run desktop:dist
```

Publish the generated installer and update metadata from `dist-desktop` to a
GitHub Release. Packaged desktop builds check GitHub Releases on startup before
loading `https://watch.han-burger.com`; if the app is offline or update checking
fails, the website is not loaded. When an update is available, it is downloaded,
installed, and relaunched before users can continue.

Remote site content runs in an isolated, sandboxed BrowserView. Desktop caching
uses Electron/Chromium's normal HTTP cache for loaded assets and a main-process
API cache for selected signed-in watchlist responses. The API cache is scoped by
the signed-in `userId`, validates watchlist entries with `/api/watchlist/revision`
before serving cached data, and refreshes the affected watchlist scope in the
background after watchlist/history mutations. Auth changes clear the desktop API
cache. Do not reintroduce renderer-level API monkey patching for user-data
caches.

On Windows, Electron stores these caches under the app data directory, usually:

```text
%APPDATA%\Watch\
```

Chromium-managed images and HTTP assets are stored in that Electron profile's
cache folders. The desktop API cache is stored under:

```text
%APPDATA%\Watch\api-cache\
```

Watchlist API responses can include TMDB metadata, so cached entries are capped
at 180 days from the original network fetch.

Homepage TMDB recommendation lists expire at the next 05:00 Asia/Taipei refresh
window instead of 24 hours after the previous fetch.

## Lint

```bash
npm run lint
```
