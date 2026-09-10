# KGROUP Sales Performance Platform

Kgroup is a static HTML/CSS/JavaScript sales platform hosted by Netlify. In real-account mode, browser requests go to same-origin Netlify Functions; only those Functions connect to Neon PostgreSQL. In demo mode, the application continues to use local data from `data.js`.

## Installation

Install Node.js 20 or newer, then run:

```text
npm install
```

Copy `.env.example` to `.env` and supply the required server-side values. Do not commit `.env`, and never put its values in frontend JavaScript.

## Development

```text
npm run migrate
npm run dev
```

Use the URL printed by Netlify CLI. It serves both the static frontend and `/api/*` Functions routes. The direct static site has no database access by design.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes for real accounts | Neon PostgreSQL connection, read only by Functions |
| `APP_URL` | Yes for production email links | Public Netlify application URL |
| `SESSION_COOKIE_NAME` | No | Session-cookie name |
| `SESSION_TTL_DAYS` | No | Session lifetime; defaults to 14 |
| `RESEND_API_KEY` | Yes for email flows | Resend API key, used only by Functions |
| `EMAIL_FROM` | Yes for email flows | Verified sender address |
| `GOOGLE_CLIENT_ID` | Optional | Reserved for future Google OAuth setup |
| `GOOGLE_CLIENT_SECRET` | Optional | Reserved for future Google OAuth setup |

## Neon database

Run `npm run migrate` once with `DATABASE_URL` available in the shell. It creates users, teams, salespersons, sales, challenges, session, email-token and challenge-participant tables, relations, indexes and the sale-rollup trigger.

The schema deliberately starts with no migrated Supabase users. Existing business records are not imported or deleted by this migration. Export them first if they must be retained.

## Authentication

Email/password accounts use scrypt password hashing, server-stored opaque sessions and HttpOnly cookies. New accounts must confirm their email before they can sign in. Password reset and confirmation links expire after one hour.

Email delivery uses Resend when `RESEND_API_KEY` and `EMAIL_FROM` are configured. Until those are set, the API keeps accounts unverified instead of pretending that email was sent.

## Google OAuth

Google OAuth remains intentionally disabled: the previous project did not include a Google Cloud OAuth client, client secret or authorised callback URL. Email/password login works independently.

To enable it in a later release, create a Google Cloud OAuth web client, register the exact production callback URL, configure the consent screen, then store the client ID and secret exclusively in Netlify Function variables. Do not place either value in `api.js` or any HTML file.

## Demo mode

On `login.html`, select **Use demo mode**. It persists a local-only flag and preserves the original sample dashboards, sales, rankings, reports and navigation. Select **Use real accounts** to return to API-backed authentication.

## Deploying to Netlify

1. Connect the repository to Netlify.
2. Set the Functions environment variables in the Netlify UI, including `DATABASE_URL`, `APP_URL`, `RESEND_API_KEY` and `EMAIL_FROM`.
3. Run the Neon migration from a trusted local environment with the same database.
4. Deploy. Netlify serves the site root and routes `/api/*` to `netlify/functions/api.mjs`.

The database URL must be scoped to Functions and never to the browser/runtime configuration.
