import type { Child } from 'hono/jsx'
import { interpolate, type Locale } from './i18n.js'
import { Layout, render } from './layout.js'
import { Wordmark } from './wordmark.js'

/** JSON destined for a <script> block: `<` is neutralised so it cannot close it. */
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

const LABEL = 'font-mono text-[11px] uppercase tracking-[0.14em] text-faint'
const PANEL = 'rounded-lg border border-line bg-panel'

function Card({ children }: { children: Child }) {
  return <div class="w-full">{children}</div>
}

function Header({ locale, right }: { locale: Locale; right?: Child }) {
  return (
    <header class="mb-6 flex items-start justify-between gap-4">
      <div>
        <Wordmark />
        <p class="mt-2 font-mono text-[11px] leading-relaxed text-faint">{locale.t.tagline}</p>
      </div>
      {right}
    </header>
  )
}

/**
 * The countdown. Its own element so the script can update it, and aria-live so a
 * screen reader hears time running out rather than only seeing it.
 */
function Countdown({ locale }: { locale: Locale }) {
  return (
    <div class="shrink-0 text-end font-mono text-xs text-dim">
      <span class="text-faint">{locale.t.expires}</span>{' '}
      <span id="countdown" aria-live="polite" class="tabular-nums text-ink">
        —
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
  expiresAt: number
  maxBytes: number
}): string {
  const { locale, nonce } = props
  const t = locale.t

  const config = safeJson({
    id: props.id,
    expiresAt: props.expiresAt,
    maxBytes: props.maxBytes,
    t: {
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
        <Header locale={locale} right={<Countdown locale={locale} />} />

        {/*
          * The document heading. It states what is happening rather than
          * repeating the request below it: the old page put "X is asking for Y"
          * in an h1 and then restated both in the panel, which is noise exactly
          * where attention is scarce. A page with no h1 is an accessibility
          * defect, so the sentence that frames the decision does the job.
          */}
        <h1 class="mb-5 text-[15px] leading-relaxed font-normal text-dim">{t.intro}</h1>

        {/* What the agent claims. Presented as a claim, never as a fact. */}
        <section class={`${PANEL} mb-4 p-4`}>
          <p class={LABEL}>{t.whoLabel}</p>
          <p class="mb-3 font-mono text-[15px] font-semibold break-words text-ink">
            {props.requester}
          </p>

          <p class={LABEL}>{t.whatLabel}</p>
          <p class="font-mono text-[15px] font-semibold break-words text-ink">{props.label}</p>

          {props.purpose ? (
            <>
              <p class={`${LABEL} mt-3`}>{t.whyLabel}</p>
              <p class="text-sm leading-relaxed break-words text-dim">“{props.purpose}”</p>
            </>
          ) : null}

          <p class="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-faint">
            {t.unverified}
          </p>
        </section>

        {/* Fixed text. The agent cannot alter or remove it — that is its value. */}
        <p class="mb-6 rounded-lg border border-caution/25 bg-caution/5 p-4 text-[13px] leading-relaxed text-caution">
          {t.caution}
        </p>

        <form id="form" novalidate>
          <div class="mb-2 flex items-baseline justify-between gap-3">
            <label for="secret" class={LABEL}>
              {t.inputLabel}
            </label>
            <button
              type="button"
              id="toggle"
              aria-pressed="false"
              class="font-mono text-xs text-phosphor underline-offset-4 hover:underline"
            >
              [ {t.show} ]
            </button>
          </div>

          <textarea
            id="secret"
            rows={3}
            required
            spellcheck={false}
            autocapitalize="off"
            autocorrect="off"
            autocomplete="off"
            aria-describedby="field-note"
            class="w-full resize-y rounded-lg border border-line bg-surface p-3 font-mono text-sm text-ink placeholder:text-faint"
            placeholder="············"
          />

          <div
            id="error"
            role="alert"
            hidden
            class="mt-3 rounded-lg border border-alarm/30 bg-alarm/10 p-3 text-sm text-alarm"
          />

          <button
            type="submit"
            id="submit"
            class="mt-4 w-full rounded-lg bg-phosphor px-4 py-3 font-mono text-sm font-bold tracking-wide text-surface uppercase disabled:opacity-50"
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

        <div id="field-note" class="mt-5 space-y-1 text-xs leading-relaxed text-faint">
          <p>{t.noteEncrypted}</p>
          <p>{t.noteSingleUse}</p>
        </div>
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
            class={`mx-auto mb-5 flex h-11 w-16 items-center justify-center rounded border font-mono text-sm ${border}`}
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
        <Header locale={locale} />
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

  var dead = false;
  function tick() {
    var left = Math.max(0, Math.round((CFG.expiresAt - Date.now()) / 1000));
    if (left <= 0) {
      countdown.textContent = CFG.t.expired;
      if (!dead) { dead = true; location.replace('/s/' + CFG.id); }
      return;
    }
    var m = Math.floor(left / 60), s = left % 60;
    countdown.textContent = m > 0 ? m + ':' + String(s).padStart(2, '0') : '0:' + String(s).padStart(2, '0');
    setTimeout(tick, 1000);
  }
  tick();

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
