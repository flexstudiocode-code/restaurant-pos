// Meadows Park POS — payment helper server (CLI entry).
//
// Runs the dependency-free Razorpay helper from lib.cjs. The secret key is
// read from the environment ONLY — never from the app, never from a file.
//
//   RAZORPAY_KEY_ID=rzp_test_xxxxxxxx RAZORPAY_KEY_SECRET=yyyyyyyy \
//     node server/index.cjs
//
// Optional env: PORT (default 8787), RAZORPAY_API_BASE (default the live
// Razorpay API — override only for tests).

'use strict';

const { createPaymentServer } = require('./lib.cjs');

const keyId = process.env.RAZORPAY_KEY_ID || '';
const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
const port = Number(process.env.PORT || 8787);
const apiBase = process.env.RAZORPAY_API_BASE || 'https://api.razorpay.com/v1';

if (!keyId || !keySecret) {
  console.warn(
    '⚠  RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set — /api/order and /api/verify\n' +
      '   will reject requests. Get keys from the Razorpay dashboard (use rzp_test_… first).'
  );
}

const server = createPaymentServer({ keyId, keySecret, apiBase });

server.listen(port, () => {
  const mode = keyId.startsWith('rzp_test_')
    ? 'TEST mode'
    : keyId.startsWith('rzp_live_')
      ? 'LIVE mode'
      : 'not configured';
  console.log(`Payment helper server listening on http://localhost:${port} (${mode})`);
  console.log('Routes: GET /api/health · POST /api/order · POST /api/verify');
});

// Let the process exit cleanly on Ctrl+C / SIGTERM.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
