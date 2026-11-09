import { dispatchWebPushes } from './web-push.js';

const FIREBASE_API_KEY = 'AIzaSyCA_FPwBFwbuQrwBgiT88Uu5HzxZA_7UDY';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

async function firebaseUser(request) {
  const url = new URL(request.url);
  const header = request.headers.get('Authorization') || '';
  let idToken = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!idToken) idToken = (url.searchParams.get('token') || '').trim();
  if (!idToken) return null;
  const response = await fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken: idToken }),
    }
  );
  if (!response.ok) return null;
  const data = await response.json();
  const user = data && data.users && data.users[0];
  if (!user || !user.localId) return null;
  return {
    uid: String(user.localId),
    email: String(user.email || '').trim().toLowerCase(),
  };
}

async function ensureNotificationTypeColumn(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      target TEXT NOT NULL DEFAULT 'all',
      link_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT ''
    )`
  ).run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS user_notification_reads (
      user_id TEXT NOT NULL,
      notification_id TEXT NOT NULL,
      read_at TEXT NOT NULL,
      PRIMARY KEY (user_id, notification_id)
    )`
  ).run();
  try {
    await env.DB.prepare("ALTER TABLE notifications ADD COLUMN type TEXT NOT NULL DEFAULT ''").run();
  } catch (err) {
    /* column already exists */
  }
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    )`
  ).run();
}

async function createNotification(env, body) {
  const title = String((body && body.title) || 'تم نشر كورس جديد').trim();
  const message = String((body && (body.message || body.courseTitle)) || '').trim();
  const target = String((body && body.target) || 'all').trim() || 'all';
  const linkUrl = String((body && (body.linkUrl || body.link_url)) || '').trim();
  const type = String((body && body.type) || '').trim();
  if (!message) return json({ error: 'message is required' }, 400);
  await ensureNotificationTypeColumn(env);
  const id = 'ntf_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  const createdAt = new Date().toISOString();
  try {
    await env.DB.prepare(
      'INSERT INTO notifications (id, title, message, target, link_url, created_at, type) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)'
    )
      .bind(id, title, message, target, linkUrl, createdAt, type)
      .run();
  } catch (err) {
    await env.DB.prepare(
      'INSERT INTO notifications (id, title, message, target, link_url, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)'
    )
      .bind(id, title, message, target, linkUrl, createdAt)
      .run();
  }
  const payload = {
    id: id,
    title: title,
    message: message,
    target: target,
    type: type,
    linkUrl: linkUrl,
    createdAt: createdAt,
    isRead: false,
  };
  try {
    await ensurePushTable(env);
    await dispatchWebPushes(env, payload);
  } catch (err) {
    console.warn('web push dispatch failed', err);
  }
  return json(payload);
}

async function listNotifications(env, user) {
  await ensureNotificationTypeColumn(env);
  const uid = user.uid;
  const email = String(user.email || '').trim().toLowerCase();
  const withType = `SELECT n.id, n.title, n.message, n.target, n.link_url, n.created_at, n.type,
            CASE WHEN r.user_id IS NULL THEN 0 ELSE 1 END AS is_read
     FROM notifications n
     LEFT JOIN user_notification_reads r
       ON r.notification_id = n.id AND r.user_id = ?1
     WHERE lower(n.target) = 'all'
        OR lower(n.target) = 'all_students'
        OR n.target = ?1
        OR lower(n.target) = ?2
        OR lower(n.target) = 'admins'
     ORDER BY n.created_at DESC
     LIMIT 50`;
  const withoutType = `SELECT n.id, n.title, n.message, n.target, n.link_url, n.created_at, '' AS type,
            CASE WHEN r.user_id IS NULL THEN 0 ELSE 1 END AS is_read
     FROM notifications n
     LEFT JOIN user_notification_reads r
       ON r.notification_id = n.id AND r.user_id = ?1
     WHERE lower(n.target) = 'all'
        OR lower(n.target) = 'all_students'
        OR n.target = ?1
        OR lower(n.target) = ?2
        OR lower(n.target) = 'admins'
     ORDER BY n.created_at DESC
     LIMIT 50`;
  let result;
  try {
    result = await env.DB.prepare(withType).bind(uid, email).all();
  } catch (err) {
    result = await env.DB.prepare(withoutType).bind(uid, email).all();
  }
  const items = (result.results || []).map(function (row) {
    return {
      id: row.id,
      title: row.title,
      message: row.message,
      target: row.target,
      linkUrl: row.link_url,
      type: row.type || '',
      createdAt: row.created_at,
      isRead: row.is_read === 1,
    };
  });
  return json({ notifications: items });
}

async function updateNotification(env, id, body) {
  const title = String((body && body.title) || '').trim();
  const message = String((body && body.message) || '').trim();
  if (!id || !title || !message) return json({ error: 'title and message are required' }, 400);
  const existing = await env.DB.prepare('SELECT id FROM notifications WHERE id = ?1').bind(id).first();
  if (!existing) return json({ error: 'not found' }, 404);
  await env.DB.prepare('UPDATE notifications SET title = ?1, message = ?2 WHERE id = ?3')
    .bind(title, message, id)
    .run();
  return json({ ok: true, id: id, title: title, message: message });
}

async function deleteNotification(env, id) {
  if (!id) return json({ error: 'missing id' }, 400);
  await env.DB.prepare('DELETE FROM user_notification_reads WHERE notification_id = ?1').bind(id).run();
  const result = await env.DB.prepare('DELETE FROM notifications WHERE id = ?1').bind(id).run();
  if (!result.meta || result.meta.changes === 0) return json({ error: 'not found' }, 404);
  return json({ ok: true, id: id });
}

async function markRead(env, uid, id) {
  if (!id) return json({ error: 'missing id' }, 400);
  const existing = await env.DB.prepare('SELECT id FROM notifications WHERE id = ?1').bind(id).first();
  if (!existing) return json({ error: 'not found' }, 404);
  await env.DB.prepare(
    'INSERT INTO user_notification_reads (user_id, notification_id, read_at) VALUES (?1, ?2, ?3) ON CONFLICT(user_id, notification_id) DO UPDATE SET read_at = excluded.read_at'
  )
    .bind(uid, id, new Date().toISOString())
    .run();
  return json({ ok: true, id: id });
}

async function firestoreFields(idToken, docPath) {
  const response = await fetch(
    'https://firestore.googleapis.com/v1/projects/iraqi-fiber-academy/databases/(default)/documents/' + docPath,
    { headers: { Authorization: 'Bearer ' + idToken } }
  );
  if (!response.ok) return null;
  const data = await response.json();
  return data && data.fields ? data.fields : null;
}

function firestoreString(fields, key) {
  const field = fields && fields[key];
  if (!field) return '';
  return String(field.stringValue || field.integerValue || '').trim();
}

async function createPurchaseNotification(env, request, body) {
  const header = request.headers.get('Authorization') || '';
  const idToken = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const courseId = String((body && body.courseId) || '').replace(/[^\w-]/g, '');
  if (!idToken || !courseId) return json({ skipped: true, reason: 'missing_course' });

  const course = await firestoreFields(idToken, 'courses/' + courseId);
  if (!course) return json({ skipped: true, reason: 'course_not_found' });

  let instructorEmail = firestoreString(course, 'instructorEmail').toLowerCase();
  const instructorId = firestoreString(course, 'instructorId');
  if (!instructorEmail && instructorId) {
    const instructor = await firestoreFields(idToken, 'users/' + instructorId);
    instructorEmail = firestoreString(instructor, 'email').toLowerCase();
  }
  const studentName = String((body && body.studentName) || 'طالب').trim() || 'طالب';
  const courseName = firestoreString(course, 'title') || String((body && body.courseName) || 'كورس').trim();
  const note = {
    title: 'طلب شراء جديد (قيد المراجعة)',
    message:
      'قدم الطالب ' +
      studentName +
      ' طلب شراء لكورس: ' +
      courseName +
      ' وهو الآن قيد المراجعة من قبل الإدارة.',
    type: 'new_order',
  };
  if (instructorEmail && instructorEmail.indexOf('@') !== -1) {
    await createNotification(env, Object.assign({ target: instructorEmail, linkUrl: 'instructor.html#orders' }, note));
  }
  return createNotification(env, Object.assign({ target: 'admins', linkUrl: 'admin.html#orders' }, note));
}

async function notifyOrderStatus(env, request, body) {
  const header = request.headers.get('Authorization') || '';
  const idToken = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const status = String((body && body.status) || '').trim();
  const orderId = String((body && body.orderId) || '').trim();
  if (!idToken || !orderId) return json({ skipped: true, reason: 'missing_order' });
  if (status !== 'approved' && status !== 'rejected') return json({ error: 'bad status' }, 400);

  const order = await firestoreFields(idToken, 'orders/' + encodeURIComponent(orderId));
  const courseId = String(
    (order && firestoreString(order, 'courseId')) || (body && body.courseId) || ''
  ).trim();
  let courseName =
    (order && firestoreString(order, 'productTitle')) ||
    String((body && body.courseName) || '').trim() ||
    'كورس';
  let instructorId = order ? firestoreString(order, 'instructorId') : '';
  let instructorEmail = order ? firestoreString(order, 'instructorEmail').toLowerCase() : '';
  const studentName =
    (order && (firestoreString(order, 'userName') || firestoreString(order, 'userEmail'))) ||
    String((body && body.studentName) || '').trim() ||
    'طالب';
  if (courseId) {
    const course = await firestoreFields(idToken, 'courses/' + encodeURIComponent(courseId));
    if (course) {
      courseName = firestoreString(course, 'title') || courseName;
      instructorEmail = firestoreString(course, 'instructorEmail').toLowerCase();
      if (!instructorId) instructorId = firestoreString(course, 'instructorId');
    }
  }
  if (!instructorEmail && instructorId) {
    const instructor = await firestoreFields(idToken, 'users/' + encodeURIComponent(instructorId));
    instructorEmail = firestoreString(instructor, 'email').toLowerCase();
  }
  if (!instructorEmail || instructorEmail.indexOf('@') === -1) {
    return json({ skipped: true, reason: 'no_instructor' });
  }

  if (status === 'approved') {
    return createNotification(env, {
      title: 'تمت الموافقة على طلب الشراء',
      message:
        'تمت الموافقة على طلب الشراء المقدم من ' +
        studentName +
        ' لكورس: ' +
        courseName +
        ' وتمت إضافة المبلغ لحسابك.',
      target: instructorEmail,
      type: 'order_approved',
      linkUrl: 'instructor.html#orders',
    });
  }
  return createNotification(env, {
    title: 'تم رفض طلب الشراء',
    message: 'تم رفض طلب الشراء المقدم من ' + studentName + ' لكورس: ' + courseName + '.',
    target: instructorEmail,
    type: 'order_rejected',
    linkUrl: 'instructor.html#orders',
  });
}

async function ensurePushTable(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'user',
      updated_at TEXT NOT NULL
    )`
  ).run();
}

