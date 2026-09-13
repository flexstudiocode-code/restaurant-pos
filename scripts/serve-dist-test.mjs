// Offline shell test: the desktop app must load its UI straight from disk
// with zero network involvement. This runs the exact serving function used by
// electron/main.cjs (electron/serveDist.cjs) against a fixture dist/ — there
// is no network here at all, which is the point: if the shell serves in this
// test, it serves with WiFi/internet off.
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { serveFromDist } = require('../electron/serveDist.cjs');

let failures = 0;
function check(name, ok, extra = '') {
  if (!ok) {
    failures++;
    console.log(`✗ ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

// ── Build a fixture dist/ ─────────────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), 'flexpos-serve-'));
try {
  mkdirSync(join(dir, 'assets'));
  mkdirSync(join(dir, 'icons'));
  writeFileSync(
    join(dir, 'index.html'),
    '<!doctype html><html><head><title>POS</title>' +
      '<link rel="manifest" href="/manifest.webmanifest">' +
      '<script type="module" src="/assets/app-abc123.js"></script>' +
      '<link rel="stylesheet" href="/assets/app-abc123.css"></head>' +
      '<body><div id="root"></div></body></html>'
  );
  writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log("hello");');
  writeFileSync(join(dir, 'assets', 'app-abc123.css'), 'body { color: #000; }');
  writeFileSync(join(dir, 'icons', 'icon-192.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(join(dir, 'manifest.webmanifest'), '{"name":"POS"}');

  // ── Index + root resolve to the shell with the right MIME ───────────────
  const index = serveFromDist('app://bundle/', dir);
  check('root serves index.html (text/html)', index.status === 200 && index.headers.get('Content-Type')?.startsWith('text/html'));
  const shell = await index.text();
  check('shell references hashed assets', shell.includes('/assets/app-abc123.js') && shell.includes('/assets/app-abc123.css'));

  // ── Hashed assets are served with correct MIME ──────────────────────────
  const js = serveFromDist('app://bundle/assets/app-abc123.js', dir);
  check('JS asset served as javascript', js.status === 200 && js.headers.get('Content-Type')?.includes('javascript'));
  check('JS asset body intact', (await js.text()).includes('hello'));

  const css = serveFromDist('app://bundle/assets/app-abc123.css', dir);
  check('CSS asset served as css', css.status === 200 && css.headers.get('Content-Type')?.includes('css'));

  const icon = serveFromDist('app://bundle/icons/icon-192.png', dir);
  check('PNG icon served as image/png', icon.status === 200 && icon.headers.get('Content-Type') === 'image/png');

  const manifest = serveFromDist('app://bundle/manifest.webmanifest', dir);
  check('manifest served', manifest.status === 200 && (await manifest.text()).includes('POS'));

  // ── SPA fallback for unknown routes (deep links / refresh) ──────────────
  const deep = serveFromDist('app://bundle/orders/123', dir);
  check('unknown route falls back to index.html', deep.status === 200 && (await deep.text()).includes('<div id="root">'));

  // ── Security: no path traversal outside dist/ ───────────────────────────
  // `..` / `%2e%2e` are normalized away by URL parsing, so the request lands
  // inside distDir and (not being a real file) falls back to the shell — the
  // parent's package.json is never served.
  const escape = serveFromDist('app://bundle/../package.json', dir);
  const escapeBody = await escape.text();
  check(
    '`..` never serves outside dist/',
    escape.status === 200 && escapeBody.includes('<div id="root">'),
    `status ${escape.status}`
  );
  // Encoded separators survive URL parsing (`%2f` → `/`, `%5c` → `\` on
  // Windows), so the decode+resolve guard must reject them.
  const slashTraversal = serveFromDist('app://bundle/..%2f..%2fpackage.json', dir);
  check('encoded slash traversal rejected (403)', slashTraversal.status === 403, `status ${slashTraversal.status}`);
  const backslashTraversal = serveFromDist('app://bundle/..%5c..%5cpackage.json', dir);
  check('encoded backslash traversal rejected (403)', backslashTraversal.status === 403, `status ${backslashTraversal.status}`);

  // ── Missing files fall back to the shell (SPA behaviour) ────────────────
  const missing = serveFromDist('app://bundle/nope.txt', dir);
  check('missing file falls back to shell', missing.status === 200 && (await missing.text()).includes('<div id="root">'));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures > 0 ? `\n${failures} FAILURE(S)` : '\nAll offline shell tests passed ✅');
process.exit(failures > 0 ? 1 : 0);
