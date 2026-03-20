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

## Lint

```bash
npm run lint
```
