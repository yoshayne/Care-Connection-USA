const express = require('express');
const router = express.Router();
const { requireApiKey } = require('../middleware/validate');

let db;
let redis;
let brevoClient;

const SENDER = { name: 'Care Connection USA', email: 'admin@careconnectionusa.org' };

function init(pgPool, redisClient, brevo) {
  db = pgPool;
  redis = redisClient;
  brevoClient = brevo;
}

const VALID_STATUSES = ['new', 'contacted', 'sold', 'closed'];

async function rateLimit(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const key = `rate_limit:${ip}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, 3600);
    }
    if (count > 5) {
      return res.status(429).json({ success: false, error: 'Too many requests. Please try again in an hour.' });
    }
    next();
  } catch (err) {
    console.error('Redis rate limit error:', err.message);
    next();
  }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sendOwnerNotification(lead) {
  const servicesText = Array.isArray(lead.services) && lead.services.length
    ? lead.services.join(', ')
    : 'None selected';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <h2 style="color:#13253F;border-bottom:2px solid #0E7A6E;padding-bottom:10px">
        New Lead: ${lead.first_name} ${lead.last_name}
      </h2>
      <table style="width:100%;border-collapse:collapse;margin-top:16px">
        <tr style="background:#f9f9f9">
          <td style="padding:10px 14px;font-weight:600;color:#6B7280;width:140px">Name</td>
          <td style="padding:10px 14px;color:#1E293B">${lead.first_name} ${lead.last_name}</td>
        </tr>
        <tr>
          <td style="padding:10px 14px;font-weight:600;color:#6B7280">Email</td>
          <td style="padding:10px 14px;color:#1E293B">${lead.email}</td>
        </tr>
        <tr style="background:#f9f9f9">
          <td style="padding:10px 14px;font-weight:600;color:#6B7280">Phone</td>
          <td style="padding:10px 14px;color:#1E293B">${lead.phone}</td>
        </tr>
        <tr>
          <td style="padding:10px 14px;font-weight:600;color:#6B7280">ZIP Code</td>
          <td style="padding:10px 14px;color:#1E293B">${lead.zip_code || '—'}</td>
        </tr>
        <tr style="background:#f9f9f9">
          <td style="padding:10px 14px;font-weight:600;color:#6B7280">Timeline</td>
          <td style="padding:10px 14px;color:#1E293B">${lead.timeline || '—'}</td>
        </tr>
        <tr>
          <td style="padding:10px 14px;font-weight:600;color:#6B7280">Services</td>
          <td style="padding:10px 14px;color:#1E293B">${servicesText}</td>
        </tr>
        <tr style="background:#f9f9f9">
          <td style="padding:10px 14px;font-weight:600;color:#6B7280">Notes</td>
          <td style="padding:10px 14px;color:#1E293B">${lead.notes || '—'}</td>
        </tr>
        <tr>
          <td style="padding:10px 14px;font-weight:600;color:#6B7280">Submitted</td>
          <td style="padding:10px 14px;color:#1E293B">${new Date(lead.created_at).toLocaleString()}</td>
        </tr>
        <tr style="background:#f9f9f9">
          <td style="padding:10px 14px;font-weight:600;color:#6B7280">IP Address</td>
          <td style="padding:10px 14px;color:#1E293B">${lead.ip_address || '—'}</td>
        </tr>
      </table>
      <p style="margin-top:20px;padding:12px;background:#EDF2EC;border-left:4px solid #0E7A6E;color:#13253F;font-size:14px">
        Follow up within 2 hours to maximize conversion.
      </p>
    </div>
  `;

  await brevoClient.transactionalEmails.sendTransacEmail({
    sender: SENDER,
    to: [{ email: process.env.OWNER_EMAIL }],
    subject: `New Lead: ${lead.first_name} ${lead.last_name} — ${lead.zip_code || 'No ZIP'}`,
    htmlContent: html
  });
}

