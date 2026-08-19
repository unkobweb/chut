import type { Child } from 'hono/jsx'
import { interpolate, type Locale } from './i18n.js'
import { Layout, render } from './layout.js'
import { Wordmark } from './wordmark.js'

/** JSON destined for a <script> block: `<` is neutralised so it cannot close it. */
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

// Lowercase, as drawn. Uppercase tracked labels read as officialdom, and
// officialdom is the register a phishing page reaches for.
const LABEL = 'font-mono text-[13px] text-faint'

/** Width of the expiry bar, in characters. Sixteen, as the mockups drew it. */
const BAR_CELLS = 16
const PANEL = 'border border-line bg-panel'

function Card({ children }: { children: Child }) {
  return <div class="w-full border border-line bg-panel p-5 sm:p-7">{children}</div>
}

/**
 * `tagline` is deliberately absent from the form. It is a strapline, and this is
 * not a page anyone is browsing — every line has to earn the vertical space it
 * takes from the button. It still appears on the index, where there is nothing
 * to do and room to explain.
 */
function Header({ locale, right, tagline = false }: { locale: Locale; right?: Child; tagline?: boolean }) {
  return (
    <header class="mb-5 flex items-start justify-between gap-4">
      <div>
        <Wordmark />
        {tagline ? (
          <p class="mt-2 font-mono text-[11px] leading-relaxed text-faint">{locale.t.tagline}</p>
        ) : null}
      </div>
      {right}
    </header>
  )
}

/**
 * The countdown. Its own element so the script can update it, and aria-live so a
 * screen reader hears time running out rather than only seeing it.
 */
/**
 * The countdown, with the bar the mockups drew.
 *
 * It sits at the foot of the ready state and moves to the header once the value
 * is on its way. That is deliberate: no clock ticking in someone's face while
 * they are deciding whether to trust the request, and a visible one once they
 * have committed and are waiting.
 */
function Countdown({ locale }: { locale: Locale }) {
  return (
    <div id="countdown-block" class="mt-4 flex items-baseline gap-3">
      <span class="font-mono text-[13px] whitespace-nowrap text-faint">
        {locale.t.expires}{' '}
        <span id="countdown" aria-live="polite" class="tabular-nums text-dim">
          —
        </span>
      </span>
      {/*
        * A run of block characters, as drawn — not a CSS bar.
        *
        * The multi-line ASCII logo had to go because every line had to align with
        * the ones above it, and any font substitution destroyed the shape. A
        * single row of identical characters has no alignment to lose, and U+2593
        * and U+2591 come from DOS consoles: about as universally present as a
        * glyph gets. Decorative, so hidden from screen readers — the countdown
        * beside it already announces the time.
        */}
      <span
        id="countdown-bar"
        aria-hidden="true"
        class="font-mono text-[13px] leading-none tracking-tighter whitespace-nowrap text-phosphor"
      >
        {'\u2593'.repeat(BAR_CELLS)}
      </span>
    </div>
  )
}

