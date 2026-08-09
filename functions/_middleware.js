/**
 * Finance Intern — server-side PIN gate.
 *
 * Runs as Cloudflare Pages Functions middleware, which sits in front of EVERY
 * request to the project: `/`, HTML, JS/CSS, and `/data/finance.json`. Nothing
 * static is served until `context.next()` is called, so an unauthenticated
 * request cannot reach the data file.
 *
 * Secrets (encrypted, set in the Cloudflare dashboard — never in git):
 *   FINANCE_PIN     the actual PIN. Only ever compared server-side.
 *   SESSION_SECRET  HMAC key used to sign the session cookie.
 *
 * The PIN is never sent to the browser. The only thing the client learns is how
 * many digits to draw, which is not the secret.
 */

const COOKIE = "fi_session";
const SESSION_TTL_S = 7 * 24 * 60 * 60;      // 7 days
const LOGIN_PATH = "/__auth/login";
const LOGOUT_PATH = "/__auth/logout";

/* Rate limiting — best effort, no extra infrastructure.
   Counters live in the per-datacentre Cache API, so they are ephemeral and not
   shared globally. Good enough to make online guessing of a short PIN painful;
   not a substitute for a long secret. */
const RL_WINDOW_S = 15 * 60;
const RL_MAX_ATTEMPTS = 8;
const RL_BASE_DELAY_MS = 250;
const RL_MAX_DELAY_MS = 4000;

/* ------------------------------------------------------------------ utils */
const enc = new TextEncoder();

function b64urlFromBytes(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function bytesFromB64url(str) {
  const s = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256(str) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(str)));
}

/** Fixed-length, branch-free comparison. */
function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Compare two secrets without leaking length or content through timing. */
async function secretEquals(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  return equalBytes(await sha256(a), await sha256(b));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
  );
}

/** token = base64url(payload) "." base64url(HMAC(payload)) */
async function signSession(secret, payloadObj) {
  const payload = b64urlFromBytes(enc.encode(JSON.stringify(payloadObj)));
  const key = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
  return payload + "." + b64urlFromBytes(sig);
}

async function verifySession(secret, token) {
  if (typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot < 1 || token.indexOf(".", dot + 1) !== -1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let sigBytes;
  try { sigBytes = bytesFromB64url(sig); } catch { return null; }

  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(payload));
  if (!ok) return null;

  let data;
  try { data = JSON.parse(new TextDecoder().decode(bytesFromB64url(payload))); }
  catch { return null; }
  if (!data || typeof data.exp !== "number" || Date.now() > data.exp) return null;
  return data;
}

