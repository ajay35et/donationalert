/**
 * /api/cleanup-audio.js
 *
 * Scheduled (Vercel Cron) job that deletes voice clips / images older than
 * RETENTION_DAYS from Supabase Storage. Uploaded files otherwise live
 * forever — nothing else in this codebase ever removes them — so without
 * this, storage usage only grows and can eventually hit the plan's quota.
 *
 * Secured with CRON_SECRET, same pattern as poll-payments.js. Unlike that
 * file's check, this one FAILS CLOSED: if CRON_SECRET isn't set at all,
 * the endpoint refuses every request instead of silently allowing them.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RETENTION_DAYS = 7;
const BUCKETS = ['donation-audio', 'donation-media']; // both use the same pending/ layout
const LIST_PAGE_SIZE = 1000;

async function listAllPending(bucket) {
  const all = [];
  let offset = 0;
  while (true) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify({
        prefix: 'pending',
        limit: LIST_PAGE_SIZE,
        offset,
        sortBy: { column: 'created_at', order: 'asc' },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`list ${bucket} → ${res.status}: ${JSON.stringify(data)}`);
    if (!Array.isArray(data) || data.length === 0) break;

    all.push(...data);
    if (data.length < LIST_PAGE_SIZE) break;
    offset += LIST_PAGE_SIZE;
  }
  return all;
}

async function deleteBatch(bucket, paths) {
  if (paths.length === 0) return;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify({ prefixes: paths }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`delete ${bucket} → ${res.status}: ${JSON.stringify(data)}`);
}

export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase credentials not configured' });
  }

  const cutoff = Date.now() - 20 * 60 * 1000; // TESTING: 20 minutes
  const results = {};
  const debug = req.query && req.query.debug === '1';
  const debugInfo = {};

  for (const bucket of BUCKETS) {
    try {
      const objects = await listAllPending(bucket);
      if (debug) {
        debugInfo[bucket] = objects.map(o => ({
          name: o.name,
          created_at: o.created_at,
          updated_at: o.updated_at,
        }));
      }

      const stale = objects.filter(o => {
        const ts = o.created_at || o.updated_at; // fall back if created_at is missing
        return ts && new Date(ts).getTime() < cutoff;
      });
      const paths = stale.map(o => `pending/${o.name}`);

      // Delete in chunks of 100 — keeps each request small and avoids
      // timing out if a huge backlog ever builds up.
      for (let i = 0; i < paths.length; i += 100) {
        await deleteBatch(bucket, paths.slice(i, i + 100));
      }

      results[bucket] = { checked: objects.length, deleted: paths.length };
    } catch (err) {
      console.error(`[cleanup-audio] ${bucket} failed`, err);
      results[bucket] = { error: err.message };
    }
  }

  console.log('[cleanup-audio] run complete', results);
  const response = { ok: true, retentionDays: RETENTION_DAYS, results };
  if (debug) response.debug = debugInfo;
  return res.status(200).json(response);
}
