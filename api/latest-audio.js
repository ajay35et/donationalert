/**
 * /api/latest-audio.js
 *
 * Public, read-only lookup used by the StreamElements custom "voice clip"
 * overlay widget (see Readme.md). The Alert Box + built-in Text-to-Speech
 * widgets only ever see a CLEAN message (tags stripped in cashfree-webhook.js
 * / verify-order.js / poll-payments.js before firing the SE tip) — so the
 * overlay widget can't get the audio URL from the tip event itself. Instead
 * it calls this endpoint with the donor's name + amount right after a tip
 * comes in, and this reads the full tagged message straight out of Supabase
 * to find the matching |MEDIA:<url>.
 *
 * No secret required — this only ever returns a signed-looking public
 * Supabase Storage URL for a recent donation, nothing sensitive (no email,
 * no order id). CORS is wide open since the widget runs on streamelements.com.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MATCH_WINDOW_MINUTES = 5; // only consider donations paid in the last N minutes

function extractMediaUrl(message) {
  if (!message) return null;
  const match = message.match(/\|MEDIA:(.+)$/i);
  return match ? match[1].trim() : null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase credentials not configured' });
  }

  const name   = String(req.query.name || '').trim();
  const amount = String(req.query.amount || '').trim();
  if (!name || !amount) {
    return res.status(400).json({ error: 'name and amount query params are required' });
  }

  const since = new Date(Date.now() - MATCH_WINDOW_MINUTES * 60 * 1000).toISOString();

  try {
    const url =
      `${SUPABASE_URL}/rest/v1/donations` +
      `?status=eq.paid` +
      `&amount=eq.${encodeURIComponent(amount)}` +
      `&customer_name=eq.${encodeURIComponent(name)}` +
      `&updated_at=gte.${encodeURIComponent(since)}` +
      `&select=message,updated_at&order=updated_at.desc&limit=1`;

    const sbRes = await fetch(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    const rows = await sbRes.json();
    if (!sbRes.ok || !Array.isArray(rows) || rows.length === 0) {
      return res.status(200).json({ audioUrl: null });
    }

    const audioUrl = extractMediaUrl(rows[0].message);
    return res.status(200).json({ audioUrl: audioUrl || null });

  } catch (err) {
    console.error('[latest-audio] error', err);
    return res.status(200).json({ audioUrl: null }); // fail quiet — widget just won't play anything
  }
}
