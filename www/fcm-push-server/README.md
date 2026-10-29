# FCM push server (Render.com)

Standalone Node service: listens to Firestore `orders` and `notifications`, sends FCM multicast to tokens in `users/{uid}/fcmTokens` (collection group `fcmTokens`).

**Do not** deploy this alongside the Firebase Cloud Functions in `../functions/` with the same triggers — you will get duplicate notifications. Use one backend only.

## Prerequisites

- Firebase project `iraqi-fiber-academy`
- Firestore indexes: collection group `fcmTokens` on field `role` (see repo `firestore.indexes.json`)
- A **service account** with Firebase Admin / FCM access (store only in env, never in git)

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FIREBASE_SERVICE_ACCOUNT` | Yes | Full service account JSON as **one line** (minified) |
| `PORT` | No | Set by Render automatically |
| `HOST_ORIGIN` | No | Default `https://iraqi-fiber-academy.web.app` for notification click URLs |

Local: copy `env.example` to `.env` and fill in values. `.env` is gitignored.

### Render: `FIREBASE_SERVICE_ACCOUNT`

1. Google Cloud Console → IAM → Service Accounts → create or select an admin SDK account.
2. Create a **new** JSON key (rotate/delete any key that was ever exposed).
3. Minify the JSON to a single line (no line breaks outside the string).
4. Paste into Render → Environment → `FIREBASE_SERVICE_ACCOUNT`.

Never commit the JSON file or paste the key into the frontend repository.

## Render.com deploy

1. **New Web Service** → connect this GitHub repo.
2. **Root Directory:** `fcm-push-server`
3. **Build Command:** `npm install`
4. **Start Command:** `npm start`
5. Add env vars above.
6. Deploy. Visit `https://<your-service>.onrender.com/` — expect:

```json
{
  "ok": true,
  "service": "iraqi-fiber-academy-fcm-push-server",
  "listeners": { "orders": true, "notifications": true }
}
```

## Local run

```bash
cd fcm-push-server
cp env.example .env   # edit .env with your credentials
npm install
npm start
```

## Triggers

| Collection | Event | Recipients | Notes |
|------------|-------|------------|--------|
| `orders` | New document (after server start) | `fcmTokens` where `role == 'admin'` | Title: طلب جديد! |
| `notifications` | New document | `fcmTokens` where `role == 'user'` | Skips `new_order` and `targetAudience: admin` |

Initial snapshot on startup is ignored so restarts do not resend old items.

## Client app

Students/admins opt in via browser toggle; tokens are written by `js/fcm-push.js`. Ensure hosting and `firebase-messaging-sw.js` are deployed.
