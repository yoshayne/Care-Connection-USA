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
    : '—';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:28px 20px">
      <div style="border-bottom:3px solid #0E7A6E;padding-bottom:14px;margin-bottom:24px">
        <p style="margin:0 0 4px;font-size:13px;color:#6B7280;text-transform:uppercase;letter-spacing:.06em">CareConnectionUSA.org — New Submission</p>
        <h2 style="margin:0;color:#13253F;font-size:22px">A new lead has been submitted through CareConnectionUSA.org.</h2>
      </div>

      <h3 style="color:#13253F;font-size:15px;margin:0 0 12px">Lead Information:</h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:28px">
        <tr style="background:#f9f9f9">
          <td style="padding:10px 14px;font-weight:600;color:#6B7280;width:200px;font-size:14px">Name</td>
          <td style="padding:10px 14px;color:#1E293B;font-size:14px">${lead.first_name} ${lead.last_name}</td>
        </tr>
        <tr>
          <td style="padding:10px 14px;font-weight:600;color:#6B7280;font-size:14px">Email</td>
          <td style="padding:10px 14px;color:#1E293B;font-size:14px">${lead.email}</td>
        </tr>
        <tr style="background:#f9f9f9">
          <td style="padding:10px 14px;font-weight:600;color:#6B7280;font-size:14px">Phone</td>
          <td style="padding:10px 14px;color:#1E293B;font-size:14px">${lead.phone}</td>
        </tr>
        <tr>
          <td style="padding:10px 14px;font-weight:600;color:#6B7280;font-size:14px">Location</td>
          <td style="padding:10px 14px;color:#1E293B;font-size:14px">${lead.zip_code || '—'}</td>
        </tr>
        <tr style="background:#f9f9f9">
          <td style="padding:10px 14px;font-weight:600;color:#6B7280;font-size:14px">Care Need / Service Requested</td>
          <td style="padding:10px 14px;color:#1E293B;font-size:14px">${servicesText}</td>
        </tr>
        <tr>
          <td style="padding:10px 14px;font-weight:600;color:#6B7280;font-size:14px">Additional Notes</td>
          <td style="padding:10px 14px;color:#1E293B;font-size:14px">${lead.notes || '—'}</td>
        </tr>
        <tr style="background:#f9f9f9">
          <td style="padding:10px 14px;font-weight:600;color:#6B7280;font-size:14px">Submission Date</td>
          <td style="padding:10px 14px;color:#1E293B;font-size:14px">${new Date(lead.created_at).toLocaleString()}</td>
        </tr>
      </table>

      <div style="background:#EDF2EC;border-left:4px solid #0E7A6E;padding:16px 18px;margin-bottom:20px;border-radius:0 6px 6px 0">
        <p style="margin:0 0 8px;font-weight:700;color:#13253F;font-size:14px">Action Needed:</p>
        <ul style="margin:0;padding-left:18px;color:#374151;font-size:14px;line-height:2">
          <li>Review lead information</li>
          <li>Prepare lead sheet for internal records</li>
          <li>Forward to qualified agencies/providers based on care needs</li>
          <li>Track follow-up status</li>
        </ul>
      </div>

      <p style="margin:0;font-size:12px;color:#9CA3AF;text-align:center">
        Submitted via: CareConnectionUSA.org Website Lead Form
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
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:28px 20px">
      <div style="text-align:center;margin-bottom:28px">
        <p style="margin:0;font-size:13px;color:#6B7280;text-transform:uppercase;letter-spacing:.06em">CareConnectionUSA.org</p>
        <p style="margin:6px 0 0;font-size:13px;color:#0E7A6E;font-style:italic">Connecting You to the Care You Need</p>
      </div>

      <p style="color:#1E293B;font-size:15px;margin:0 0 16px">Dear ${lead.first_name},</p>

      <p style="color:#1E293B;font-size:15px;line-height:1.7;margin:0 0 16px">
        Thank you for reaching out to CareConnectionUSA.org.
      </p>

      <p style="color:#1E293B;font-size:15px;line-height:1.7;margin:0 0 16px">
        We have received your information and appreciate the opportunity to assist you. Our team will review your submission and forward your information to the agencies and providers best qualified to meet your specific needs.
      </p>

      <p style="color:#1E293B;font-size:15px;line-height:1.7;margin:0 0 16px">
        A representative from one of the preferred agencies may be contacting you shortly to discuss your situation in more detail and help guide you through the next steps.
      </p>

      <p style="color:#1E293B;font-size:15px;line-height:1.7;margin:0 0 16px">
        We understand that finding the right care and support is important, and we are committed to helping connect you with the resources that best fit your needs.
      </p>

      <p style="color:#1E293B;font-size:15px;line-height:1.7;margin:0 0 28px">
        If you have any immediate questions, please feel free to reply to this email.
      </p>

      <p style="color:#1E293B;font-size:15px;margin:0 0 4px">Thank you again for trusting CareConnectionUSA.org.</p>

      <p style="color:#1E293B;font-size:15px;margin:0 0 4px">Sincerely,</p>
      <p style="color:#13253F;font-size:15px;font-weight:700;margin:0 0 2px">CareConnectionUSA.org</p>
      <p style="color:#0E7A6E;font-size:14px;font-style:italic;margin:0">Connecting You to the Care You Need</p>

      <hr style="border:none;border-top:1px solid #E5E7EB;margin:28px 0 16px">
      <p style="color:#9CA3AF;font-size:12px;text-align:center;margin:0">
        CareConnectionUSA.org
      </p>
    </div>
  `;

  await brevoClient.transactionalEmails.sendTransacEmail({
    sender: SENDER,
    to: [{ email: lead.email }],
    subject: 'Thank you for reaching out — CareConnectionUSA.org',
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
