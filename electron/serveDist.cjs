// Serve the built web app (dist/) entirely from disk — no network service
// involved, so the desktop app shell loads even when the machine has no WiFi
// or internet at all. This replaces the previous `net.fetch(file://…)` path,
// which routed every asset through Chromium's network stack (the one part of
// the load path that can be affected by connection state).
//
// Pure module: `serveFromDist(url, distDir)` is a plain function returning a
// WHATWG Response, unit-tested in scripts/serve-dist-test.mjs with no network.

const path = require('node:path');
const fs = require('node:fs');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json',
  '.pdf': 'application/pdf',
};

/** Content type for a file path, falling back to a safe default. */
function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function fileResponse(file) {
  const data = fs.readFileSync(file);
  return new Response(data, {
    status: 200,
    headers: {
      'Content-Type': mimeFor(file),
      'Content-Length': String(data.length),
      'Cache-Control': 'no-cache',
    },
  });
}

/**
 * Resolve an app:// request URL to a file inside `distDir` and serve it.
 * - `/` and `` → `/index.html`
 * - existing files → served with a correct Content-Type
 * - anything else → SPA fallback to index.html (deep links / refresh)
 * - path traversal is rejected (403), missing files → 404
 */
function serveFromDist(url, distDir) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url).pathname);
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  if (pathname === '/' || pathname === '') pathname = '/index.html';

  // Resolve inside distDir only — no path traversal.
  const target = path.resolve(distDir, `.${pathname}`);
  if (target !== distDir && !target.startsWith(distDir + path.sep)) {
    return new Response('Forbidden', { status: 403 });
  }
  if (fs.existsSync(target) && fs.statSync(target).isFile()) {
    return fileResponse(target);
  }

  // SPA fallback → index.html (keeps deep links/refresh working).
  const fallback = path.join(distDir, 'index.html');
  return fs.existsSync(fallback) && fs.statSync(fallback).isFile()
    ? fileResponse(fallback)
    : new Response('Not found', { status: 404 });
}

module.exports = { serveFromDist, mimeFor };