async function savePushSubscription(env, user, body) {
  const sub = body && body.subscription;
  const endpoint = sub && sub.endpoint ? String(sub.endpoint) : '';
  const p256dh = sub && sub.keys ? String(sub.keys.p256dh || '') : '';
  const auth = sub && sub.keys ? String(sub.keys.auth || '') : '';
  if (!endpoint || !p256dh || !auth) return json({ error: 'invalid subscription' }, 400);
  await ensurePushTable(env);
  const requested = String((body && body.role) || 'user').toLowerCase();
  const role = requested === 'admin' || requested === 'instructor' ? requested : 'user';
  await env.DB.prepare(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_id, email, role, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(endpoint) DO UPDATE SET
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       user_id = excluded.user_id,
       email = excluded.email,
       role = excluded.role,
       updated_at = excluded.updated_at`
  )
    .bind(endpoint, p256dh, auth, user.uid, user.email || '', role, new Date().toISOString())
    .run();
  return json({ ok: true });
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const user = await firebaseUser(request);
  if (!user) return json({ error: 'unauthorized' }, 401);

  if (request.method === 'POST' && url.pathname === '/api/push/subscribe') {
    const body = await request.json().catch(function () {
      return {};
    });
    return savePushSubscription(env, user, body);
  }

  if (request.method === 'GET' && url.pathname === '/api/notifications') {
    return listNotifications(env, user);
  }

  if (request.method === 'POST' && url.pathname === '/api/notifications/purchase') {
    const body = await request.json().catch(function () {
      return {};
    });
    return createPurchaseNotification(env, request, body);
  }

  if (request.method === 'POST' && url.pathname === '/api/notifications/order-status') {
    const body = await request.json().catch(function () {
      return {};
    });
    return notifyOrderStatus(env, request, body);
  }

  if (request.method === 'POST' && url.pathname === '/api/notifications') {
    const body = await request.json().catch(function () {
      return {};
    });
    if (body.send_notification === false) return json({ skipped: true });
    return createNotification(env, body);
  }

  const readMatch = url.pathname.match(/^\/api\/notifications\/read\/([^/]+)$/);
  if (request.method === 'POST' && readMatch) {
    return markRead(env, user.uid, decodeURIComponent(readMatch[1]));
  }

  const itemMatch = url.pathname.match(/^\/api\/notifications\/([^/]+)$/);
  if (itemMatch && request.method === 'PUT') {
    const body = await request.json().catch(function () {
      return {};
    });
    return updateNotification(env, decodeURIComponent(itemMatch[1]), body);
  }
  if (itemMatch && request.method === 'DELETE') {
    return deleteNotification(env, decodeURIComponent(itemMatch[1]));
  }

  return json({ error: 'not found' }, 404);
}

function firestoreValue(field) {
  if (!field) return '';
  if (field.stringValue != null) return field.stringValue;
  if (field.integerValue != null) return Number(field.integerValue);
  if (field.doubleValue != null) return Number(field.doubleValue);
  if (field.timestampValue != null) return field.timestampValue;
  return '';
}

async function queryOrders(idToken, field, value) {
  const response = await fetch(
    'https://firestore.googleapis.com/v1/projects/iraqi-fiber-academy/databases/(default)/documents:runQuery',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + idToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'orders' }],
          where: {
            fieldFilter: {
              field: { fieldPath: field },
              op: 'EQUAL',
              value: { stringValue: value },
            },
          },
        },
      }),
    }
  );
  if (!response.ok) return [];
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

function orderFromQueryRow(entry) {
  const document = entry && entry.document;
  if (!document || !document.fields || !document.name) return null;
  const fields = document.fields;
  return {
    id: document.name.split('/').pop(),
    userName: firestoreValue(fields.userName),
    userEmail: firestoreValue(fields.userEmail),
    productTitle: firestoreValue(fields.productTitle),
    amount: firestoreValue(fields.amount),
    currency: firestoreValue(fields.currency) || 'IQD',
    status: firestoreValue(fields.status),
    courseId: firestoreValue(fields.courseId),
    paymentMethod: firestoreValue(fields.paymentMethod),
    createdAt: firestoreValue(fields.createdAt),
    receiptBase64: firestoreValue(fields.receiptBase64),
  };
}

async function listInstructorOrders(request) {
  const user = await firebaseUser(request);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const header = request.headers.get('Authorization') || '';
  const idToken = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const batches = [];
  if (user.email) batches.push(queryOrders(idToken, 'instructorEmail', user.email));
  batches.push(queryOrders(idToken, 'instructorId', user.uid));
  const groups = await Promise.all(batches);
  const orders = new Map();
  groups.flat().forEach(function (row) {
    const order = orderFromQueryRow(row);
    if (order) orders.set(order.id, order);
  });
  return json({
    orders: Array.from(orders.values()).sort(function (a, b) {
      return String(b.createdAt).localeCompare(String(a.createdAt));
    }),
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/notifications') || url.pathname.startsWith('/api/push')) {
      try {
        return await handleApi(request, env);
      } catch (err) {
        return json({ error: err && err.message ? err.message : 'server error' }, 500);
      }
    }
    if (url.pathname === '/api/instructor/orders' && request.method === 'GET') {
      try {
        return await listInstructorOrders(request);
      } catch (err) {
        return json({ error: err && err.message ? err.message : 'server error' }, 500);
      }
    }
    const pages = {
      '/contact': '/contact.html',
      '/privacy-policy': '/privacy-policy.html',
      '/terms': '/terms.html',
    };
    const pretty = pages[url.pathname.replace(/\/$/, '')];
    if (pretty) {
      const next = new URL(request.url);
      next.pathname = pretty;
      return env.ASSETS.fetch(new Request(next, request));
    }
    return env.ASSETS.fetch(request);
  },
};