async function sendLeadConfirmation(lead) {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <div style="text-align:center;margin-bottom:24px">
        <div style="display:inline-block;width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#0E7A6E,#12A090);text-align:center;line-height:56px">
          <span style="color:#fff;font-size:24px">✓</span>
        </div>
      </div>
      <h2 style="color:#13253F;text-align:center;margin-bottom:8px">We received your request!</h2>
      <p style="color:#6B7280;text-align:center;font-size:15px;margin-bottom:24px">
        Hi ${lead.first_name}, a local Care Connection USA advisor will reach out to you within <strong style="color:#0E7A6E">2 hours</strong> to discuss your care options.
      </p>
      <div style="background:#FAF8F3;border:1px solid #E5E7EB;border-radius:10px;padding:20px;margin-bottom:24px">
        <h3 style="color:#13253F;font-size:15px;margin-bottom:12px">What happens next?</h3>
        <ol style="color:#6B7280;font-size:14px;line-height:1.8;padding-left:18px">
          <li>A local advisor reviews your request</li>
          <li>We match you with vetted providers in your area</li>
          <li>You receive personalized care options at no cost to you</li>
        </ol>
      </div>
      <p style="color:#6B7280;font-size:13px;text-align:center">
        Questions? Call us at <a href="tel:8661234567" style="color:#0E7A6E;font-weight:600">(866) 123-4567</a>
      </p>
      <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0">
      <p style="color:#9CA3AF;font-size:12px;text-align:center">
        Care Connection USA — careconnectionusa.org
      </p>
    </div>
  `;

  await brevoClient.transactionalEmails.sendTransacEmail({
    sender: SENDER,
    to: [{ email: lead.email }],
    subject: 'We received your request — Care Connection USA',
    htmlContent: html
  });
}

// POST /api/leads
router.post('/leads', rateLimit, async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      zip,
      timeline,
      notes,
      services
    } = req.body;

    const errors = [];
    if (!firstName || !firstName.trim()) errors.push('First name is required');
    if (!lastName || !lastName.trim()) errors.push('Last name is required');
    if (!email || !email.trim()) errors.push('Email is required');
    else if (!isValidEmail(email.trim())) errors.push('Invalid email address');
    if (!phone || !phone.trim()) errors.push('Phone is required');

    if (errors.length) {
      return res.status(400).json({ success: false, error: errors[0] });
    }

    const ip = req.ip || req.socket.remoteAddress || null;
    const userAgent = req.headers['user-agent'] || null;
    const serviceArray = Array.isArray(services) ? services : [];

    const result = await db.query(
      `INSERT INTO leads
        (first_name, last_name, email, phone, zip_code, timeline, notes, services, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        firstName.trim(),
        lastName.trim(),
        email.trim().toLowerCase(),
        phone.trim(),
        zip ? zip.trim() : null,
        timeline ? timeline.trim() : null,
        notes ? notes.trim() : null,
        serviceArray,
        ip,
        userAgent
      ]
    );

    const lead = result.rows[0];

    const emailErrors = [];
    try {
      await sendOwnerNotification(lead);
    } catch (err) {
      emailErrors.push('owner notification');
      console.error('Owner email error:', err.message);
    }

    try {
      await sendLeadConfirmation(lead);
    } catch (err) {
      emailErrors.push('lead confirmation');
      console.error('Lead confirmation email error:', err.message);
    }

    return res.status(201).json({ success: true, id: lead.id });
  } catch (err) {
    console.error('POST /leads error:', err.message);
    return res.status(500).json({ success: false, error: 'Server error. Please try again.' });
  }
});

// GET /api/leads
router.get('/leads', requireApiKey, async (req, res) => {
  try {
    const { status, limit = 100, offset = 0 } = req.query;

    let query = 'SELECT * FROM leads';
    const params = [];

    if (status) {
      params.push(status);
      query += ` WHERE status = $${params.length}`;
    }

    query += ' ORDER BY created_at DESC';

    params.push(parseInt(limit, 10) || 100);
    query += ` LIMIT $${params.length}`;

    params.push(parseInt(offset, 10) || 0);
    query += ` OFFSET $${params.length}`;

    const result = await db.query(query, params);
    return res.json({ success: true, count: result.rows.length, leads: result.rows });
  } catch (err) {
    console.error('GET /leads error:', err.message);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// GET /api/leads/export
router.get('/leads/export', requireApiKey, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM leads ORDER BY created_at DESC');
    const leads = result.rows;

    const headers = [
      'id', 'first_name', 'last_name', 'email', 'phone',
      'zip_code', 'timeline', 'notes', 'services', 'status',
      'ip_address', 'created_at'
    ];

    function csvEscape(val) {
      if (val === null || val === undefined) return '';
      const str = Array.isArray(val) ? val.join('; ') : String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    }

    const rows = leads.map(lead =>
      headers.map(h => csvEscape(lead[h])).join(',')
    );

    const csv = [headers.join(','), ...rows].join('\r\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=leads.csv');
    return res.send(csv);
  } catch (err) {
    console.error('GET /leads/export error:', err.message);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// PATCH /api/leads/:id
router.patch('/leads/:id', requireApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`
      });
    }

    const result = await db.query(
      'UPDATE leads SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, status, updated_at',
      [status, parseInt(id, 10)]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }

    return res.json({ success: true, lead: result.rows[0] });
  } catch (err) {
    console.error('PATCH /leads/:id error:', err.message);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = { router, init };
