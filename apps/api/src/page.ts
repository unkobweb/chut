import { config } from './config.js'

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const STYLES = `
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
  background:#0b0d10;color:#e6e9ee;
  font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.card{width:100%;max-width:520px;background:#14171c;border:1px solid #262c35;border-radius:14px;
  padding:28px;box-shadow:0 12px 40px rgba(0,0,0,.45)}
.brand{display:flex;align-items:center;gap:8px;font-size:12px;letter-spacing:.12em;
  text-transform:uppercase;color:#7d8796;margin-bottom:20px}
.dot{width:7px;height:7px;border-radius:50%;background:#4ade80}
h1{margin:0 0 6px;font-size:21px;font-weight:600;line-height:1.3}
.sub{margin:0 0 20px;color:#98a2b3;font-size:14px}
.meta{border:1px solid #262c35;border-radius:10px;padding:14px 16px;margin-bottom:18px;background:#0f1216}
.row{display:flex;justify-content:space-between;gap:16px;padding:5px 0;font-size:13px}
.row+.row{border-top:1px solid #1e242c}
.k{color:#7d8796;flex:none}
.v{color:#e6e9ee;text-align:right;word-break:break-word}
label{display:block;font-size:13px;color:#98a2b3;margin-bottom:7px}
.field{position:relative}
textarea,input[type=password],input[type=text]{width:100%;background:#0f1216;color:#e6e9ee;
  border:1px solid #2c333d;border-radius:9px;padding:11px 12px;font:14px/1.45 ui-monospace,
  SFMono-Regular,Menlo,monospace;resize:vertical}
textarea:focus,input:focus{outline:none;border-color:#4d7cfe;box-shadow:0 0 0 3px rgba(77,124,254,.16)}
textarea{min-height:88px}
.toggle{background:none;border:none;color:#7d8796;font-size:12px;cursor:pointer;padding:6px 0;margin-top:2px}
.toggle:hover{color:#c3cad6}
button.primary{width:100%;margin-top:16px;padding:12px;border:none;border-radius:9px;
  background:#4d7cfe;color:#fff;font-size:15px;font-weight:600;cursor:pointer}
button.primary:hover{background:#3f6cf0}
button.primary:disabled{background:#2a3140;color:#6b7280;cursor:not-allowed}
.warn{margin-top:18px;padding:12px 14px;border-radius:9px;font-size:12.5px;line-height:1.5;
  background:rgba(234,179,8,.07);border:1px solid rgba(234,179,8,.25);color:#e3c264}
.err{margin-top:14px;padding:11px 13px;border-radius:9px;font-size:13px;
  background:rgba(239,68,68,.09);border:1px solid rgba(239,68,68,.3);color:#f9a8a8}
.ok-icon{width:44px;height:44px;border-radius:50%;background:rgba(74,222,128,.12);
  border:1px solid rgba(74,222,128,.35);display:flex;align-items:center;justify-content:center;
  font-size:22px;color:#4ade80;margin-bottom:16px}
.foot{margin-top:22px;padding-top:14px;border-top:1px solid #1e242c;color:#6b7280;font-size:11.5px;line-height:1.6}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#c3cad6}
.hidden{display:none}
`

function shell(title: string, nonce: string, body: string, script = ''): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style nonce="${nonce}">${STYLES}</style>
</head>
<body>
<main class="card">
  <div class="brand"><span class="dot"></span> chut</div>
  ${body}
</main>
${script ? `<script nonce="${nonce}">${script}</script>` : ''}
</body>
</html>`
}

export function renderClosed(nonce: string, opts: { title: string; message: string }): string {
  return shell(
    opts.title,
    nonce,
    `<h1>${escapeHtml(opts.title)}</h1>
     <p class="sub">${escapeHtml(opts.message)}</p>
     <div class="foot">If you think this is a mistake, ask your agent for a new link.
     A chut link is single-use and short-lived.</div>`,
  )
}

/**
 * Deliberately says nothing about the request it confirms: no id, no label, no
 * purpose, and no database lookup behind it. This page is served at a fixed URL
 * with no identifier, so it cannot leak anything to a caller who merely saw the
 * link go by, and cannot be used to tell a real request from a made-up one.
 *
 * The human just typed the value; they do not need to be told what it was.
 */
export function renderSuccess(nonce: string): string {
  return shell(
    'Secret delivered',
    nonce,
    `<div class="ok-icon">&#10003;</div>
     <h1>Delivered</h1>
     <p class="sub">Your value was encrypted in your browser and sent.
     The agent can now retrieve it, once.</p>
     <div class="foot">You can close this tab. That link will not work again.</div>`,
  )
}

export function renderForm(
  nonce: string,
  req: {
    id: string
    requester: string
    label: string
    purpose: string | null
    expiresAt: number
    maxBytes: number
  },
): string {
  const body = `
  <h1>${escapeHtml(req.requester)} is asking for: ${escapeHtml(req.label)}</h1>
  <p class="sub">Paste the value below. It is encrypted in your browser before being sent:
  the server never sees it in plaintext.</p>

  <div class="meta">
    <div class="row"><span class="k">Requested by</span><span class="v">${escapeHtml(req.requester)}</span></div>
    <div class="row"><span class="k">Asking for</span><span class="v">${escapeHtml(req.label)}</span></div>
    ${req.purpose ? `<div class="row"><span class="k">Purpose</span><span class="v">${escapeHtml(req.purpose)}</span></div>` : ''}
    <div class="row"><span class="k">Expires in</span><span class="v" id="countdown">&mdash;</span></div>
  </div>

  <form id="form">
    <label for="secret">Value to send</label>
    <div class="field">
      <textarea id="secret" spellcheck="false" autocapitalize="off" autocorrect="off"
        autocomplete="off" placeholder="sk-..." required></textarea>
    </div>
    <button type="button" class="toggle" id="toggle">Hide input</button>
    <button type="submit" class="primary" id="submit">Send encrypted</button>
  </form>

  <div class="err hidden" id="error"></div>

  <div class="warn">
    Only fill this form if you were <strong>expecting</strong> this request.
    No legitimate service will ask you for a master password or a recovery code
    this way. When in doubt, close this tab.
  </div>

  <div class="foot">
    AES-GCM 256 encryption performed in your browser. The key lives in the URL
    <code>#</code> fragment, which your browser never sends to the server.
    The server only ever stores ciphertext.
  </div>`

  const script = `
