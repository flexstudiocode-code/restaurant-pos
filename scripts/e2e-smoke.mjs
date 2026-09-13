// End-to-end smoke test: boots the real desktop app (Electron, hidden window,
// throwaway profile) and drives it over the DevTools protocol the way a cashier
// would — sign in, bill a delivery order with a delivery charge, take the cash,
// read the receipt, check Reports and the Z-report, look at the kitchen screen
// and verify the waiter role restrictions.
//
// It fails loudly (non-zero exit) if any of those flows break, so the whole
// stack is covered without a human clicking through the app.
//
//   npm run test:e2e            (builds dist/ first, then runs this)
//   node scripts/e2e-smoke.mjs  (expects dist/ to be built)
//
// Env knobs:
//   E2E_PORT=9333   DevTools protocol port
//   E2E_SHOW=1      keep the window visible (debugging)

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.E2E_PORT || 9333);
const DEBUG_ORIGIN = `http://127.0.0.1:${PORT}`;
const SHOW = process.env.E2E_SHOW === '1';
const STEP_TIMEOUT = 20000;

if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
  console.error('[e2e] dist/index.html not found — run `npm run build` first (or use `npm run test:e2e`).');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── tiny test reporter (same style as the other suites) ────────────────────
let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ── DevTools protocol client ───────────────────────────────────────────────
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener('message', (event) => {
      const raw = typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8');
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(msg.error.message || 'CDP error'));
      else entry.resolve(msg.result);
    });
  }

  static async connect(url) {
    const Impl = typeof WebSocket === 'function' ? WebSocket : (await import('ws')).WebSocket;
    const ws = new Impl(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error(`could not open ${url}`)), { once: true });
    });
    return new Cdp(ws);
  }

  send(method, params = {}, timeoutMs = STEP_TIMEOUT) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Evaluate an expression in the page and return its value. */
  async evaluate(expression, timeoutMs = STEP_TIMEOUT) {
    const res = await this.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, userGesture: true },
      timeoutMs
    );
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      throw new Error(d.exception?.description || d.text || 'page exception');
    }
    return res.result?.value;
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }
}

async function waitForPageTarget(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${DEBUG_ORIGIN}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && String(t.url || '').startsWith('app://'));
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      /* devtools endpoint not up yet */
    }
    if (Date.now() > deadline) throw new Error('the app never exposed a debuggable page');
    await sleep(250);
  }
}

/** Poll the page until `expr` is truthy. */
async function waitFor(cdp, expr, label, timeoutMs = STEP_TIMEOUT) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  for (;;) {
    try {
      if (await cdp.evaluate(expr)) return true;
    } catch (err) {
      lastError = err.message;
    }
    if (Date.now() > deadline) {
      const text = await cdp.evaluate('document.body.innerText.slice(0, 400)').catch(() => '');
      throw new Error(`timed out waiting for ${label}${lastError ? ` (${lastError})` : ''}\nscreen was: ${JSON.stringify(text)}`);
    }
    await sleep(120);
  }
}