function readCookie(req, name) {
  const raw = req.headers.get("Cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

const cookieAttrs = `HttpOnly; Secure; SameSite=Strict; Path=/`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* -------------------------------------------------------- rate limiting */
async function rlKey(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const digest = b64urlFromBytes(await sha256("pin-attempts:" + ip));
  return new Request("https://finance-intern.invalid/rl/" + digest, { method: "GET" });
}

async function rlGet(request) {
  try {
    const hit = await caches.default.match(await rlKey(request));
    if (!hit) return 0;
    const n = parseInt(await hit.text(), 10);
    return Number.isFinite(n) ? n : 0;
  } catch { return 0; }
}

async function rlBump(request, n) {
  try {
    await caches.default.put(
      await rlKey(request),
      new Response(String(n), { headers: { "Cache-Control": `max-age=${RL_WINDOW_S}` } })
    );
  } catch { /* cache unavailable — degrade to no counter, never to an error */ }
}

async function rlClear(request) {
  try { await caches.default.delete(await rlKey(request)); } catch { /* ignore */ }
}

/* ------------------------------------------------------------ login page */
/* Visually identical to the gate that used to live in index.html — same
   palette, type, gradients, dot markup and Enter button. The only additions
   are an error line and the fetch that submits the PIN to the server. */
function loginPage(pinLength, status) {
  return new Response(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Finance Intern</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{
    --serif:"Fraunces","Iowan Old Style",Georgia,serif;
    --sans:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  }
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;height:100%;}
  body{font-family:var(--sans); background:#241c12; -webkit-font-smoothing:antialiased; font-size:15px; line-height:1.5;}
  .gate{position:fixed; inset:0; z-index:100; display:flex; align-items:center; justify-content:center;
        background:#241c12; overflow:hidden; transition:opacity .7s ease, visibility .7s;}
  .gate::before{content:""; position:absolute; inset:0;
    background:radial-gradient(900px 600px at 20% 10%, rgba(175,106,62,.30), transparent 60%),
      radial-gradient(800px 520px at 85% 90%, rgba(94,107,77,.26), transparent 62%),
      linear-gradient(180deg, rgba(38,26,14,.55), rgba(26,18,9,.88));}
  .gate.hide{opacity:0; visibility:hidden;}
  .gate-card{position:relative; z-index:2; width:min(88vw,340px); text-align:center; color:#f6ecda; padding:8px;}
  .gate-mark{font-family:var(--serif); font-weight:500; font-size:15px; letter-spacing:.34em;
             text-transform:uppercase; opacity:.78; margin-bottom:24px;}
  .gate-title{font-family:var(--serif); font-weight:500; font-size:52px; line-height:1; margin:0 0 10px;}
  .gate-sub{font-size:13.5px; opacity:.72; margin-bottom:34px;}
  .pin{display:flex; gap:11px; justify-content:center; margin-bottom:22px;}
  .pin i{width:13px; height:13px; border-radius:50%; border:1.5px solid rgba(246,236,218,.55); display:block; transition:.2s;}
  .pin i.on{background:#f6ecda; border-color:#f6ecda;}
  .pin.bad i{border-color:#e08a6a;}
  .pin.bad{animation:shake .38s;}
  @keyframes shake{10%,90%{transform:translateX(-2px)}30%,70%{transform:translateX(4px)}50%{transform:translateX(-4px)}}
  .enter{appearance:none; border:0; cursor:pointer; font-family:var(--sans); font-size:14px; font-weight:500;
         color:#241c12; background:#f6ecda; padding:12px 30px; border-radius:100px; transition:.2s;}
  .enter:hover{transform:translateY(-1px); background:#fff;}
  .enter[disabled]{opacity:.5; cursor:default; transform:none;}
  .gate-lock{display:inline-flex; align-items:center; gap:6px; font-size:11.5px; letter-spacing:.06em;
             text-transform:uppercase; opacity:.55; margin-top:26px; color:#f6ecda;}
  .err{min-height:17px; margin:-8px 0 14px; font-size:12.5px; color:#e8a488; opacity:0; transition:opacity .2s;}
  .err.on{opacity:1;}
  .sr{position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap;}
  @media (prefers-reduced-motion:reduce){*{animation:none!important; transition:none!important;}}
</style>
</head>
<body>
<div class="gate" id="gate">
  <div class="gate-card">
    <div class="gate-mark">Steven</div>
    <h1 class="gate-title">Finance Intern</h1>
    <div class="gate-sub">Enter your passcode to continue.</div>
    <label class="sr" for="pinInput">Passcode</label>
    <input class="sr" id="pinInput" type="text" inputmode="numeric" autocomplete="off"
           autocorrect="off" autocapitalize="off" spellcheck="false" maxlength="${pinLength}">
    <div class="pin" id="pin">${'<i></i>'.repeat(pinLength)}</div>
    <div class="err" id="err" role="alert"></div>
    <button class="enter" id="enterBtn">Enter</button>
    <div class="gate-lock">&#128274; Private</div>
  </div>
</div>
<script>
(function(){
  var LEN=${pinLength};
  var pins=[].slice.call(document.querySelectorAll('#pin i'));
  var pinEl=document.getElementById('pin');
  var input=document.getElementById('pinInput');
  var btn=document.getElementById('enterBtn');
  var err=document.getElementById('err');
  var busy=false, digits='';

  function paint(){
    for(var i=0;i<pins.length;i++) pins[i].classList.toggle('on', i<digits.length);
  }
  function fail(msg){
    err.textContent=msg; err.classList.add('on');
    pinEl.classList.add('bad');
    setTimeout(function(){pinEl.classList.remove('bad');},400);
    digits=''; paint();
  }
  function clearErr(){ err.classList.remove('on'); }

  async function submit(){
    if(busy || digits.length!==LEN) { if(digits.length!==LEN) fail('Enter all '+LEN+' digits.'); return; }
    busy=true; btn.disabled=true; clearErr();
    try{
      var res=await fetch('${LOGIN_PATH}',{
        method:'POST', credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({pin:digits})
      });
      if(res.ok){
        document.getElementById('gate').classList.add('hide');
        setTimeout(function(){ location.replace(location.pathname+location.search); }, 250);
        return;
      }
      var body={}; try{ body=await res.json(); }catch(e){}
      fail(res.status===429 ? (body.error||'Too many attempts. Wait a few minutes.')
                            : (body.error||'Incorrect passcode.'));
    }catch(e){
      fail('Network error. Try again.');
    }
    busy=false; btn.disabled=false;
    input.value=''; input.focus();
  }

  input.addEventListener('input',function(){
    var v=input.value.replace(/\\D/g,'').slice(0,LEN);
    input.value=v; digits=v; clearErr(); paint();
    if(digits.length===LEN) setTimeout(submit,140);
  });
  input.addEventListener('keydown',function(e){ if(e.key==='Enter') submit(); });
  btn.addEventListener('click',function(){ input.focus(); submit(); });
  document.addEventListener('click',function(){ if(!busy) input.focus(); });
  window.addEventListener('pageshow',function(){ input.focus(); });
  input.focus();
})();
</script>
</body>
</html>`, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY"
    }
  });
}

const json = (obj, status, extra) => new Response(JSON.stringify(obj), {
  status,
  headers: Object.assign({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  }, extra || {})
});

/* ---------------------------------------------------------------- routes */
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  const PIN = env.FINANCE_PIN;
  const SECRET = env.SESSION_SECRET;

  // Fail closed. If the secrets are missing the site stays shut rather than
  // silently serving the dashboard to everyone.
  if (!PIN || !SECRET) {
    return json({ error: "Authentication is not configured." }, 503);
  }

  /* ---- logout: clear the cookie ---- */
  if (path === LOGOUT_PATH) {
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    return json({ ok: true }, 200, {
      "Set-Cookie": `${COOKIE}=; ${cookieAttrs}; Max-Age=0`
    });
  }

  /* ---- login: verify the PIN, issue the session ---- */
  if (path === LOGIN_PATH) {
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

    const attempts = await rlGet(request);
    if (attempts >= RL_MAX_ATTEMPTS) {
      return json({ error: "Too many attempts. Try again later." }, 429,
        { "Retry-After": String(RL_WINDOW_S) });
    }

    let submitted = "";
    try {
      const body = await request.json();
      submitted = typeof body?.pin === "string" ? body.pin : "";
    } catch { submitted = ""; }

    const ok = await secretEquals(submitted, PIN);

    if (!ok) {
      const n = attempts + 1;
      await rlBump(request, n);
      // Progressive delay: cheap, stateless-ish, and it makes scripted guessing
      // of a short PIN take far longer than it otherwise would.
      await sleep(Math.min(RL_BASE_DELAY_MS * Math.pow(2, n - 1), RL_MAX_DELAY_MS));
      const left = Math.max(0, RL_MAX_ATTEMPTS - n);
      return json({ error: left > 0 ? "Incorrect passcode." : "Too many attempts. Try again later." },
        left > 0 ? 401 : 429);
    }

    await rlClear(request);
    const token = await signSession(SECRET, { exp: Date.now() + SESSION_TTL_S * 1000 });
    return json({ ok: true }, 200, {
      "Set-Cookie": `${COOKIE}=${token}; ${cookieAttrs}; Max-Age=${SESSION_TTL_S}`
    });
  }

  /* ---- everything else: require a valid session ---- */
  const session = await verifySession(SECRET, readCookie(request, COOKIE));
  if (!session) {
    const len = Math.min(Math.max(String(PIN).length, 4), 12);
    // 401 for every unauthenticated path, including /data/finance.json.
    // Browsers still render the body, so the PIN screen shows as before.
    return loginPage(len, 401);
  }

  const response = await context.next();

  // Never let an authenticated response sit in a shared cache.
  const out = new Response(response.body, response);
  out.headers.set("Cache-Control", "no-store");
  return out;
}
