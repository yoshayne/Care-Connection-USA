# CareConnect

A full-stack lead generation platform that connects families with trusted local home care providers. Built with Node.js, Express, PostgreSQL, and Redis — deployed on Railway.

---

## What This Project Is

CareConnect presents a single-page lead capture form where visitors select care services, provide their location and timeline, then submit their contact info. Each submission is saved to PostgreSQL, triggers two emails (owner notification + lead confirmation), and is rate-limited via Redis. An authenticated REST API allows the owner to view, filter, update, and export leads as CSV.

---

## Railway Deployment

### 1. Fork / push this repo to GitHub

### 2. Create a new Railway project

- Go to [railway.app](https://railway.app) and click **New Project**
- Select **Deploy from GitHub repo** and choose this repository

### 3. Add PostgreSQL

- In your Railway project, click **+ New** → **Database** → **Add PostgreSQL**
- Railway automatically injects `DATABASE_URL` into your service

### 4. Add Redis

- Click **+ New** → **Database** → **Add Redis**
- Railway automatically injects `REDIS_URL` into your service

### 5. Set environment variables

In your Railway service → **Variables**, add:

| Variable | Value |
|---|---|
| `PORT` | `3000` (Railway may override this automatically) |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | your Gmail address |
| `SMTP_PASS` | your Gmail App Password |
| `OWNER_EMAIL` | email where new lead notifications go |
| `API_KEY` | a long random string (e.g. `openssl rand -hex 32`) |
| `NODE_ENV` | `production` |

> `DATABASE_URL` and `REDIS_URL` are injected automatically by Railway — do not set them manually.

### 6. Deploy

Railway deploys automatically on every push to your connected branch. The app starts with `npm start` → `node server.js`.

On first boot, `server.js` runs the SQL schema against PostgreSQL automatically — no manual migration step needed.

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill in environment variables
cp .env.example .env

# 3. Start local PostgreSQL and Redis, then:
npm start
```

The app runs at `http://localhost:3000`.

---

## API Endpoints

All endpoints that read or modify leads require the `x-api-key` header.

### POST /api/leads

Submit a new lead (called by the frontend form).

**No auth required. Rate limited to 5 requests per IP per hour.**

```bash
curl -X POST https://your-app.railway.app/api/leads \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Jane",
    "lastName": "Smith",
    "email": "jane@example.com",
    "phone": "(555) 000-0000",
    "zip": "29016",
    "timeline": "Within 30 Days",
    "notes": "Looking for part-time companion care.",
    "services": ["Personal Care", "Companion Care"]
  }'
```

**Success response:**
```json
{ "success": true, "id": 42 }
```

**Error response:**
```json
{ "success": false, "error": "Email is required" }
```

---

### GET /api/leads

Retrieve all leads. Supports optional filtering and pagination.

```bash
curl https://your-app.railway.app/api/leads \
  -H "x-api-key: YOUR_API_KEY"

# Filter by status
curl "https://your-app.railway.app/api/leads?status=new&limit=25&offset=0" \
  -H "x-api-key: YOUR_API_KEY"
```

Query params: `status` (new/contacted/sold/closed), `limit` (default 100), `offset` (default 0)

---

### PATCH /api/leads/:id

Update a lead's status.

```bash
curl -X PATCH https://your-app.railway.app/api/leads/42 \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "status": "contacted" }'
```

Valid statuses: `new`, `contacted`, `sold`, `closed`

---

### GET /api/leads/export

Download all leads as a CSV file.

```bash
curl https://your-app.railway.app/api/leads/export \
  -H "x-api-key: YOUR_API_KEY" \
  -o leads.csv
```

---

## Retrieving and Exporting Leads

**View all new leads:**
```bash
curl "https://your-app.railway.app/api/leads?status=new" \
  -H "x-api-key: YOUR_API_KEY"
```

**Export everything to a CSV:**
```bash
curl "https://your-app.railway.app/api/leads/export" \
  -H "x-api-key: YOUR_API_KEY" \
  -o leads-$(date +%Y%m%d).csv
```

**Mark a lead as contacted:**
```bash
curl -X PATCH https://your-app.railway.app/api/leads/1 \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "contacted"}'
```

---

## Gmail SMTP Setup

1. Enable 2-Factor Authentication on your Google account
2. Go to **Google Account → Security → App Passwords**
3. Generate an App Password for "Mail"
4. Use that 16-character password as `SMTP_PASS` — not your regular Gmail password
