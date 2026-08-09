# Finance Dashboard — go live

Same process as Miles Dashboard, Portfolio Command Center and Wedding Dashboard:
**private GitHub repo → GitHub Actions → Cloudflare Pages**.

**Live URL: https://finance-dashboard-153.pages.dev**

> Cloudflare appended `-153` because `finance-dashboard.pages.dev` was already claimed by
> another account — `pages.dev` subdomains are globally unique. The *project* is still named
> `finance-dashboard`, which is what `wrangler.toml`, `package.json` and the GitHub workflow
> all reference. Don't "fix" those to match the URL.

Working copy lives at `~/Projects/finance-dashboard` — **outside iCloud**, because iCloud
sync corrupts git repos. The copy in the Cowork folder is staging only; don't run git there.

Run everything from this folder.

```bash
cd "$HOME/Library/Mobile Documents/com~apple~CloudDocs/Joseph CoWork/Finance Dashboard"
```

---

## Step 1 — Local check

```bash
npm install
npm run build
npm run dev          # http://localhost:4124
```

You should see the dashboard rendering from `data/finance.json` — no figures are hardcoded
in `index.html` any more.

---

## Step 2 — Private GitHub repo

```bash
git init -b main
git add .
git commit -m "Finance dashboard: initial commit"
```

With the GitHub CLI:

```bash
gh repo create finance-dashboard --private --source=. --remote=origin --push
```

Without `gh`: create an empty **private** repo named `finance-dashboard` at
https://github.com/new (no README, no .gitignore), then:

```bash
git remote add origin https://github.com/<your-username>/finance-dashboard.git
git push -u origin main
```

Sanity check that build output and secrets aren't tracked:

```bash
git ls-files | grep -E "dist/|\.env|\.dev\.vars"   # should print nothing
```

---

## Step 3 — Cloudflare Pages project

One-time browser auth (skip if you're still logged in from the Miles deploy):

```bash
npx wrangler login
```

First deploy — this creates the project:

```bash
npm run deploy
```

Returns `https://finance-dashboard-153.pages.dev`. That's it live.

---

## Step 4 — Auto-deploy on push

`.github/workflows/deploy.yml` is already in the repo — same workflow as Miles Dashboard.
It needs the same two secrets.

**API token:** Cloudflare dashboard → profile menu → **API Tokens** → *Create Token* →
**Custom token**:

| Field | Value |
|---|---|
| Permissions | `Account` · `Cloudflare Pages` · **Edit** |
| Account Resources | Include → your account |

Shown once — copy it.

**Account ID:** Cloudflare dashboard → Workers & Pages overview → **Account ID**, right sidebar.

*(If you reuse the token from the Miles repo, it already has Pages:Edit across the account —
same token works. You still have to add it to this repo's secrets; GitHub secrets don't
carry across repos.)*

**Add to GitHub:** repo → *Settings* → *Secrets and variables* → *Actions* → *New repository secret*:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Test:

```bash
git commit --allow-empty -m "trigger deploy" && git push
```

Watch the **Actions** tab. Green = every future push to `main` ships automatically.

---

## Monthly refresh

Only `data/finance.json` changes. The workbook stays the source of truth:

**Google Drive → "My Income & Expenses"** → **Monthly Overview** tab + **Annual Overview** tab,
**January 2026 onwards only**. The Monthly Budget tab is not a source and must not be read
(Joseph, 9 Aug 2026). Salary, CPF, goal amounts and liabilities are confirmed figures held in
`finance.json`, not sheet reads.
→ figures land in `data/finance.json` → push → live in ~40 seconds.

```bash
git add data/finance.json
git commit -m "Finance: <Month Year> figures"
git push
```

---

## Structure

| File | Role |
|---|---|
| `index.html` | Template + renderer (Finance Intern). Contains **no figures**. |
| `functions/_middleware.js` | Server-side PIN gate. Runs before every request, including `/data/finance.json`. |
| `.dev.vars` | Local secrets. **Gitignored — never commit.** |
| `data/finance.json` | Every number, sourced from the Drive workbook. The only monthly diff. |
| `wrangler.toml` | Pages project config (`finance-dashboard`, builds from `dist/`). |
| `package.json` | `dev` / `build` / `deploy` scripts. |
| `.github/workflows/deploy.yml` | Push to `main` → Pages deploy. |
| `.gitignore` | Keeps `dist/`, `.env`, `.dev.vars`, `node_modules/` out of git. |

---

## The login gate — server-side PIN

The dashboard is behind a real PIN check enforced by Cloudflare Pages Functions.
`functions/_middleware.js` runs in front of **every** request — `/`, HTML, JS, CSS and
`/data/finance.json` — and calls `context.next()` only once a valid session cookie is present.
An unauthenticated request to the JSON gets the login screen with a `401`, not your data.

### Required secrets

Set both in **Workers & Pages → finance-dashboard → Settings → Variables and Secrets**,
type **Secret** (encrypted), for the **Production** environment (and Preview if you use it):

| Name | Value |
|---|---|
| `FINANCE_PIN` | Your 4-digit PIN. The login screen draws one dot per digit, so a 4-digit PIN keeps the original design. Longer works — you just get more dots. |
| `SESSION_SECRET` | A long random string used to sign the session cookie. Generate one with `openssl rand -base64 48`. Changing it invalidates every existing session. |

Neither value is ever sent to the browser, written to `finance.json`, committed to git, or
placed in `wrangler.toml`. The only thing the login page discloses is how many digits to draw.

**If either secret is missing the site returns 503 and serves nothing.** It fails closed on
purpose — a misconfiguration must not silently make the dashboard public.

### How the session works

- `POST /__auth/login` with `{"pin":"…"}` → compared server-side against `FINANCE_PIN` using a
  constant-time digest comparison.
- Correct → `Set-Cookie: fi_session=<payload>.<HMAC-SHA256>; HttpOnly; Secure; SameSite=Strict;
  Path=/; Max-Age=604800` (7 days).
- Wrong → `401 {"error":"Incorrect passcode."}`. The response never reveals the PIN or its value.
- `POST /__auth/logout` clears the cookie. The **Sign out** link in the dashboard header calls it.

### Rate limiting

Per-IP attempt counters live in the Cache API — no KV, D1 or other infrastructure. Failed
attempts get an exponential delay (250 ms doubling to a 4 s cap) and the 8th attempt within
15 minutes returns `429` until the window expires.

This is **best effort**: the Cache API is per-datacentre and evictable, and an attacker with
many IPs gets more attempts. With a 4-digit PIN (10,000 combinations) the delay is doing real
work — if you want more margin, use a 6-digit PIN and the screen will render 6 dots.

### Local development

`.dev.vars` holds the local values and is gitignored — never commit it. Use throwaway
values here; they must not match the production secrets:

```
FINANCE_PIN="0000"          # any 4 digits, local only
SESSION_SECRET="anything-long-and-random-local-only"
```

```bash
npm run dev            # wrangler pages dev — runs the middleware, port 4124
```

`npm run dev:static` still serves the raw files with Python, but that bypasses the middleware
entirely, so use it only for pure layout work.

### Verifying it after deploy

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://finance-dashboard-153.pages.dev/data/finance.json
```

`401` means the gate is live. `200` means it is still public — check the secrets are set on the
**Production** environment and redeploy.
