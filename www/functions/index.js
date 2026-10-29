/**
 * FCM push is handled by ../fcm-push-server (Express on Render).
 *
 * Do not re-enable Firestore triggers here while that service is running
 * or users will receive duplicate notifications.
 *
 * If these functions were previously deployed, delete them:
 *   firebase functions:delete notifyAdminsOnNewOrder notifyStudentsOnAnnouncement --force
 */
module.exports = {};
