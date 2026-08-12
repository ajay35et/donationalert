/**
 * /api/discord-notify.js
 *
 * Sends a message to a Discord channel (via webhook) every time a donation
 * is successfully paid. This file is deliberately separate from the payment
 * logic — everything you'd want to tweak lives in the CONFIG section below,
 * so you can edit this one file without touching create-order.js,
 * cashfree-webhook.js, verify-order.js, or poll-payments.js.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * HOW TO CUSTOMIZE (all in the CONFIG block right below):
 *   - DISCORD_WEBHOOK_URL : your Discord webhook link
 *   - WEBSITE_URL         : where the button should send people
 *   - BUTTON_LABEL        : text on the button
 *   - THANK_YOU_MESSAGE   : the special thanks line under the donation info
 *   - EMBED_COLOR         : sidebar color of the Discord embed (hex, e.g. 0xFFB020)
 * ─────────────────────────────────────────────────────────────────────────
 */

// ========================= CONFIG — EDIT THIS ============================
const DISCORD_WEBHOOK_URL =
  'https://discord.com/api/webhooks/1364484664613670974/5NxBrGJtg8gGb4criKLlq1UN_LEpmqUimWVBU_bk242OKs-x_LR4ABZr95de-h6Z5zjD';

const WEBSITE_URL = 'https://kzdonationalert.vercel.app';

const BUTTON_LABEL = '🎁 Support the Stream';

const THANK_YOU_MESSAGE =
  'Thank you so much for your support! 💜 It genuinely means a lot and helps keep the stream going.';

const EMBED_COLOR = 0xffb020; // amber — change this hex to recolor the embed's side bar
// ===========================================================================

function formatDateTime() {
  const now = new Date();
  const date = now.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
  const time = now.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  });
  return { date, time, iso: now.toISOString() };
}

// Strips our internal [TYPE]/|MEDIA: tags so Discord only ever shows the
// donor's actual clean text — same idea as cleanMessageForSE() in the
// webhook files.
function cleanMessage(raw) {
  if (!raw) return '';
  return raw.replace(/^\[[^\]]+\]\s*/, '').replace(/\|MEDIA:.+$/i, '').trim();
}

/**
 * Call this after a donation is confirmed paid.
 * Never throws — a Discord failure should never break the payment flow.
 */
export async function notifyDiscord({ name, amount, currency = 'INR', message }) {
  if (!DISCORD_WEBHOOK_URL) return;

  const { date, time, iso } = formatDateTime();
  const symbol = currency === 'INR' ? '₹' : `${currency} `;
  const clean  = cleanMessage(message);

  const fields = [
    { name: '👤 Name',   value: name || 'Anonymous', inline: true },
    { name: '💰 Amount', value: `${symbol}${amount}`, inline: true },
    { name: '📅 Date',   value: date, inline: true },
    { name: '⏰ Time',   value: time, inline: true },
  ];

  if (clean) {
    fields.push({ name: '💬 Message', value: clean.slice(0, 500), inline: false });
  }

  const payload = {
    embeds: [
      {
        title: '🎉 New Donation Received!',
        color: EMBED_COLOR,
        fields,
        description: THANK_YOU_MESSAGE,
        timestamp: iso,
      },
    ],
    components: [
      {
        type: 1, // action row
        components: [
          {
            type: 2,   // button
            style: 5,  // link button — no bot/interaction handler needed
            label: BUTTON_LABEL,
            url: WEBSITE_URL,
          },
        ],
      },
    ],
  };

  try {
    const res = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error('[discord-notify] Discord rejected the message', res.status, await res.text());
    }
  } catch (err) {
    console.error('[discord-notify] failed to reach Discord', err);
  }
}
