// api/cashfree-webhook.js
export const config = {
  api: { bodyParser: false }   // raw body chahiye, Vercel ka auto-parse band karo
};

import crypto from 'crypto';
import { notifyDiscord } from './discord-notify.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const isTestMode    = process.env.PRODUCTION_MODE !== 'true';

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function verifySignature(rawBody, timestamp, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(timestamp + rawBody)
    .digest('base64');
  return expected === signature;
}

async function getDonation(order_id) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/donations?order_id=eq.${encodeURIComponent(order_id)}&select=*&limit=1`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const rows = await res.json();
  return rows[0] || null;
}

async function updateDonation(order_id, fields) {
  await fetch(
    `${SUPABASE_URL}/rest/v1/donations?order_id=eq.${encodeURIComponent(order_id)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(fields),
    }
  );
}

const SE_PROVIDER_LABELS = { cashfree: 'Cashfree' };

// Strip our internal [TYPE] prefix and |MEDIA:<url> suffix before sending to
// StreamElements — the Alert Box widget and its built-in Text-to-Speech both
// read the raw `message` field literally, so they must only ever see the
// donor's actual text. The full tagged version stays in Supabase; our own
// /api/latest-audio endpoint reads it from there separately for the custom
// voice-clip widget.
function cleanMessageForSE(raw) {
  if (!raw) return '';
  return raw
    .replace(/^\[[^\]]+\]\s*/, '')   // leading [AUDIO] / [TEXT] / [IMAGE / GIF] tag
    .replace(/\|MEDIA:.+$/i, '')     // trailing |MEDIA:<url>
    .trim();
}

async function fireStreamElements({ name, email, amount, currency, message, orderId }) {
  const res = await fetch(
    `https://api.streamelements.com/kappa/v2/tips/${process.env.SE_CHANNEL_ID}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SE_JWT_TOKEN}`,
      },
      body: JSON.stringify({
        user: { username: name, userId: `cashfree-${orderId}`, email },
        provider: SE_PROVIDER_LABELS.cashfree,
        message: cleanMessageForSE(message) || 'Thanks for the tip!',
        amount,
        currency,
        imported: 'true',
      }),
    }
  );
  const data = await res.json();
  return { ok: res.ok, data };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody   = await getRawBody(req);
  const timestamp = req.headers['x-webhook-timestamp'];
  const signature = req.headers['x-webhook-signature'];

  const secret = isTestMode
    ? process.env.CASHFREE_SANDBOX_SECRET_KEY
    : process.env.CASHFREE_SECRET_KEY;

  if (!secret || !timestamp || !signature || !verifySignature(rawBody, timestamp, signature, secret)) {
    console.error('[cashfree-webhook] signature verification failed');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const payload = JSON.parse(rawBody);

  if (payload.type !== 'PAYMENT_SUCCESS_WEBHOOK') {
    return res.status(200).json({ ok: true, ignored: payload.type });
  }

  const order    = payload.data.order;
  const orderId  = order.order_id;
  const customer = payload.data.customer_details || {};

  try {
    const donation = await getDonation(orderId);
    if (!donation) {
      console.error('[cashfree-webhook] no matching donation row for', orderId);
      return res.status(200).json({ ok: true, note: 'order not found, ignoring' });
    }

    // Idempotency — already processed, don't fire twice
    if (donation.status === 'paid') {
      return res.status(200).json({ ok: true, note: 'already paid' });
    }

    const result = {
      amount:   order.order_amount,
      currency: order.order_currency || 'INR',
      name:     customer.customer_name  || donation.customer_name,
      email:    customer.customer_email || donation.customer_email,
      message:  payload.data.order?.order_tags?.message || donation.message,
    };

    const se = await fireStreamElements({ ...result, orderId }).catch(err => ({ ok: false, data: { error: err.message } }));

    await updateDonation(orderId, {
      status:         'paid',
      amount:         result.amount,
      currency:       result.currency,
      customer_name:  result.name,
      customer_email: result.email,
      se_fired:       se.ok,
      se_response:    se.data,
    });

    notifyDiscord({
      name:     result.name,
      amount:   result.amount,
      currency: result.currency,
      message:  result.message,
    }).catch(err => console.error('[cashfree-webhook] discord notify failed', err));

    console.log(`[cashfree-webhook] ${orderId} PAID — SE fired: ${se.ok}`);
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('[cashfree-webhook] error', err);
    // Return 200 anyway so Cashfree doesn't retry-storm you for a transient bug —
    // poll-payments cron will catch it as a fallback
    return res.status(200).json({ ok: false, error: err.message });
  }
}