export function FormPage(props: {
  nonce: string
  locale: Locale
  id: string
  requester: string
  label: string
  purpose: string | null
  createdAt: number
  expiresAt: number
  maxBytes: number
}): string {
  const { locale, nonce } = props
  const t = locale.t

  const config = safeJson({
    id: props.id,
    // Both ends of the window. Deriving the total from Date.now() at load meant
    // the bar restarted full on every refresh, however little time was left.
    createdAt: props.createdAt,
    expiresAt: props.expiresAt,
    maxBytes: props.maxBytes,
    t: {
      pasteFailed: t.pasteFailed,
      show: t.show,
      hide: t.hide,
      submit: t.submit,
      encrypting: t.submitEncrypting,
      sending: t.submitSending,
      expired: t.expired,
      empty: t.errorEmpty,
      tooLong: interpolate(t.errorTooLong, { max: props.maxBytes }),
      generic: t.errorGeneric,
      expiredTitle: t.expiredTitle,
      expiredBody: t.expiredBody,
      expiredAction: t.expiredAction,
    },
  })

  return render(
    <Layout title={`${props.requester} — ${props.label}`} nonce={nonce} locale={locale} script={CLIENT_SCRIPT.replace('__CONFIG__', config)}>
      <Card>
        {/* Empty on purpose: the countdown moves in here once the value is sent. */}
        <Header locale={locale} right={<div id="header-slot" class="w-28 shrink-0" />} />

        {/*
          * The document heading. It states what is happening rather than
          * repeating the request below it: the old page put "X is asking for Y"
          * in an h1 and then restated both in the panel, which is noise exactly
          * where attention is scarce. A page with no h1 is an accessibility
          * defect, so the sentence that frames the decision does the job.
          */}
        {/*
          * Screen-reader only. The panel underneath states who is asking and
          * what for, in those words, so printing the same thing as a sentence
          * above it was costing 57px of a viewport that has to fit a decision,
          * a field and a timer. The heading still exists — a page without one is
          * an accessibility defect — it just no longer repeats itself.
          */}
        <h1 class="sr-only">{t.intro}</h1>

        {/* What the agent claims. Presented as a claim, never as a fact. */}
        {/*
          * Reads as a sentence — <requester> wants <label> — rather than a form
          * with three labelled rows. Same three facts, a third of the lines.
          */}
        <section class={`${PANEL} mb-5 p-4 leading-snug`}>
          <p class="font-mono text-[15px] font-semibold break-words text-ink">{props.requester}</p>
          <p class={`${LABEL} my-0.5`}>{t.wants}</p>
          <p class="font-mono text-[15px] font-semibold break-words text-ink">{props.label}</p>

          {props.purpose ? (
            <p class="mt-2 text-sm leading-snug break-words text-dim">“{props.purpose}”</p>
          ) : null}

          <p class="mt-3 border-t border-line pt-2.5 text-xs leading-snug text-faint">
            {t.unverified}
          </p>
        </section>

        <form id="form" novalidate>
          <div class="mb-2 flex items-baseline justify-between gap-3">
            <label for="secret" class="font-mono text-[15px] font-bold text-ink">
              {t.inputLabel}
            </label>
            <div class="flex shrink-0 items-baseline gap-3">
              {/*
                * Hidden until the script confirms the browser will hand over the
                * clipboard. Offering a button that cannot work is worse than not
                * offering one, on a page where people are already unsure.
                */}
              <button
                type="button"
                id="paste"
                hidden
                class="cursor-pointer font-mono text-sm text-phosphor underline-offset-4 hover:underline"
              >
                [ {t.paste} ]
              </button>
              <button
                type="button"
                id="toggle"
                aria-pressed="false"
                class="cursor-pointer font-mono text-sm text-phosphor underline-offset-4 hover:underline"
              >
                [ {t.show} ]
              </button>
            </div>
          </div>

          <textarea
            id="secret"
            rows={2}
            required
            spellcheck={false}
            autocapitalize="off"
            autocorrect="off"
            autocomplete="off"
            aria-describedby="field-note"
            class="w-full resize-y border border-line bg-surface p-3 font-mono text-sm text-ink placeholder:text-faint"
            placeholder="············"
          />

          <div
            id="error"
            role="alert"
            hidden
            class="mt-3 border border-alarm/30 bg-alarm/10 p-3 text-sm text-alarm"
          />

          <button
            type="submit"
            id="submit"
            class="btn-fill mt-4 w-full cursor-pointer bg-phosphor px-4 py-3 font-mono text-sm font-bold tracking-wide text-surface uppercase disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t.submit}
          </button>
        </form>

        <div id="progress" hidden class="mt-4 space-y-1 font-mono text-xs text-dim">
          <p>
            <span class="text-phosphor">[✓]</span> {t.stepScrambled}
          </p>
          <p>
            <span class="text-phosphor">[·]</span> {t.stepSending}
          </p>
          <p class="pt-1 text-faint">{t.keepOpen}</p>
        </div>

        <div id="field-note" class="mt-4 space-y-1 text-[12.5px] leading-snug text-faint">
          <p>{t.noteEncrypted}</p>
          <p>{t.noteSingleUse}</p>
        </div>

        <Countdown locale={locale} />
      </Card>
    </Layout>,
  )
}

