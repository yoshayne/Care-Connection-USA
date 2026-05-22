require('dotenv').config();

const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const Redis = require('ioredis');
const nodemailer = require('nodemailer');
const { router: leadsRouter, init: initLeads } = require('./routes/leads');

const app = express();
const PORT = process.env.PORT || 3000;

// ── PostgreSQL ──
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ── Redis ──
const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true
});

redis.on('error', err => {
  console.error('Redis error:', err.message);
});

// ── Nodemailer ──
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT, 10) || 587,
  secure: parseInt(process.env.SMTP_PORT, 10) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

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

// ── Startup ──
async function start() {
  try {
    // Connect to PostgreSQL and run schema
    await db.query('SELECT 1');
    console.log('PostgreSQL connected');

    const schema = require('fs').readFileSync(
      path.join(__dirname, 'db', 'schema.sql'),
      'utf8'
    );
    await db.query(schema);
    console.log('Database schema ready');

    // Connect to Redis
    await redis.connect();
    console.log('Redis connected');

    // Wire up routes
    initLeads(db, redis, transporter);

    app.listen(PORT, () => {
      console.log(`CareConnect running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Startup error:', err.message);
    process.exit(1);
  }
}

start();
