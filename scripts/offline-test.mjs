// Offline regression test: runs the service worker's exact fetch logic against
// the production build (dist/) with a network that ALWAYS fails. If the app
// shell and all assets are served from cache, the app is truly offline-capable.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

let failures = 0;
function check(name, ok, extra = '') {
  if (!ok) {
    failures++;
    console.log(`✗ ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

// ── 1. Build the precache list exactly like scripts/gen-sw.mjs ────────────
const indexHtml = readFileSync(join(dist, 'index.html'), 'utf8');
const assets = [...indexHtml.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
const icons = existsSync(join(dist, 'icons'))
  ? readdirSync(join(dist, 'icons')).filter((f) => f.endsWith('.png')).map((f) => `/icons/${f}`)
  : [];
const core = ['/', '/index.html', '/manifest.webmanifest', ...icons, ...assets];
check('precache list has hashed assets', assets.length >= 2, `assets: ${assets.join(', ')}`);

// Every precache entry must exist on disk (or the install step would fail).
const missing = core.filter((p) => {
  if (p === '/') return !existsSync(join(dist, 'index.html'));
  return !existsSync(join(dist, p.replace(/^\//, '')));
});
check('all precached files exist in dist/', missing.length === 0, missing.join(', '));

// ── 2. In-memory cache store, seeded like the SW install step ─────────────
const cache = new Map();
for (const p of core) {
  const file = join(dist, p === '/' ? 'index.html' : p.replace(/^\//, ''));
  cache.set(p, readFileSync(file));
}

// Offline network: every fetch rejects.
function offlineFetch() {
  return Promise.reject(new TypeError('Failed to fetch (offline)'));
}

// The service worker fetch handler (kept in sync with public/sw.js logic):
// navigations → network first, fall back to cached shell; assets → cache first.
function swFetch(reqUrl, reqMode, network = offlineFetch) {
  const url = new URL(reqUrl, 'http://localhost');
  const path = url.pathname;
  if (reqMode === 'navigate') {
    return network(reqUrl)
      .then((res) => res)
      .catch(() => {
        const body = cache.get('/index.html');
        if (!body) throw new Error('shell not cached');
        return new Response(body, { status: 200, headers: { 'Content-Type': 'text/html' } });
      });
  }
  const cached = cache.get(path);
  if (cached) {
    const ct = path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'text/javascript' : 'image/png';
    return Promise.resolve(new Response(cached, { status: 200, headers: { 'Content-Type': ct } }));
  }
  return network(reqUrl);
}

// ── 3. Offline navigation ─────────────────────────────────────────────────
const nav = await swFetch('/', 'navigate');
const html = await nav.text();
check('offline navigation serves the app shell', nav.status === 200 && html.includes('<div id="root">'));
check('shell references hashed assets', assets.every((a) => html.includes(a)), 'missing asset refs in shell');

// ── 4. Every asset is served from cache with the network down ─────────────
let allAssetsServed = true;
for (const a of assets) {
  const res = await swFetch(a, 'no-cors');
  if (res.status !== 200 || (await res.arrayBuffer()).byteLength === 0) allAssetsServed = false;
}
check('all assets served from cache offline', allAssetsServed);

// Icons + manifest too
let extraServed = true;
for (const p of ['/manifest.webmanifest', ...icons]) {
  const res = await swFetch(p, 'no-cors');
  if (res.status !== 200) extraServed = false;
}
check('manifest + icons served from cache offline', extraServed);

// ── 5. A file that is NOT cached must fail (no silent network guesses) ────
const unknown = await swFetch('/does-not-exist.js', 'no-cors').catch(() => null);
check('uncached file fails cleanly offline', unknown === null);

console.log(failures > 0 ? `\n${failures} FAILURE(S)` : '\nAll offline tests passed ✅');
process.exit(failures > 0 ? 1 : 0);
