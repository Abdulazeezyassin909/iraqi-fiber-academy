/**
 * Standalone FCM relay — Firestore onSnapshot → multicast push.
 * Host on Render (or similar). Set FIREBASE_SERVICE_ACCOUNT in env (JSON string).
 */
require('dotenv').config();

const express = require('express');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

const HOST_ORIGIN = process.env.HOST_ORIGIN || 'https://iraqi-fiber-academy.web.app';
const MULTICAST_BATCH = 500;
const PORT = Number(process.env.PORT) || 3000;

function parseServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw || !String(raw).trim()) {
    throw new Error(
      'Missing FIREBASE_SERVICE_ACCOUNT. Set it to the full service account JSON (single line on Render).'
    );
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON: ' + err.message);
  }
}

function initFirebaseAdmin() {
  if (getApps().length) return;
  const serviceAccount = parseServiceAccount();
  initializeApp({
    credential: cert(serviceAccount),
  });
}

function absoluteLink(relativeOrAbsolute) {
  const raw = String(relativeOrAbsolute || '/').trim();
  if (raw.indexOf('http://') === 0 || raw.indexOf('https://') === 0) return raw;
  return HOST_ORIGIN + (raw.indexOf('/') === 0 ? raw : '/' + raw);
}

async function tokensForRole(role) {
  const db = getFirestore();
  const snap = await db.collectionGroup('fcmTokens').where('role', '==', role).get();
  const tokens = [];
  snap.forEach((docSnap) => {
    const token = docSnap.data() && docSnap.data().token;
    if (token) tokens.push(String(token));
  });
  return tokens;
}

async function sendMulticastChunks(tokens, messageBase) {
  if (!tokens.length) {
    return { successCount: 0, failureCount: 0 };
  }

  const messaging = getMessaging();
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < tokens.length; i += MULTICAST_BATCH) {
    const batch = tokens.slice(i, i + MULTICAST_BATCH);
    try {
      const response = await messaging.sendEachForMulticast({
        tokens: batch,
        ...messageBase,
      });
      successCount += response.successCount;
      failureCount += response.failureCount;
    } catch (err) {
      console.error('[FCM] sendEachForMulticast batch failed', err);
      failureCount += batch.length;
    }
  }

  return { successCount, failureCount };
}

async function notifyAdminsNewOrder(orderId, order) {
  const tokens = await tokensForRole('admin');
  if (!tokens.length) {
    console.info('[FCM] notifyAdminsNewOrder: no admin tokens', { orderId });
    return;
  }

  const productTitle = order.productTitle || 'منتج';
  const amount = order.amount != null ? String(order.amount) : '';
  const currency = order.currency || 'IQD';
  const body =
    amount ? `طلب جديد! ${productTitle} — ${amount} ${currency}` : `طلب جديد! ${productTitle}`;
  const linkUrl = '/admin.html#orders';

  const result = await sendMulticastChunks(tokens, {
    notification: {
      title: 'طلب جديد!',
      body,
    },
    data: {
      type: 'new_order',
      orderId: String(orderId),
      title: 'طلب جديد!',
      body,
      linkUrl,
    },
    webpush: {
      fcmOptions: { link: absoluteLink(linkUrl) },
    },
  });

  console.info('[FCM] notifyAdminsNewOrder sent', { orderId, ...result });
}

async function notifyStudentsAnnouncement(notificationId, doc) {
  if (doc.active === false) return;
  if (doc.targetAudience === 'admin' || doc.type === 'new_order') return;

  const tokens = await tokensForRole('user');
  if (!tokens.length) {
    console.info('[FCM] notifyStudentsAnnouncement: no student tokens', { notificationId });
    return;
  }

  const title = String(doc.title || 'إشعار').trim();
  const body = String(doc.body || doc.message || '').trim();
  const linkUrl = String(doc.linkUrl || '/index.html').trim();

  const result = await sendMulticastChunks(tokens, {
    notification: { title, body },
    data: {
      type: String(doc.type || 'announcement'),
      notificationId: String(notificationId),
      title,
      body,
      linkUrl,
      courseId: String(doc.courseId || ''),
    },
    webpush: {
      fcmOptions: { link: absoluteLink(linkUrl) },
    },
  });

  console.info('[FCM] notifyStudentsAnnouncement sent', { notificationId, ...result });
}

function attachFirestoreListeners(state) {
  const db = getFirestore();

  db.collection('orders').onSnapshot(
    (snapshot) => {
      if (!state.ordersReady) {
        state.ordersReady = true;
        console.info('[Firestore] orders listener ready (skipped initial snapshot)');
        return;
      }
      snapshot.docChanges().forEach((change) => {
        if (change.type !== 'added') return;
        const orderId = change.doc.id;
        const order = change.doc.data();
        notifyAdminsNewOrder(orderId, order).catch((err) => {
          console.error('[FCM] notifyAdminsNewOrder error', orderId, err);
        });
      });
    },
    (err) => {
      console.error('[Firestore] orders listener error', err);
      state.ordersError = err.message;
    }
  );

  db.collection('notifications').onSnapshot(
    (snapshot) => {
      if (!state.notificationsReady) {
        state.notificationsReady = true;
        console.info('[Firestore] notifications listener ready (skipped initial snapshot)');
        return;
      }
      snapshot.docChanges().forEach((change) => {
        if (change.type !== 'added') return;
        const notificationId = change.doc.id;
        const data = change.doc.data();
        notifyStudentsAnnouncement(notificationId, data).catch((err) => {
          console.error('[FCM] notifyStudentsAnnouncement error', notificationId, err);
        });
      });
    },
    (err) => {
      console.error('[Firestore] notifications listener error', err);
      state.notificationsError = err.message;
    }
  );
}

function createApp(state) {
  const app = express();

  app.get('/', (req, res) => {
    res.json({
      ok: true,
      service: 'iraqi-fiber-academy-fcm-push-server',
      listeners: {
        orders: state.ordersReady,
        notifications: state.notificationsReady,
      },
      errors: {
        orders: state.ordersError || null,
        notifications: state.notificationsError || null,
      },
    });
  });

  return app;
}

function main() {
  initFirebaseAdmin();

  const state = {
    ordersReady: false,
    notificationsReady: false,
    ordersError: null,
    notificationsError: null,
  };

  attachFirestoreListeners(state);

  const app = createApp(state);
  app.listen(PORT, () => {
    console.info('[Server] listening on port', PORT);
  });
}

main();
