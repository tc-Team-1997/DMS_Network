# NBE DMS — Mobile Capture (Expo / React Native)

Branch officers scan customer documents in the field, attach minimal metadata,
and submit straight to the Python DMS API. OCR runs server-side via the task queue.

## Run

```bash
cd mobile
npm install
npx expo start            # scan QR with Expo Go
# or:
npx expo run:android
npx expo run:ios
```

## Configure backend

Edit [app.json](app.json) `expo.extra.apiBaseUrl` to point at your DMS Python service
(must be HTTPS for camera + auth on iOS).

## Demo credentials

Same demo users as the web app: `sara.k / demo`, `ahmed.m / demo`, etc.

## Flow

1. **Login** → POST `/api/v1/auth/token` → JWT stored in `expo-secure-store`.
2. **Capture** → camera shot → resize to 1600px JPEG → POST `/api/v1/documents` (multipart) →
   POST `/api/v1/tasks` to enqueue `ocr.process`.
3. **Recent** → GET `/api/v1/documents` (scoped by JWT tenant + branch).
