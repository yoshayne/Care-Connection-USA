require('dotenv').config();

const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const Redis = require('ioredis');
const { Resend } = require('resend');
const { router: leadsRouter, init: initLeads } = require('./routes/leads');

const app = express();
const PORT = process.env.PORT || 3000;

// ── PostgreSQL ──
if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not set. In Railway: open your service → Variables → add DATABASE_URL referencing your Postgres plugin (${{Postgres.DATABASE_URL}}).');
  process.exit(1);
}

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ── Redis ──
let redis = null;
if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    enableReadyCheck: false
  });
  redis.on('error', err => {
    console.error('Redis error:', err.message);
  });
} else {
  console.warn('WARN: REDIS_URL is not set. Rate limiting will be disabled.');
}

// ── Resend ──
if (!process.env.RESEND_API_KEY) {
  console.warn('WARN: RESEND_API_KEY is not set. Emails will be disabled.');
}
const resend = new Resend(process.env.RESEND_API_KEY || 'missing');

// ── Middleware ──
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
  });
  next();
});

// ── Static files ──
app.use(express.static(path.join(__dirname, 'public')));

// ── API routes ──
app.use('/api', leadsRouter);

// ── 404 handler ──
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ success: false, error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Error handler ──
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// ── Retry helper ──
async function retry(fn, label, attempts, delayMs) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await fn();
      return;
    } catch (err) {
      if (i === attempts) throw err;
      console.error(`${label} attempt ${i}/${attempts} failed: ${err.message}. Retrying in ${delayMs}ms...`);
      await new Promise(r => setTimeout(r, delayMs));
      delayMs *= 2;
    }
  }
}

// ── Startup ──
async function start() {
  try {
    // Connect to PostgreSQL with retry (Railway DB may not be ready immediately)
    await retry(
      () => db.query('SELECT 1'),
      'PostgreSQL',
      6,
      2000
    );
    console.log('PostgreSQL connected');

    const schema = require('fs').readFileSync(
      path.join(__dirname, 'db', 'schema.sql'),
      'utf8'
    );
    await db.query(schema);
    console.log('Database schema ready');

    // Connect to Redis (optional — failures just disable rate limiting)
    if (redis) {
      try {
        await redis.connect();
        console.log('Redis connected');
      } catch (err) {
        console.error('Redis connection failed (rate limiting disabled):', err.message);
        redis = null;
      }
    }

    // Wire up routes
    initLeads(db, redis, resend);

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Care Connection USA running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Startup error:', err.message);
    process.exit(1);
  }
}

start();
