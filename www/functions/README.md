# Firebase Cloud Functions (deprecated for FCM)

Push notifications are sent by **`fcm-push-server/`** (see that folder’s README for Render deploy).

This `index.js` intentionally exports **no** triggers. If `notifyAdminsOnNewOrder` / `notifyStudentsOnAnnouncement` still exist in your Firebase project, remove them:

```bash
firebase functions:delete notifyAdminsOnNewOrder notifyStudentsOnAnnouncement --force
```

You can remove the `functions` block from `firebase.json` later if you no longer use Cloud Functions at all.
