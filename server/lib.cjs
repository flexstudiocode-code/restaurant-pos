// Razorpay payment helper — pure server logic, zero dependencies.
//
// Why this server exists (the "safe" part of online payments):
//   * The Razorpay SECRET key never ships inside the app — it lives only
//     here, in an env var. The app (web/Android/desktop) only knows the
//     public Key ID.
//   * Razorpay orders can only be created with the secret, so this server
//     creates them.
//   * A payment is only accepted after this server verifies the Razorpay
//     signature (HMAC-SHA256 of `order_id|payment_id` with the secret).
//     The app never marks a bill paid just because the browser said so.
//
// Run: RAZORPAY_KEY_ID=rzp_test_… RAZORPAY_KEY_SECRET=… node server/index.cjs
// Requires Node 18+ (global fetch). Covered by `npm run test:pay`.

'use strict';

const http = require('node:http');
const crypto = require('node:crypto');

/**
 * Verify the Razorpay payment signature:
 *   signature = HMAC-SHA256(`${orderId}|${paymentId}`, keySecret)
 * Returns true only for a valid signature (constant-time compare).
 */
function verifyRazorpaySignature({ orderId, paymentId, signature }, keySecret) {
  if (
    !keySecret ||
    typeof orderId !== 'string' ||
    typeof paymentId !== 'string' ||
    typeof signature !== 'string'
  ) {
    return false;
  }
  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function authHeaders(keyId, keySecret) {
  return {
    'Content-Type': 'application/json',
    Authorization: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64'),
  };
}

/** Call the Razorpay REST API (apiBase is injectable for tests). */
async function razorpayRequest(apiBase, path, { keyId, keySecret, method = 'GET', body } = {}) {
  const res = await fetch(apiBase + path, {
    method,
    headers: authHeaders(keyId, keySecret),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, json, text };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) req.destroy(new Error('Body too large'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Build the payment helper server. Routes:
 *   GET  /api/health — server up? configured? test or live mode?
 *   POST /api/order  — { amount (paise), receipt? } → creates a Razorpay
 *                      order, returns { ok, orderId, amount, currency }
 *   POST /api/verify — { orderId, paymentId, signature } → verifies the
 *                      payment server-side, returns { ok, method? }
 * CORS is wide open (*): this is a thin local helper with no secrets of its
 * own, and the app may be served from any origin (localhost, LAN IP, app://).
 */
function createPaymentServer({ keyId = '', keySecret = '', apiBase = 'https://api.razorpay.com/v1' } = {}) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const send = (status, obj) => {
      const body = JSON.stringify(obj);
      res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
      res.end(body);
    };

    let url;
    try {
      url = new URL(req.url || '/', 'http://localhost');
    } catch {
      send(400, { ok: false, error: 'Bad request' });
      return;
    }

    try {
      if (req.method === 'GET' && url.pathname === '/api/health') {
        const mode = keyId.startsWith('rzp_test_')
          ? 'test'
          : keyId.startsWith('rzp_live_')
            ? 'live'
            : 'unknown';
        send(200, { ok: true, configured: Boolean(keyId && keySecret), mode });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/order') {
        const body = await readJson(req);
        const amount = Math.round(Number(body.amount));
        if (!Number.isFinite(amount) || amount <= 0) {
          send(400, { ok: false, error: 'amount must be a positive number of paise' });
          return;
        }
        const rzp = await razorpayRequest(apiBase, '/orders', {
          keyId,
          keySecret,
          method: 'POST',
          body: {
            amount,
            currency: 'INR',
            receipt: String(body.receipt || 'POS').slice(0, 40),
          },
        });
        if (rzp.status !== 200 || !rzp.json || !rzp.json.id) {
          send(502, {
            ok: false,
            error: rzp.json?.error?.description || rzp.json?.error?.reason || 'Razorpay could not create the order',
          });
          return;
        }
        send(200, { ok: true, orderId: rzp.json.id, amount: rzp.json.amount, currency: rzp.json.currency });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/verify') {
        const body = await readJson(req);
        if (!verifyRazorpaySignature(body, keySecret)) {
          send(200, { ok: false, error: 'signature mismatch' });
          return;
        }
        // Best-effort: fetch the payment's actual method (upi / card / …) so
        // the bill records it correctly. Never fails a verified payment.
        let method = null;
        try {
          const pay = await razorpayRequest(apiBase, `/payments/${encodeURIComponent(body.paymentId)}`, {
            keyId,
            keySecret,
          });
          if (pay.status === 200 && pay.json && typeof pay.json.method === 'string') {
            method = pay.json.method;
          }
        } catch {
          /* method lookup is best-effort */
        }
        send(200, { ok: true, method });
        return;
      }

      send(404, { ok: false, error: 'Not found' });
    } catch (err) {
      send(500, { ok: false, error: err instanceof Error ? err.message : 'Server error' });
    }
  });

  return server;
}

module.exports = { createPaymentServer, verifyRazorpaySignature, razorpayRequest };