/** Every terminal state shares this shape: a mark, a title, and what to do next. */
function TerminalPage(props: {
  nonce: string
  locale: Locale
  title: string
  glyph: string
  tone: 'neutral' | 'good' | 'warn'
  body: string
  action?: string
  note?: string
}): string {
  const border =
    props.tone === 'good'
      ? 'border-phosphor/40 text-phosphor'
      : props.tone === 'warn'
        ? 'border-caution/40 text-caution'
        : 'border-line text-faint'

  return render(
    <Layout title={props.title} nonce={props.nonce} locale={props.locale}>
      <Card>
        <Header locale={props.locale} />
        <div class="py-4 text-center">
          <div
            class={`mx-auto mb-5 flex h-11 w-16 items-center justify-center border font-mono text-sm ${border}`}
            aria-hidden="true"
          >
            {props.glyph}
          </div>
          <h1 class="mb-3 font-mono text-lg font-bold text-ink">{props.title}</h1>
          <p class="mx-auto max-w-sm text-sm leading-relaxed text-dim">{props.body}</p>
          {props.action ? (
            <p class="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-dim">{props.action}</p>
          ) : null}
          {props.note ? (
            <p class="mx-auto mt-4 max-w-sm text-xs leading-relaxed text-faint">{props.note}</p>
          ) : null}
        </div>
      </Card>
    </Layout>,
  )
}

export type ClosedReason = 'filled' | 'revealed' | 'expired' | 'cancelled' | 'notFound' | 'broken'

export function ClosedPage(nonce: string, locale: Locale, reason: ClosedReason): string {
  const t = locale.t
  const shared = { nonce, locale }

  switch (reason) {
    case 'filled':
    case 'revealed':
      return TerminalPage({
        ...shared,
        glyph: '!',
        tone: 'warn',
        title: t.filledTitle,
        body: t.filledBody,
        action: t.filledWarn,
      })
    case 'expired':
      return TerminalPage({
        ...shared,
        glyph: '00:00',
        tone: 'neutral',
        title: t.expiredTitle,
        body: t.expiredBody,
        action: t.expiredAction,
      })
    case 'cancelled':
      return TerminalPage({
        ...shared,
        glyph: '—',
        tone: 'neutral',
        title: t.cancelledTitle,
        body: t.cancelledBody,
        note: t.cancelledNote,
      })
    case 'broken':
      return TerminalPage({
        ...shared,
        glyph: '⌐ ¬',
        tone: 'warn',
        title: t.brokenTitle,
        body: t.brokenBody,
        action: t.brokenAction,
      })
    default:
      return TerminalPage({
        ...shared,
        glyph: '·',
        tone: 'neutral',
        title: t.notFoundTitle,
        body: t.notFoundBody,
        action: t.notFoundAction,
      })
  }
}

export function DeliveredPage(nonce: string, locale: Locale): string {
  return TerminalPage({
    nonce,
    locale,
    glyph: '✓✓',
    tone: 'good',
    title: locale.t.deliveredTitle,
    body: locale.t.deliveredBody,
    note: locale.t.deliveredNote,
  })
}

export function IndexPage(nonce: string, locale: Locale, baseUrl: string): string {
  return render(
    <Layout title="chut" nonce={nonce} locale={locale}>
      <Card>
        <Header locale={locale} tagline />
        <p class="mb-5 text-[15px] leading-relaxed text-dim">{locale.t.indexBlurb}</p>
        <div class={`${PANEL} p-4 font-mono text-xs text-dim`}>
          <p>POST {baseUrl}/v1/requests</p>
          <p>GET&nbsp; {baseUrl}/openapi.json</p>
        </div>
        <p class="mt-5 text-xs text-faint">{locale.t.indexNothing}</p>
      </Card>
    </Layout>,
  )
}

/**
 * The client script. Everything it does is either crypto or feedback, and none of
 * it is optional: the value is encrypted here, and only here, before it leaves.
 */