(function () {
  var EXPIRES = ${req.expiresAt};
  var MAX_BYTES = ${req.maxBytes};
  var ID = ${JSON.stringify(req.id)};

  var form = document.getElementById('form');
  var input = document.getElementById('secret');
  var submit = document.getElementById('submit');
  var errorBox = document.getElementById('error');
  var countdown = document.getElementById('countdown');
  var toggle = document.getElementById('toggle');

  function fail(msg) {
    errorBox.textContent = msg;
    errorBox.classList.remove('hidden');
  }

  // The encryption key lives only in the fragment: never sent to the server.
  var rawKey = location.hash.slice(1);
  if (!rawKey) {
    fail("Incomplete link: the encryption key is missing. The link was probably truncated when copied. Ask for a new one.");
    submit.disabled = true;
    input.disabled = true;
  }

  function tick() {
    var left = Math.max(0, Math.round((EXPIRES - Date.now()) / 1000));
    if (left <= 0) {
      countdown.textContent = 'expired';
      submit.disabled = true;
      input.disabled = true;
      return;
    }
    var m = Math.floor(left / 60), s = left % 60;
    countdown.textContent = m > 0 ? m + ' min ' + String(s).padStart(2, '0') + ' s' : s + ' s';
    setTimeout(tick, 1000);
  }
  tick();

  // Report that this page actually rendered in a browser. Link-preview crawlers
  // fetch the HTML but run no JavaScript, so they never get here — which is what
  // keeps the "opened several times" warning meaningful.
  try {
    fetch('/s/' + ID + '/opened', { method: 'POST', keepalive: true }).catch(function () {});
  } catch (e) {}

  var masked = false;
  toggle.addEventListener('click', function () {
    masked = !masked;
    input.style.webkitTextSecurity = masked ? 'disc' : 'none';
    input.style.textSecurity = masked ? 'disc' : 'none';
    toggle.textContent = masked ? 'Show input' : 'Hide input';
  });

  function b64(buf) {
    var bytes = new Uint8Array(buf), out = '';
    for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return btoa(out);
  }

  function keyBytes(s) {
    var b64s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (b64s.length % 4) b64s += '=';
    var bin = atob(b64s), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errorBox.classList.add('hidden');

    var value = input.value;
    if (!value) return fail('The field is empty.');
    if (new TextEncoder().encode(value).length > MAX_BYTES)
      return fail('Value too long (maximum ' + MAX_BYTES + ' bytes).');

    submit.disabled = true;
    submit.textContent = 'Encrypting...';

    var iv = crypto.getRandomValues(new Uint8Array(12));

    crypto.subtle
      .importKey('raw', keyBytes(rawKey), { name: 'AES-GCM' }, false, ['encrypt'])
      .then(function (key) {
        return crypto.subtle.encrypt(
          { name: 'AES-GCM', iv: iv },
          key,
          new TextEncoder().encode(value)
        );
      })
      .then(function (ct) {
        submit.textContent = 'Sending...';
        return fetch('/s/' + ID, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ciphertext: b64(ct), iv: b64(iv) })
        });
      })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (r) {
        if (!r.ok) throw new Error(r.data && r.data.message ? r.data.message : 'Submission refused.');
        input.value = '';
        // replace() rather than assign(): drops the key-bearing URL from history.
        // The destination carries no id, so nothing about this request survives
        // in the address bar either.
        location.replace('/done');
      })
      .catch(function (err) {
        submit.disabled = false;
        submit.textContent = 'Send encrypted';
        fail(err && err.message ? err.message : 'Something went wrong.');
      });
  });
})();`

  return shell(`${req.requester} is asking for a secret`, nonce, body, script)
}

export function renderIndex(nonce: string): string {
  return shell(
    'chut',
    nonce,
    `<h1>chut</h1>
     <p class="sub">An AI agent asks its human for a secret through a short-lived link.
     The secret is encrypted in the browser: the server never sees it in plaintext.</p>
     <div class="meta">
       <div class="row"><span class="k">API</span><span class="v"><code>POST /v1/requests</code></span></div>
       <div class="row"><span class="k">Spec</span><span class="v"><code>${escapeHtml(config.baseUrl)}/openapi.json</code></span></div>
       <div class="row"><span class="k">Health</span><span class="v"><code>/healthz</code></span></div>
     </div>
     <div class="foot">There is nothing to see here without a valid request link.</div>`,
  )
}
