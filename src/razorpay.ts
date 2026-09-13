// Razorpay Checkout integration for online payments (card / UPI / netbanking).
//
// Safety model:
//   * The app only knows the PUBLIC Key ID (stored in Settings).
//   * Orders are created and signatures verified by the payment helper
//     server (server/), which holds the secret key. A bill is only marked
//     paid after that server confirms the signature — never on the word of
//     the checkout modal alone.
//   * Card details are typed into Razorpay's own PCI-DSS compliant page —
//     they never touch this app.
//
// When offline, or when the gateway is not configured, the existing manual
// flow (cash / UPI QR / card) is used instead — this module is purely
// additive.

import { getDesktop } from './desktop';
import type { PaymentGatewaySettings, PaymentMethod } from './types';

export interface RazorpayPaymentResult {
  paymentId: string; // Razorpay payment id — stored as the payment's ref
  method: PaymentMethod; // 'upi' for UPI payments, 'card' for everything else
}

interface RazorpayHandlerResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

let scriptPromise: Promise<void> | null = null;

/** Load Razorpay's checkout script once; cached for later payments. */
export function loadRazorpayScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Razorpay needs a browser'));
  if (window.Razorpay) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        scriptPromise = null; // allow a retry next time
        reject(new Error('Could not load the payment page'));
      };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

/**
 * POST JSON to the payment helper server. On the desktop app the request is
 * routed through the Electron main process (IPC) because the app is served
 * over the secure `app://` scheme, where plain-http fetches are blocked as
 * mixed content. In the browser it's a normal fetch (needs CORS — the helper
 * server allows all origins).
 */
export async function gatewayFetch(
  serverUrl: string,
  path: string,
  body: unknown
): Promise<{
  status: number;
  json: { ok?: boolean; error?: string; orderId?: string; method?: string; mode?: string } | null;
}> {
  const base = serverUrl.trim().replace(/\/+$/, '');
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
  const desktop = getDesktop();
  if (desktop) {
    const res = await desktop.payments.fetch(base + path, init);
    return { status: res.status, json: res.json };
  }
  const res = await fetch(base + path, init);
  let json: {
    ok?: boolean;
    error?: string;
    orderId?: string;
    method?: string;
    mode?: string;
  } | null = null;
  try {
    json = (await res.json()) as typeof json;
  } catch {
    /* non-JSON response */
  }
  return { status: res.status, json };
}

/** Ask the helper server to create a Razorpay order; returns the order id. */
export async function createRazorpayOrder(
  settings: PaymentGatewaySettings,
  amountPaise: number,
  receipt: string
): Promise<string> {
  const { status, json } = await gatewayFetch(settings.serverUrl, '/api/order', {
    amount: amountPaise,
    receipt,
  });
  if (status !== 200 || !json?.ok || !json.orderId) {
    throw new Error(json?.error || 'Could not create the payment');
  }
  return json.orderId;
}

/** Have the helper server verify the payment signature (never trust the
 *  checkout modal on its own). */
export async function verifyRazorpayPayment(
  settings: PaymentGatewaySettings,
  data: { orderId: string; paymentId: string; signature: string }
): Promise<{ ok: boolean; method?: PaymentMethod }> {
  const { json } = await gatewayFetch(settings.serverUrl, '/api/verify', data);
  if (!json?.ok) return { ok: false };
  return { ok: true, method: json.method === 'upi' ? 'upi' : 'card' };
}

/** Open the Razorpay Checkout modal; resolves with the raw handler response
 *  on success, rejects when the customer closes/cancels. */
export function openRazorpayCheckout(opts: {
  keyId: string;
  orderId: string;
  amountPaise: number;
  name: string;
  description: string;
}): Promise<RazorpayHandlerResponse> {
  return new Promise((resolve, reject) => {
    const Razorpay = window.Razorpay;
    if (!Razorpay) {
      reject(new Error('Payment page not loaded'));
      return;
    }
    let settled = false;
    const once = <T>(fn: (v: T) => void) => (v: T) => {
      if (!settled) {
        settled = true;
        fn(v);
      }
    };
    const rzp = new Razorpay({
      key: opts.keyId,
      amount: opts.amountPaise, // paise
      currency: 'INR',
      name: opts.name,
      description: opts.description,
      order_id: opts.orderId,
      theme: { color: '#0f766e' },
      handler: once((response: RazorpayHandlerResponse) => resolve(response)),
      modal: {
        ondismiss: once(() => reject(new Error('Payment cancelled'))),
      },
    });
    rzp.open();
  });
}

/**
 * Full flow: create the order → open Razorpay Checkout → verify the signature
 * server-side. Resolves with the verified payment id + recorded method.
 * Throws if the customer cancels or verification fails (nothing is recorded).
 */
export async function payWithRazorpay(
  settings: PaymentGatewaySettings,
  opts: { amountPaise: number; receipt: string; name: string; description: string }
): Promise<RazorpayPaymentResult> {
  const orderId = await createRazorpayOrder(settings, opts.amountPaise, opts.receipt);
  await loadRazorpayScript();
  const { razorpay_payment_id: paymentId, razorpay_signature: signature } =
    await openRazorpayCheckout({
      keyId: settings.keyId.trim(),
      orderId,
      amountPaise: opts.amountPaise,
      name: opts.name,
      description: opts.description,
    });
  const { ok, method } = await verifyRazorpayPayment(settings, {
    orderId,
    paymentId,
    signature,
  });
  if (!ok) throw new Error('Payment could not be verified — order not marked paid');
  return { paymentId, method: method ?? 'card' };
}
