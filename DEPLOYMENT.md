# Deploying LowForce to a real URL

The app is one Node service (the backend serves the built frontend) plus a
PostgreSQL database. It's already production-ready: `PORT`, `DATABASE_URL`
and `SESSION_SECRET` come from environment variables, sessions live in
Postgres, and with `NODE_ENV=production` cookies become HTTPS-only behind the
host's proxy (`trust proxy` is set).

## Steps you must do yourself (account + payment)

1. Create an account at [railway.com](https://railway.com) (recommended, per the plan doc)
   or [render.com](https://render.com).
2. Push this repo to GitHub (create a private repo, then
   `git remote add origin <url> && git push -u origin main` — the local git
   repo and initial commit already exist).
3. In Railway: **New Project → Deploy from GitHub repo**, then **Add
   PostgreSQL** to the same project.

## Service configuration

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Start command | `npm start` |
| `DATABASE_URL` | reference the hosted Postgres (Railway injects `${{Postgres.DATABASE_URL}}`) |
| `SESSION_SECRET` | a fresh long random string — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `NODE_ENV` | `production` |

## One-time database setup (against the hosted database)

Run these locally with `DATABASE_URL` pointed at the hosted Postgres
(or via the host's SQL console):

```
psql "$HOSTED_DATABASE_URL" -f database/schema.sql
psql "$HOSTED_DATABASE_URL" -f database/seed.sql
cd backend
DATABASE_URL="$HOSTED_DATABASE_URL" node scripts/create-admin-user.js <email> <password> "<name>"
DATABASE_URL="$HOSTED_DATABASE_URL" node scripts/migrate-mifb26.js "<path-to-xlsm>"   # optional: real data
DATABASE_URL="$HOSTED_DATABASE_URL" node scripts/setup-mifb27.js                      # MIFB27 + price lists
```

## Custom domain

Add your domain in the host's settings (Railway/Render both issue HTTPS
certificates automatically), then point a CNAME at the URL they give you.
No code changes needed.

## Notes

- The local Windows PC setup (C:\pgsql, start-lowforce.cmd) keeps working
  independently — useful as a staging copy.
- The hosted database starts empty; nothing moves automatically. Decide at
  cutover time whether to re-run the migration scripts against it or export
  the local database (`pg_dump`).