const CLIENT_SCRIPT = `
(function () {
  var CFG = __CONFIG__;
  var form = document.getElementById('form');
  var input = document.getElementById('secret');
  var submit = document.getElementById('submit');
  var toggle = document.getElementById('toggle');
  var errorBox = document.getElementById('error');
  var progress = document.getElementById('progress');
  var countdown = document.getElementById('countdown');

  function fail(msg) {
    errorBox.textContent = msg;
    errorBox.hidden = false;
    input.setAttribute('aria-invalid', 'true');
  }
  function clearError() {
    errorBox.hidden = true;
    input.removeAttribute('aria-invalid');
  }

  // The encryption key lives only in the fragment, which browsers never send.
  var rawKey = location.hash.slice(1);
  if (!rawKey) { location.replace('/broken'); return; }

  // Report that a browser rendered this page. Preview crawlers run no JavaScript
  // and never reach here, which is what keeps opened_count meaningful.
  try { fetch('/s/' + CFG.id + '/opened', { method: 'POST', keepalive: true }).catch(function(){}); } catch (e) {}

  var bar = document.getElementById('countdown-bar');
  var CELLS = 16;
  var FULL = '\u2593', EMPTY = '\u2591';
  var total = Math.max(1, CFG.expiresAt - CFG.createdAt);
  var dead = false;
  function tick() {
    var remaining = CFG.expiresAt - Date.now();
    var left = Math.max(0, Math.round(remaining / 1000));
    if (left <= 0) {
      countdown.textContent = CFG.t.expired;
      if (bar) bar.textContent = EMPTY.repeat(CELLS);
      // A real server-side transition: the reload renders the expired state.
      if (!dead) { dead = true; location.replace('/s/' + CFG.id); }
      return;
    }
    var m = Math.floor(left / 60), s = left % 60;
    countdown.textContent = m + ':' + String(s).padStart(2, '0');
    if (bar) {
      var lit = Math.max(0, Math.min(CELLS, Math.ceil((remaining / total) * CELLS)));
      bar.textContent = FULL.repeat(lit) + EMPTY.repeat(CELLS - lit);
    }
    setTimeout(tick, 1000);
  }
  tick();

  // Clipboard reads need an explicit gesture and a permissive browser; where the
  // API is missing the control never appears rather than failing on click.
  var pasteBtn = document.getElementById('paste');
  if (pasteBtn && navigator.clipboard && navigator.clipboard.readText) {
    pasteBtn.hidden = false;
    pasteBtn.addEventListener('click', function () {
      navigator.clipboard.readText().then(function (text) {
        if (!text) return;
        input.value = text;
        clearError();
        input.focus();
      }).catch(function () { fail(CFG.t.pasteFailed); });
    });
  }

  var masked = true;
  function applyMask() {
    input.style.webkitTextSecurity = masked ? 'disc' : 'none';
    input.style.textSecurity = masked ? 'disc' : 'none';
    toggle.textContent = '[ ' + (masked ? CFG.t.show : CFG.t.hide) + ' ]';
    toggle.setAttribute('aria-pressed', masked ? 'false' : 'true');
  }
  applyMask();
  toggle.addEventListener('click', function () { masked = !masked; applyMask(); });

  function b64(buf) {
    var bytes = new Uint8Array(buf), out = '';
    for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return btoa(out);
  }
  function keyBytes(s) {
    var v = s.replace(/-/g, '+').replace(/_/g, '/');
    while (v.length % 4) v += '=';
    var bin = atob(v), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearError();

    var value = input.value;
    if (!value) return fail(CFG.t.empty);
    if (new TextEncoder().encode(value).length > CFG.maxBytes) return fail(CFG.t.tooLong);

    submit.disabled = true;
    submit.textContent = CFG.t.encrypting;
    progress.hidden = false;

    // Committed now, so the clock moves up into view. Moved rather than
    // duplicated: two elements sharing an id is invalid, and getElementById
    // would silently drive only the first one.
    var slot = document.getElementById('header-slot');
    var block = document.getElementById('countdown-block');
    if (slot && block) {
      block.classList.remove('mt-5');
      block.classList.add('text-xs');
      slot.appendChild(block);
    }

    var iv = crypto.getRandomValues(new Uint8Array(12));
    crypto.subtle.importKey('raw', keyBytes(rawKey), { name: 'AES-GCM' }, false, ['encrypt'])
      .then(function (key) {
        return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(value));
      })
      .then(function (ct) {
        submit.textContent = CFG.t.sending;
        return fetch('/s/' + CFG.id, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ciphertext: b64(ct), iv: b64(iv) })
        });
      })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (r) {
        if (!r.ok) throw new Error(r.data && r.data.message ? r.data.message : CFG.t.generic);
        input.value = '';
        // replace(), and to a URL carrying no id: the key-bearing address leaves
        // the history and nothing about this request survives in the bar.
        location.replace('/done');
      })
      .catch(function (err) {
        submit.disabled = false;
        submit.textContent = CFG.t.submit;
        progress.hidden = true;
        fail(err && err.message ? err.message : CFG.t.generic);
      });
  });
})();`