// ── the page-side helpers, injected into the app after every load ──────────
// Written as a normal function and stringified so it stays readable/lintable.
function installHelpers() {
  const byText = (label, exact) =>
    [...document.querySelectorAll('button, a')].find((el) =>
      exact === false ? el.textContent.includes(label) : el.textContent.trim() === label
    );
  const setValue = (el, value) => {
    const proto =
      el.tagName === 'SELECT'
        ? HTMLSelectElement.prototype
        : el.tagName === 'TEXTAREA'
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };
  // Desktop has a sidebar; phones/tablets have the bottom nav.
  const navButtons = () => [
    ...document.querySelectorAll('.sidebar .side-nav-item, .bottomnav button, nav button'),
  ];
  window.__e2e = {
    text: () => document.body.innerText,
    has: (s) => document.body.innerText.includes(s),
    click: (label, exact) => {
      const el = byText(label, exact);
      if (!el) return false;
      el.click();
      return true;
    },
    /** Value shown next to a checkout/report label, e.g. rowValue('Total'). */
    rowValue: (key) => {
      const row = [...document.querySelectorAll('.sum-row')].find((r) =>
        (r.querySelector('.k')?.textContent || '').trim().startsWith(key)
      );
      return row ? (row.querySelector('.v')?.textContent || '').trim() : null;
    },
    /** Value of a Reports stat tile, e.g. statValue('Net sales'). */
    statValue: (key) => {
      const card = [...document.querySelectorAll('.stat-card')].find(
        (c) => (c.querySelector('.k')?.textContent || '').trim() === key
      );
      return card ? (card.querySelector('.v')?.textContent || '').trim() : null;
    },
    fill: (placeholder, value) => {
      const el = [...document.querySelectorAll('input')].find((i) => i.placeholder === placeholder);
      return el ? setValue(el, value) : false;
    },
    /** Menu item helpers — the price is read from the card so tests never
     *  depend on hard-coded seed prices. */
    itemRupees: (name) => {
      const card = [...document.querySelectorAll('.item-card')].find(
        (c) => (c.querySelector('.i-name')?.textContent || '').trim() === name
      );
      if (!card) return null;
      return Number((card.querySelector('.i-price')?.textContent || '').replace(/[^0-9.]/g, ''));
    },
    addItem: (name) => {
      const card = [...document.querySelectorAll('.item-card')].find(
        (c) => (c.querySelector('.i-name')?.textContent || '').trim() === name
      );
      if (!card) return 'missing';
      const add = card.querySelector('.add-btn');
      if (add) {
        add.click();
        return 'added';
      }
      const plus = card.querySelector('.qty-pill button:last-child');
      if (plus) {
        plus.click();
        return 'incremented';
      }
      return 'unavailable';
    },
    tabs: () => navButtons().map((b) => b.textContent.trim()),
    openTab: (name) => {
      const el = navButtons().find((b) => b.textContent.trim() === name);
      if (!el) return false;
      el.click();
      return true;
    },
    /** Sign-in PIN pad. Taps are spaced out so React re-renders between keys
     *  (the pad reads its own state to decide when the PIN is complete). */
    pressPin: async (pin) => {
      const tick = () => new Promise((r) => setTimeout(r, 60));
      for (const digit of pin) {
        const key = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === digit);
        if (!key) return false;
        key.click();
        await tick();
      }
      const ok = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'OK');
      if (!ok) return false;
      ok.click();
      await tick();
      return true;
    },
    /** Icon-only controls carry their label in the tooltip on desktop. */
    clickTitle: (title) => {
      const el = [...document.querySelectorAll('button, a')].find(
        (b) => b.getAttribute('title') === title
      );
      if (!el) return false;
      el.click();
      return true;
    },
    /** Leave a full-screen view (order/receipt) back to the tab shell, where
     *  the bottom/side navigation lives. */
    backToTables: () => {
      const el = [...document.querySelectorAll('button')].find(
        (b) => b.textContent.trim() === 'Back to tables'
      );
      if (!el) return false;
      el.click();
      return true;
    },
    kotCount: () => document.querySelectorAll('.kot-card').length,
    /** Take the staged cash tender: 'Complete' pays in full, 'Add' records a
     *  partial payment. Returns which one was offered. */
    payTender: () => {
      const btn = [...document.querySelectorAll('button')].find((b) =>
        ['Complete', 'Add'].includes(b.textContent.trim())
      );
      if (!btn) return null;
      const label = btn.textContent.trim();
      btn.click();
      return label;
    },
    /** Dismiss whatever modal/sheet is open (Escape is the app's own binding). */
    escape: () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return true;
    },
  };
  return true;
}

const HELPERS = `(${installHelpers.toString()})();`;

// ── launch the app ─────────────────────────────────────────────────────────
const profileDir = mkdtempSync(join(tmpdir(), 'pos-e2e-'));
console.log(`[e2e] launching Electron (profile ${profileDir})`);

const electron = spawn(
  electronPath,
  [
    '.',
    `--remote-debugging-port=${PORT}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${profileDir}`,
  ],
  {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FLEXPOS_E2E_TEST: SHOW ? '' : '1' },
  }
);

