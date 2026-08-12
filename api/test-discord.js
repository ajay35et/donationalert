/**
 * /api/test-discord.js
 *
 * Visit this URL directly in a browser to send a one-off test message to
 * Discord and see exactly what happened — no need to dig through Vercel
 * logs. DELETE THIS FILE once discord-notify.js is confirmed working;
 * it's a debug helper, not something that should stay in production.
 */

import { notifyDiscord } from './discord-notify.js';

export default async function handler(req, res) {
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => { logs.push(args.map(String).join(' ')); originalError(...args); };

  try {
    await notifyDiscord({
      name: 'Test User',
      amount: 1,
      currency: 'INR',
      message: 'This is a test message from /api/test-discord',
    });
  } catch (err) {
    logs.push('Threw: ' + err.message);
  } finally {
    console.error = originalError;
  }

  return res.status(200).json({
    ranAt: new Date().toISOString(),
    note: 'Check your Discord channel now. Any errors below explain why it might not have arrived.',
    errors: logs.length ? logs : 'none — the function ran without throwing',
  });
}
