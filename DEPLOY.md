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

**Google Drive → "My Income & Expenses"** → Transactions tab + Monthly Budget tab
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
| `index.html` | Template + renderer (Command Centre). Contains **no figures**. |
| `index.legacy.html` | The original monthly-report renderer, kept verbatim. Linked from the footer. |
| `data/finance.json` | Every number, sourced from the Drive workbook. The only monthly diff. |
| `wrangler.toml` | Pages project config (`finance-dashboard`, builds from `dist/`). |
| `package.json` | `dev` / `build` / `deploy` scripts. |
| `.github/workflows/deploy.yml` | Push to `main` → Pages deploy. |
| `.gitignore` | Keeps `dist/`, `.env`, `.dev.vars`, `node_modules/` out of git. |

---

## Appendix — adding a login gate later (optional)

Your other three dashboards are open on `pages.dev` and that's fine — card data, wedding
logistics and tickers aren't sensitive. This one shows your and Melissa's actual salaries,
CPF and bills, and a `pages.dev` URL is reachable by anyone who has the link. Worth knowing;
your call whether it matters.

If you ever want to gate it, **Cloudflare Access** is the tool, and it needs a custom domain
on a Cloudflare zone — Access can't attach to a bare `pages.dev` hostname. That's the only
reason a domain enters the picture; it has nothing to do with publishing.

1. **Workers & Pages → finance-dashboard → Custom domains** → add e.g. `finance.yourdomain.com`.
2. **Zero Trust → Access → Applications** → *Add an application* → **Self-hosted**, hostname
   `finance.yourdomain.com`.
3. Policy: **Allow**, Include → **Emails** → `josephneoh25@gmail.com` + Melissa's.
4. **Zero Trust → Settings → Authentication** → enable **One-time PIN** (emails a 6-digit
   code; no OAuth app needed).
5. **Settings → Deployment protection** → enable Access on production so the raw
   `finance-dashboard.pages.dev` URL is covered too.

Free tier covers 50 users. `index.html` already reads `/cdn-cgi/access/get-identity` and will
show "Signed in as …" in the header once Access is live — until then it silently no-ops.
