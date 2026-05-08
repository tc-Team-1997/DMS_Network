# Contract: Multi-Channel Notification (BRD #24)

## Auth
All routes: `X-API-Key` (shared gateway key).
`/preferences` additionally requires a valid Bearer JWT (`current_principal`).
`X-API-Key` alone grants `doc_admin` principal with `sub="api-key"`.

---

## GET /api/v1/notify/health

Returns which channels are configured. No credentials leaked.

**Response 200**
```json
{
  "email":     { "configured": true },
  "sms":       { "configured": false },
  "whatsapp":  { "configured": false }
}
```

---

## POST /api/v1/notify/test

Fire a one-shot test notification on a single channel.

**Request**
```json
{ "channel": "email|sms|whatsapp", "to": "<address>", "message": "<text>" }
```

**Response 200** (provider result)
```json
{ "ok": true, "id": "<provider-msg-id>" }
{ "ok": false, "error": "<reason>" }
```

---

## GET /api/v1/notify/preferences

Returns the authenticated user's channel preferences.

**Response 200**
```json
{
  "user_sub": "ahmed.m",
  "channels": ["email", "sms"],
  "email": "ahmed@example.com",
  "phone": "+97701234567"
}
```
Defaults to `channels: ["email"]` if no row exists.

---

## POST /api/v1/notify/preferences

Create or replace the authenticated user's notification channel preferences.

**Request**
```json
{
  "channels": ["email", "sms", "whatsapp"],
  "email": "ahmed@example.com",
  "phone": "+97701234567"
}
```
`email` and `phone` are optional; omitting them leaves existing values unchanged.
`channels` must be non-empty and contain only `"email" | "sms" | "whatsapp"`.

**Response 200** — same shape as GET.

**Response 422** — invalid channel name or empty list.

---

## DB Shape

### `user_notification_preferences`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| user_sub | VARCHAR(128) UNIQUE NOT NULL | JWT `sub` claim |
| notification_channels | TEXT nullable | JSON array, e.g. `["email","sms"]`. NULL → `["email"]` |
| email | VARCHAR(256) nullable | Destination for email channel |
| phone | VARCHAR(32) nullable | E.164; used for SMS and WhatsApp |
| created_at | DATETIME | |
| updated_at | DATETIME | |

### `alert_records`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| user_sub | VARCHAR(128) NOT NULL | |
| level | VARCHAR(16) | `info \| warning \| critical` |
| title | VARCHAR(256) NOT NULL | |
| message | TEXT | |
| created_at | DATETIME | |

---

## Env Vars (set in prod)

| Variable | Purpose |
|----------|---------|
| `SMTP_HOST` | SMTP server hostname |
| `SMTP_PORT` | Port (587 STARTTLS default, 465 for SSL) |
| `SMTP_USER` | Login username |
| `SMTP_PASS` | Login password |
| `SMTP_FROM` | Envelope From address |
| `SMTP_TLS` | Set to `"ssl"` for implicit TLS; otherwise STARTTLS |
| `TWILIO_ACCOUNT_SID` | Twilio account SID (AC…) |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_FROM` | SMS-capable Twilio number (E.164) |
| `TWILIO_WA_FROM` | WhatsApp-enabled sender, e.g. `whatsapp:+14155238886` |

All vars optional — missing vars cause the provider to enter **no-op mode** (logs a warning, returns `ok=false`).

---

## Wire-in: Alert creation

`POST /api/v1/alerts` accepts `{ user_id, level, title, message }` and:
1. Inserts an `alert_records` row.
2. Calls `notify.send(user_id, ...)` in a fire-and-forget task (swallows exceptions).
