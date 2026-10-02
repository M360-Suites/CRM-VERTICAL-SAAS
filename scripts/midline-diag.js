/**
 * Midline connectivity diagnostic.
 *
 * Tests whether a Midline server key is accepted by the ingest server and
 * whether request events are delivered — without needing a full deploy.
 *
 * Usage (from the repo root):
 *   node scripts/midline-diag.js                     # uses MIDLINE_API_KEY env / .env
 *   MIDLINE_API_KEY=ak_... node scripts/midline-diag.js
 *
 * Prints the key type/length, fires a few local requests, and reports whether
 * the agent is active after delivery. Any rejection/off line means the key is
 * not accepted for this project.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const argKey = process.env.MIDLINE_API_KEY || '';
const key = argKey.trim();

if (!key) {
  console.log('No MIDLINE_API_KEY set. Exiting.');
  process.exit(1);
}

console.log(`Key: ${key.slice(0, 6)}...${key.slice(-4)} (type=${key.slice(0, 3)}, len=${key.length})`);

const { MidlineAgent, midlineMiddleware, midlineErrorHandler } = require('midline-agent');

MidlineAgent.init({
  apiKey: key,
  serviceName: process.env.MIDLINE_SERVICE_NAME || 'crm-diag',
  environment: 'diag'
});

const express = require('express');
const app = express();
app.use(express.json());
app.use(midlineMiddleware());
app.get('/diag', (req, res) => res.json({ ok: true }));
app.get('/diag-error', (req, res, next) => next(new Error('diagnostic error')));
app.use(midlineErrorHandler());
app.use((err, req, res, next) => res.status(500).json({ message: err.message }));

const server = app.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  await fetch(`${base}/diag`);
  await fetch(`${base}/diag`);
  await fetch(`${base}/diag-error`);
  await fetch(`${base}/diag`);

  setTimeout(async () => {
    console.log('Active after requests:', MidlineAgent.current && MidlineAgent.current.active);
    console.log('Queued events:', MidlineAgent.current ? MidlineAgent.current.queued : 0);

    await MidlineAgent.current.flush();
    await new Promise((r) => setTimeout(r, 1500));

    console.log('Active after flush:', MidlineAgent.current && MidlineAgent.current.active);
    console.log('Queued after flush:', MidlineAgent.current ? MidlineAgent.current.queued : 0);

    await MidlineAgent.current.shutdown(2000);
    process.exit(0);
  }, 2000);
});