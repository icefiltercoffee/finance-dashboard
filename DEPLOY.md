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
| `data/finance.json` | Every number, sourced from the Drive workbook. The only monthly diff. |
| `wrangler.toml` | Pages project config (`finance-dashboard`, builds from `dist/`). |
| `package.json` | `dev` / `build` / `deploy` scripts. |
| `.github/workflows/deploy.yml` | Push to `main` → Pages deploy. |
| `.gitignore` | Keeps `dist/`, `.env`, `.dev.vars`, `node_modules/` out of git. |

---

## The login gate — READ THIS BEFORE YOU TRUST IT

There are two separate things here, and only one of them is security.

| | What it is | Does it protect anything? |
|---|---|---|
| **PIN screen** in `index.html` | The Steven-style passcode screen you see on load | **No.** It accepts any 4 digits and checks nothing. Anyone can press Enter, view source, or fetch `/data/finance.json` directly. It is a visual lock, matching Steven. |
| **Cloudflare Access** | Edge auth in front of the whole site | **Yes.** Nothing is served — not the HTML, not the JSON — until Cloudflare has verified your email. |

Right now `finance-dashboard-153.pages.dev` is **public**, and it shows your and Melissa's
salaries, CPF, balances and liabilities. Until step 5 below is done, treat the URL as fully
public — anyone with the link has everything.

### Turning on Cloudflare Access

Access can't attach to a bare `pages.dev` hostname, so it needs a custom domain on a
Cloudflare zone. That's the only reason a domain enters the picture.

1. **Get a domain onto Cloudflare** (skip if you already have one). Cloudflare dashboard →
   *Add a site* → follow the nameserver change at your registrar. Free plan is fine.
2. **Workers & Pages → finance-dashboard → Custom domains** → *Set up a custom domain* →
   e.g. `finance.yourdomain.com`. Wait for it to go green.
3. **Zero Trust → Settings → Authentication → Login methods** → *Add new* → **One-time PIN**.
   This emails a 6-digit code; no Google/GitHub OAuth app to register.
4. **Zero Trust → Access → Applications** → *Add an application* → **Self-hosted**:
   - Application name: `Finance Intern`
   - Session duration: 24 hours (or 1 week if the re-auth annoys you)
   - Public hostname: `finance.yourdomain.com`
   - Policy → name `Household`, action **Allow**, Include → **Emails** →
     `josephneoh25@gmail.com` **and Melissa's email**
   - Leave everything else default → *Save*.
5. **Cover the raw pages.dev URL too.** Workers & Pages → finance-dashboard → *Settings* →
   **Deployment protection** (called *Access policy* in some accounts) → enable Access on
   **Production** *and* **Preview**. Without this step the original
   `finance-dashboard-153.pages.dev` stays wide open and steps 1–4 achieve nothing.
6. **Verify it.** Open the site in a private window. You should get a Cloudflare
   email-code screen *before* the PIN screen. Then confirm the JSON is gated too:

```bash
curl -sI https://finance-dashboard-153.pages.dev/data/finance.json | head -1
```

A `302` to `cloudflareaccess.com` means it's protected. A `200` means it is still public —
step 5 didn't take.

Free tier covers 50 users. Once Access is live, `index.html` reads
`/cdn-cgi/access/get-identity` and shows "Signed in as …" in the header, and the gate's
footer switches from "Private" to "Cloudflare Access". Until then it silently no-ops.

### If you want the PIN to actually check a code

Say the word and I'll wire it to a real comparison. Be clear-eyed about what that buys:
it stops someone casually clicking through, but the passcode would sit in the page source
and `data/finance.json` would still be fetchable. It is not a substitute for step 5.
