// Tests for the Razorpay payment helper server (server/lib.cjs).
// Run: npm run test:pay
import http from 'node:http';
import crypto from 'node:crypto';
import { createPaymentServer, verifyRazorpaySignature } from '../server/lib.cjs';

let failures = 0;
function check(name, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) {
    failures++;
    console.log(`✗ ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function baseUrl(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function main() {
  const SECRET = 'rzp_secret_test_123';
  const KEY_ID = 'rzp_test_abc';

  // ── 1. Signature verification (pure function) ──────────────────────────
  const orderId = 'order_Nx1mock';
  const paymentId = 'pay_mock_1';
  const goodSig = crypto
    .createHmac('sha256', SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  check('sig: valid', verifyRazorpaySignature({ orderId, paymentId, signature: goodSig }, SECRET), true);
  check('sig: tampered payment id', verifyRazorpaySignature({ orderId, paymentId: 'pay_mock_2', signature: goodSig }, SECRET), false);
  check('sig: wrong secret', verifyRazorpaySignature({ orderId, paymentId, signature: goodSig }, 'other'), false);
  check('sig: no secret configured', verifyRazorpaySignature({ orderId, paymentId, signature: goodSig }, ''), false);
  check('sig: missing fields', verifyRazorpaySignature({}, SECRET), false);

  // ── 2. E2E: mock Razorpay API + the real helper server ────────────────
  const expectedAuth = 'Basic ' + Buffer.from(`${KEY_ID}:${SECRET}`).toString('base64');
  const mock = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://x');
    const send = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(JSON.stringify(obj));
    };
    const authOk = (req.headers.authorization || '') === expectedAuth;
    if (url.pathname === '/v1/orders' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (!authOk) return send(401, { error: { description: 'unauthorized' } });
        const b = JSON.parse(body);
        send(200, { id: 'order_mock_1', amount: b.amount, currency: b.currency || 'INR' });
      });
      return;
    }
    if (url.pathname.startsWith('/v1/payments/') && req.method === 'GET') {
      if (!authOk) return send(401, { error: { description: 'unauthorized' } });
      send(200, { method: 'upi' });
      return;
    }
    send(404, { error: { description: 'not found' } });
  });
  await listen(mock);

  const helper = createPaymentServer({
    keyId: KEY_ID,
    keySecret: SECRET,
    apiBase: `${baseUrl(mock)}/v1`,
  });
  await listen(helper);
  const base = baseUrl(helper);

  const call = async (path, body, method = 'POST') => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', Connection: 'close' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  };

  const health = await call('/api/health', undefined, 'GET');
  check('health: ok', health.json.ok, true);
  check('health: configured', health.json.configured, true);
  check('health: mode test', health.json.mode, 'test');

  const order = await call('/api/order', { amount: 12345, receipt: 'POS-test' });
  check('order: ok', order.json.ok, true);
  check('order: id from razorpay', order.json.orderId, 'order_mock_1');
  check('order: amount echoed', order.json.amount, 12345);

  const badAmt = await call('/api/order', { amount: 0 });
  check('order: rejects zero amount', badAmt.status, 400);
  check('order: zero amount ok=false', badAmt.json.ok, false);

  const sig = crypto
    .createHmac('sha256', SECRET)
    .update(`${order.json.orderId}|pay_mock_1`)
    .digest('hex');
  const ver = await call('/api/verify', {
    orderId: order.json.orderId,
    paymentId: 'pay_mock_1',
    signature: sig,
  });
  check('verify: ok', ver.json.ok, true);
  check('verify: method from razorpay', ver.json.method, 'upi');

  const badVer = await call('/api/verify', {
    orderId: order.json.orderId,
    paymentId: 'pay_mock_1',
    signature: 'deadbeef',
  });
  check('verify: rejects bad signature', badVer.json.ok, false);

  // ── 3. Server without keys configured → nothing can be ordered/verified ──
  const bare = createPaymentServer({ keyId: '', keySecret: '', apiBase: `${baseUrl(mock)}/v1` });
  await listen(bare);
  const bareBase = baseUrl(bare);
  const bareCall = async (path, body) => {
    const res = await fetch(bareBase + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Connection: 'close' },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  };
  const bareOrder = await bareCall('/api/order', { amount: 10000 });
  check('no-keys: order rejected', bareOrder.json.ok, false);
  const bareVer = await bareCall('/api/verify', {
    orderId: 'order_x',
    paymentId: 'pay_x',
    signature: goodSig,
  });
  check('no-keys: verify rejected', bareVer.json.ok, false);

  await closeServer(mock);
  await closeServer(helper);
  await closeServer(bare);

  console.log(failures === 0 ? '\nAll payment-server tests passed ✅' : `\n${failures} test(s) FAILED ❌`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