let appOutput = '';
electron.stdout.on('data', (d) => {
  appOutput += d.toString();
});
electron.stderr.on('data', (d) => {
  appOutput += d.toString();
});

let cdp = null;
let exitCode = 0;

/** Shut the app down and delete the throwaway profile. The directory is only
 *  removable once Electron has really exited (Windows keeps a lock on it
 *  while the process is alive), hence the wait + retries. */
async function cleanup() {
  cdp?.close();
  if (electron.exitCode === null) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 5000);
      electron.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      electron.kill();
    });
  }
  try {
    rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  } catch {
    console.log(`[e2e] note: could not delete ${profileDir} (safe to remove by hand)`);
  }
}

try {
  const target = await waitForPageTarget();
  cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.evaluate(HELPERS);

  const body = (expr) => cdp.evaluate(expr);

  // ── 1. sign in as the manager ────────────────────────────────────────────
  await waitFor(cdp, `window.__e2e.has('Enter staff PIN')`, 'the sign-in screen');
  await body(`window.__e2e.pressPin('0000')`);
  await waitFor(cdp, `window.__e2e.has("Today's sales")`, 'the Tables screen after sign-in');
  check(
    'sign-in with the manager PIN reaches the Tables screen',
    await body(`window.__e2e.has('COUNTER ORDERS') && window.__e2e.has('DINE-IN')`)
  );
  check(
    'a fresh profile starts with no sales',
    (await body(`window.__e2e.text()`)).includes('₹0'),
    'expected ₹0 on the sales tile'
  );

  // ── 2. bill a delivery order, adding a delivery charge ──────────────────
  check('delivery counter order opens', await body(`window.__e2e.click('🛵 Delivery')`));
  await waitFor(cdp, `window.__e2e.has('item(s)')`, 'the order screen');

  const tea = await body(`window.__e2e.itemRupees('Tea')`);
  const coffee = await body(`window.__e2e.itemRupees('Coffee')`);
  check('menu items are listed with prices', tea === 15 && coffee === 20, `Tea=${tea}, Coffee=${coffee}`);

  check('adding an item works', (await body(`window.__e2e.addItem('Tea')`)) === 'added');
  check('adding a second item works', (await body(`window.__e2e.addItem('Coffee')`)) === 'added');
  check('cart reflects both items', await body(`window.__e2e.has('2 item(s)')`));

  // Send the order to the kitchen (covers the KOT flow + the kitchen screen).
  check('order can be sent to the kitchen', await body(`window.__e2e.click('🔥 KOT')`));

  const payClicked = await body(
    `window.__e2e.click('Pay ', false)`
  );
  check('checkout opens from the cart bar', payClicked);
  await waitFor(cdp, `window.__e2e.has('Checkout — Delivery')`, 'the checkout screen');

  check(
    'the delivery-charge field appears on a delivery bill',
    await body(`window.__e2e.fill('Delivery fee (₹)', '30')`)
  );
  await waitFor(cdp, `window.__e2e.rowValue('Delivery charge') === '₹30'`, 'the delivery charge to land on the bill');

  // Food total, then rounded to the rupee.
  const food = (tea + coffee) * 100;
  const payablePaise = Math.round((food + 3000) / 100) * 100;
  const payable = `₹${payablePaise / 100}`;

  check(
    'bill total = food + delivery charge, rounded',
    (await body(`window.__e2e.rowValue('Total')`)) === payable,
    `wanted ${payable}`
  );

  // ── 3. take the cash and read the receipt ───────────────────────────────
  await body(`window.__e2e.click('Exact')`);
  await waitFor(
    cdp,
    `(document.querySelector('input[placeholder="Cash received"]')?.value || '').length > 0`,
    'the exact-cash amount to be staged'
  );
  check('exact cash is offered as a full payment', (await body(`window.__e2e.payTender()`)) === 'Complete');
  await waitFor(cdp, `window.__e2e.has('Payment complete')`, 'the receipt screen');

  const receipt = await body(`window.__e2e.text()`);
  check('receipt is issued as an invoice', receipt.includes('INVOICE'));
  check(
    'receipt shows the delivery charge',
    /delivery charge/i.test(receipt) && receipt.includes('+ 30.00'),
    'expected a "Delivery charge + 30.00" line'
  );
  check(
    'receipt total matches the bill',
    receipt.includes(`${(payablePaise / 100).toFixed(2)}`),
    `wanted ${(payablePaise / 100).toFixed(2)}`
  );

  // ── 4. reports reflect the bill ─────────────────────────────────────────
  check('the receipt screen returns to the tab shell', await body(`window.__e2e.backToTables()`));
  await waitFor(cdp, `window.__e2e.tabs().includes('Reports')`, 'the tab shell');
  await body(`window.__e2e.openTab('Reports')`);
  await waitFor(cdp, `window.__e2e.has('Net sales')`, 'the Reports screen');
  check('reports count the bill', (await body(`window.__e2e.statValue('Bills')`)) === '1');
  check(
    'reports net sales match the bill total',
    (await body(`window.__e2e.statValue('Net sales')`)) === payable,
    `wanted ${payable}`
  );
  check('reports show delivery charges collected', await body(`window.__e2e.has('Delivery charges collected')`));

  // ── 5. the end-of-day Z-report ──────────────────────────────────────────
  check('Z-report can be opened', await body(`window.__e2e.click('Z-report', false)`));
  await waitFor(cdp, `window.__e2e.has('Z-REPORT (END OF DAY)')`, 'the Z-report');
  const ztext = await body(`window.__e2e.text()`);
  check('Z-report shows cash in drawer', ztext.includes('CASH IN DRAWER') && ztext.includes(payable));
  check('Z-report lists the delivery charge', ztext.includes('Delivery charges'));
  await body(`window.__e2e.escape()`);
  await waitFor(cdp, `!window.__e2e.has('Z-REPORT (END OF DAY)')`, 'the Z-report to close');

  // ── 6. kitchen display ─────────────────────────────────────────────────
  await body(`window.__e2e.openTab('Kitchen')`);
  await waitFor(cdp, `window.__e2e.kotCount() >= 1`, 'the kitchen ticket to appear');
  check('the kitchen screen shows the ticket just sent', (await body(`window.__e2e.kotCount()`)) >= 1);
  check('the kitchen sound toggle is present', await body(`window.__e2e.has('🔔') || window.__e2e.has('🔕')`));

  // ── 7. role restrictions ───────────────────────────────────────────────
  await body(`window.__e2e.openTab('Tables')`);
  await waitFor(cdp, `window.__e2e.has('COUNTER ORDERS')`, 'the Tables screen');
  check(
    'sign out works',
    await body(`window.__e2e.click('Sign out') || window.__e2e.clickTitle('Sign out')`)
  );
  await waitFor(cdp, `window.__e2e.has('Enter staff PIN')`, 'the sign-in screen');
  await body(`window.__e2e.pressPin('2222')`);
  await waitFor(cdp, `window.__e2e.has('COUNTER ORDERS')`, 'the Tables screen after the waiter signs in');
  const waiterTabs = await body(`window.__e2e.tabs()`);
  check(
    'a waiter cannot reach Settings / Menu / Reports',
    !waiterTabs.includes('Settings') && !waiterTabs.includes('Menu') && !waiterTabs.includes('Reports'),
    `tabs were ${JSON.stringify(waiterTabs)}`
  );
} catch (err) {
  check('the end-to-end walkthrough ran to completion', false, err.message);
  if (appOutput.trim()) console.log(`\n[e2e] app output:\n${appOutput.trim().split('\n').slice(-15).join('\n')}`);
} finally {
  await cleanup();
}

console.log(
  failures.length === 0
    ? `\nAll ${passed} end-to-end checks passed ✅`
    : `\n${failures.length} of ${passed + failures.length} end-to-end check(s) FAILED ❌\n  ${failures.join('\n  ')}`
);
exitCode = failures.length === 0 ? 0 : 1;
process.exit(exitCode);
