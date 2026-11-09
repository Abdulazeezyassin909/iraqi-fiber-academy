var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker/web-push.js
function bytesToB64url(bytes) {
  let str = "";
  bytes.forEach(function(b) {
    str += String.fromCharCode(b);
  });
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(bytesToB64url, "bytesToB64url");
function b64urlToBytes(value) {
  const padded = String(value || "").replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
__name(b64urlToBytes, "b64urlToBytes");
function concat(parts) {
  const size = parts.reduce(function(sum, part) {
    return sum + part.length;
  }, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  parts.forEach(function(part) {
    out.set(part, offset);
    offset += part.length;
  });
  return out;
}
__name(concat, "concat");
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    length * 8
  );
  return new Uint8Array(bits);
}
__name(hkdf, "hkdf");
async function encryptPayload(subscription, payloadText) {
  const userPublic = b64urlToBytes(subscription.p256dh);
  const authSecret = b64urlToBytes(subscription.auth);
  const localKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const localPublic = new Uint8Array(await crypto.subtle.exportKey("raw", localKeys.publicKey));
  const remoteKey = await crypto.subtle.importKey("raw", userPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: remoteKey }, localKeys.privateKey, 256)
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyInfo = concat([
    new TextEncoder().encode("WebPush: info"),
    new Uint8Array([0]),
    userPublic,
    localPublic
  ]);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);
  const cek = await hkdf(salt, ikm, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, new TextEncoder().encode("Content-Encoding: nonce\0"), 12);
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const record = concat([new TextEncoder().encode(payloadText), new Uint8Array([2])]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, record));
  const header = new Uint8Array(16 + 4 + 1 + localPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = localPublic.length;
  header.set(localPublic, 21);
  return { body: concat([header, ciphertext]), localPublic };
}
__name(encryptPayload, "encryptPayload");
async function vapidJwt(env, audience) {
  const jwk = JSON.parse(env.VAPID_PRIVATE_JWK);
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = bytesToB64url(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = bytesToB64url(
    new TextEncoder().encode(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1e3) + 12 * 60 * 60,
        sub: "mailto:admin@iraqi-fiber-academy.local"
      })
    )
  );
  const unsigned = header + "." + body;
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned))
  );
  return unsigned + "." + bytesToB64url(sig);
}
__name(vapidJwt, "vapidJwt");
async function sendWebPush(env, subscription, payload) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_JWK) return;
  const endpoint = String(subscription.endpoint || "");
  const audience = new URL(endpoint).origin;
  const jwt = await vapidJwt(env, audience);
  const encrypted = await encryptPayload(subscription, JSON.stringify(payload));
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: "vapid t=" + jwt + ", k=" + env.VAPID_PUBLIC_KEY,
      "Crypto-Key": "p256ecdsa=" + env.VAPID_PUBLIC_KEY,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Urgency: "normal"
    },
    body: encrypted.body
  });
  if (response.status === 404 || response.status === 410) {
    await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?1").bind(endpoint).run();
  } else if (!response.ok) {
    console.warn("web push failed", response.status, await response.text());
  }
}
__name(sendWebPush, "sendWebPush");
async function dispatchWebPushes(env, payload) {
  if (!env.DB || !env.VAPID_PUBLIC_KEY) return;
  const rows = await env.DB.prepare(
    "SELECT endpoint, p256dh, auth, user_id, email, role FROM push_subscriptions"
  ).all();
  const target = String(payload.target || "all").trim().toLowerCase();
  const jobs = (rows.results || []).filter(function(row) {
    const email = String(row.email || "").toLowerCase();
    const role = String(row.role || "").toLowerCase();
    if (target === "all" || target === "all_students") return role !== "instructor";
    if (target === "admins") return role === "admin";
    return target === email || target === String(row.user_id || "");
  });
  await Promise.all(
    jobs.map(function(row) {
      return sendWebPush(env, row, {
        title: payload.title,
        message: payload.message,
        linkUrl: payload.linkUrl || "/",
        type: payload.type || "",
        tag: payload.type || payload.tag || "general-notification",
        renotify: false,
        icon: "/images/logo.png",
        badge: "/images/badge.png"
      }).catch(function(err) {
        console.warn("web push send failed", err);
      });
    })
  );
}
__name(dispatchWebPushes, "dispatchWebPushes");

// worker/index.js
var FIREBASE_API_KEY = "AIzaSyCA_FPwBFwbuQrwBgiT88Uu5HzxZA_7UDY";
function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
__name(json, "json");
async function firebaseUser(request) {
  const url = new URL(request.url);
  const header = request.headers.get("Authorization") || "";
  let idToken = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!idToken) idToken = (url.searchParams.get("token") || "").trim();
  if (!idToken) return null;
  const response = await fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + FIREBASE_API_KEY,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken })
    }
  );
  if (!response.ok) return null;
  const data = await response.json();
  const user = data && data.users && data.users[0];
  if (!user || !user.localId) return null;
  return {
    uid: String(user.localId),
    email: String(user.email || "").trim().toLowerCase()
  };
}
__name(firebaseUser, "firebaseUser");
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
__name(ensureNotificationTypeColumn, "ensureNotificationTypeColumn");
async function createNotification(env, body) {
  const title = String(body && body.title || "\u062A\u0645 \u0646\u0634\u0631 \u0643\u0648\u0631\u0633 \u062C\u062F\u064A\u062F").trim();
  const message = String(body && (body.message || body.courseTitle) || "").trim();
  const target = String(body && body.target || "all").trim() || "all";
  const linkUrl = String(body && (body.linkUrl || body.link_url) || "").trim();
  const type = String(body && body.type || "").trim();
  if (!message) return json({ error: "message is required" }, 400);
  await ensureNotificationTypeColumn(env);
  const id = "ntf_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  try {
    await env.DB.prepare(
      "INSERT INTO notifications (id, title, message, target, link_url, created_at, type) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
    ).bind(id, title, message, target, linkUrl, createdAt, type).run();
  } catch (err) {
    await env.DB.prepare(
      "INSERT INTO notifications (id, title, message, target, link_url, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
    ).bind(id, title, message, target, linkUrl, createdAt).run();
  }
  const payload = {
    id,
    title,
    message,
    target,
    type,
    linkUrl,
    createdAt,
    isRead: false
  };
  try {
    await ensurePushTable(env);
    await dispatchWebPushes(env, payload);
  } catch (err) {
    console.warn("web push dispatch failed", err);
  }
  return json(payload);
}
__name(createNotification, "createNotification");
async function listNotifications(env, user) {
  await ensureNotificationTypeColumn(env);
  const uid = user.uid;
  const email = String(user.email || "").trim().toLowerCase();
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
  const items = (result.results || []).map(function(row) {
    return {
      id: row.id,
      title: row.title,
      message: row.message,
      target: row.target,
      linkUrl: row.link_url,
      type: row.type || "",
      createdAt: row.created_at,
      isRead: row.is_read === 1
    };
  });
  return json({ notifications: items });
}
__name(listNotifications, "listNotifications");
async function updateNotification(env, id, body) {
  const title = String(body && body.title || "").trim();
  const message = String(body && body.message || "").trim();
  if (!id || !title || !message) return json({ error: "title and message are required" }, 400);
  const existing = await env.DB.prepare("SELECT id FROM notifications WHERE id = ?1").bind(id).first();
  if (!existing) return json({ error: "not found" }, 404);
  await env.DB.prepare("UPDATE notifications SET title = ?1, message = ?2 WHERE id = ?3").bind(title, message, id).run();
  return json({ ok: true, id, title, message });
}
__name(updateNotification, "updateNotification");
async function deleteNotification(env, id) {
  if (!id) return json({ error: "missing id" }, 400);
  await env.DB.prepare("DELETE FROM user_notification_reads WHERE notification_id = ?1").bind(id).run();
  const result = await env.DB.prepare("DELETE FROM notifications WHERE id = ?1").bind(id).run();
  if (!result.meta || result.meta.changes === 0) return json({ error: "not found" }, 404);
  return json({ ok: true, id });
}
__name(deleteNotification, "deleteNotification");
async function markRead(env, uid, id) {
  if (!id) return json({ error: "missing id" }, 400);
  const existing = await env.DB.prepare("SELECT id FROM notifications WHERE id = ?1").bind(id).first();
  if (!existing) return json({ error: "not found" }, 404);
  await env.DB.prepare(
    "INSERT INTO user_notification_reads (user_id, notification_id, read_at) VALUES (?1, ?2, ?3) ON CONFLICT(user_id, notification_id) DO UPDATE SET read_at = excluded.read_at"
  ).bind(uid, id, (/* @__PURE__ */ new Date()).toISOString()).run();
  return json({ ok: true, id });
}
__name(markRead, "markRead");
async function firestoreFields(idToken, docPath) {
  const response = await fetch(
    "https://firestore.googleapis.com/v1/projects/iraqi-fiber-academy/databases/(default)/documents/" + docPath,
    { headers: { Authorization: "Bearer " + idToken } }
  );
  if (!response.ok) return null;
  const data = await response.json();
  return data && data.fields ? data.fields : null;
}
__name(firestoreFields, "firestoreFields");
function firestoreString(fields, key) {
  const field = fields && fields[key];
  if (!field) return "";
  return String(field.stringValue || field.integerValue || "").trim();
}
__name(firestoreString, "firestoreString");
async function createPurchaseNotification(env, request, body) {
  const header = request.headers.get("Authorization") || "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const courseId = String(body && body.courseId || "").replace(/[^\w-]/g, "");
  if (!idToken || !courseId) return json({ skipped: true, reason: "missing_course" });
  const course = await firestoreFields(idToken, "courses/" + courseId);
  if (!course) return json({ skipped: true, reason: "course_not_found" });
  let instructorEmail = firestoreString(course, "instructorEmail").toLowerCase();
  const instructorId = firestoreString(course, "instructorId");
  if (!instructorEmail && instructorId) {
    const instructor = await firestoreFields(idToken, "users/" + instructorId);
    instructorEmail = firestoreString(instructor, "email").toLowerCase();
  }
  const studentName = String(body && body.studentName || "\u0637\u0627\u0644\u0628").trim() || "\u0637\u0627\u0644\u0628";
  const courseName = firestoreString(course, "title") || String(body && body.courseName || "\u0643\u0648\u0631\u0633").trim();
  const note = {
    title: "\u0637\u0644\u0628 \u0634\u0631\u0627\u0621 \u062C\u062F\u064A\u062F (\u0642\u064A\u062F \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629)",
    message: "\u0642\u062F\u0645 \u0627\u0644\u0637\u0627\u0644\u0628 " + studentName + " \u0637\u0644\u0628 \u0634\u0631\u0627\u0621 \u0644\u0643\u0648\u0631\u0633: " + courseName + " \u0648\u0647\u0648 \u0627\u0644\u0622\u0646 \u0642\u064A\u062F \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629 \u0645\u0646 \u0642\u0628\u0644 \u0627\u0644\u0625\u062F\u0627\u0631\u0629.",
    type: "new_order"
  };
  if (instructorEmail && instructorEmail.indexOf("@") !== -1) {
    await createNotification(env, Object.assign({ target: instructorEmail, linkUrl: "instructor.html#orders" }, note));
  }
  return createNotification(env, Object.assign({ target: "admins", linkUrl: "admin.html#orders" }, note));
}
__name(createPurchaseNotification, "createPurchaseNotification");
async function notifyOrderStatus(env, request, body) {
  const header = request.headers.get("Authorization") || "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const status = String(body && body.status || "").trim();
  const orderId = String(body && body.orderId || "").trim();
  if (!idToken || !orderId) return json({ skipped: true, reason: "missing_order" });
  if (status !== "approved" && status !== "rejected") return json({ error: "bad status" }, 400);
  const order = await firestoreFields(idToken, "orders/" + encodeURIComponent(orderId));
  const courseId = String(
    order && firestoreString(order, "courseId") || body && body.courseId || ""
  ).trim();
  let courseName = order && firestoreString(order, "productTitle") || String(body && body.courseName || "").trim() || "\u0643\u0648\u0631\u0633";
  let instructorId = order ? firestoreString(order, "instructorId") : "";
  let instructorEmail = order ? firestoreString(order, "instructorEmail").toLowerCase() : "";
  const studentName = order && (firestoreString(order, "userName") || firestoreString(order, "userEmail")) || String(body && body.studentName || "").trim() || "\u0637\u0627\u0644\u0628";
  if (courseId) {
    const course = await firestoreFields(idToken, "courses/" + encodeURIComponent(courseId));
    if (course) {
      courseName = firestoreString(course, "title") || courseName;
      instructorEmail = firestoreString(course, "instructorEmail").toLowerCase();
      if (!instructorId) instructorId = firestoreString(course, "instructorId");
    }
  }
  if (!instructorEmail && instructorId) {
    const instructor = await firestoreFields(idToken, "users/" + encodeURIComponent(instructorId));
    instructorEmail = firestoreString(instructor, "email").toLowerCase();
  }
  if (!instructorEmail || instructorEmail.indexOf("@") === -1) {
    return json({ skipped: true, reason: "no_instructor" });
  }
  if (status === "approved") {
    return createNotification(env, {
      title: "\u062A\u0645\u062A \u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0629 \u0639\u0644\u0649 \u0637\u0644\u0628 \u0627\u0644\u0634\u0631\u0627\u0621",
      message: "\u062A\u0645\u062A \u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0629 \u0639\u0644\u0649 \u0637\u0644\u0628 \u0627\u0644\u0634\u0631\u0627\u0621 \u0627\u0644\u0645\u0642\u062F\u0645 \u0645\u0646 " + studentName + " \u0644\u0643\u0648\u0631\u0633: " + courseName + " \u0648\u062A\u0645\u062A \u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0645\u0628\u0644\u063A \u0644\u062D\u0633\u0627\u0628\u0643.",
      target: instructorEmail,
      type: "order_approved",
      linkUrl: "instructor.html#orders"
    });
  }
  return createNotification(env, {
    title: "\u062A\u0645 \u0631\u0641\u0636 \u0637\u0644\u0628 \u0627\u0644\u0634\u0631\u0627\u0621",
    message: "\u062A\u0645 \u0631\u0641\u0636 \u0637\u0644\u0628 \u0627\u0644\u0634\u0631\u0627\u0621 \u0627\u0644\u0645\u0642\u062F\u0645 \u0645\u0646 " + studentName + " \u0644\u0643\u0648\u0631\u0633: " + courseName + ".",
    target: instructorEmail,
    type: "order_rejected",
    linkUrl: "instructor.html#orders"
  });
}
__name(notifyOrderStatus, "notifyOrderStatus");
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
__name(ensurePushTable, "ensurePushTable");
async function savePushSubscription(env, user, body) {
  const sub = body && body.subscription;
  const endpoint = sub && sub.endpoint ? String(sub.endpoint) : "";
  const p256dh = sub && sub.keys ? String(sub.keys.p256dh || "") : "";
  const auth = sub && sub.keys ? String(sub.keys.auth || "") : "";
  if (!endpoint || !p256dh || !auth) return json({ error: "invalid subscription" }, 400);
  await ensurePushTable(env);
  const requested = String(body && body.role || "user").toLowerCase();
  const role = requested === "admin" || requested === "instructor" ? requested : "user";
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
  ).bind(endpoint, p256dh, auth, user.uid, user.email || "", role, (/* @__PURE__ */ new Date()).toISOString()).run();
  return json({ ok: true });
}
__name(savePushSubscription, "savePushSubscription");
async function handleApi(request, env) {
  const url = new URL(request.url);
  const user = await firebaseUser(request);
  if (!user) return json({ error: "unauthorized" }, 401);
  if (request.method === "POST" && url.pathname === "/api/push/subscribe") {
    const body = await request.json().catch(function() {
      return {};
    });
    return savePushSubscription(env, user, body);
  }
  if (request.method === "GET" && url.pathname === "/api/notifications") {
    return listNotifications(env, user);
  }
  if (request.method === "POST" && url.pathname === "/api/notifications/purchase") {
    const body = await request.json().catch(function() {
      return {};
    });
    return createPurchaseNotification(env, request, body);
  }
  if (request.method === "POST" && url.pathname === "/api/notifications/order-status") {
    const body = await request.json().catch(function() {
      return {};
    });
    return notifyOrderStatus(env, request, body);
  }
  if (request.method === "POST" && url.pathname === "/api/notifications") {
    const body = await request.json().catch(function() {
      return {};
    });
    if (body.send_notification === false) return json({ skipped: true });
    return createNotification(env, body);
  }
  const readMatch = url.pathname.match(/^\/api\/notifications\/read\/([^/]+)$/);
  if (request.method === "POST" && readMatch) {
    return markRead(env, user.uid, decodeURIComponent(readMatch[1]));
  }
  const itemMatch = url.pathname.match(/^\/api\/notifications\/([^/]+)$/);
  if (itemMatch && request.method === "PUT") {
    const body = await request.json().catch(function() {
      return {};
    });
    return updateNotification(env, decodeURIComponent(itemMatch[1]), body);
  }
  if (itemMatch && request.method === "DELETE") {
    return deleteNotification(env, decodeURIComponent(itemMatch[1]));
  }
  return json({ error: "not found" }, 404);
}
__name(handleApi, "handleApi");
function firestoreValue(field) {
  if (!field) return "";
  if (field.stringValue != null) return field.stringValue;
  if (field.integerValue != null) return Number(field.integerValue);
  if (field.doubleValue != null) return Number(field.doubleValue);
  if (field.timestampValue != null) return field.timestampValue;
  return "";
}
__name(firestoreValue, "firestoreValue");
async function queryOrders(idToken, field, value) {
  const response = await fetch(
    "https://firestore.googleapis.com/v1/projects/iraqi-fiber-academy/databases/(default)/documents:runQuery",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + idToken,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "orders" }],
          where: {
            fieldFilter: {
              field: { fieldPath: field },
              op: "EQUAL",
              value: { stringValue: value }
            }
          }
        }
      })
    }
  );
  if (!response.ok) return [];
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}
__name(queryOrders, "queryOrders");
function orderFromQueryRow(entry) {
  const document = entry && entry.document;
  if (!document || !document.fields || !document.name) return null;
  const fields = document.fields;
  return {
    id: document.name.split("/").pop(),
    userName: firestoreValue(fields.userName),
    userEmail: firestoreValue(fields.userEmail),
    productTitle: firestoreValue(fields.productTitle),
    amount: firestoreValue(fields.amount),
    currency: firestoreValue(fields.currency) || "IQD",
    status: firestoreValue(fields.status),
    courseId: firestoreValue(fields.courseId),
    paymentMethod: firestoreValue(fields.paymentMethod),
    createdAt: firestoreValue(fields.createdAt),
    receiptBase64: firestoreValue(fields.receiptBase64)
  };
}
__name(orderFromQueryRow, "orderFromQueryRow");
async function listInstructorOrders(request) {
  const user = await firebaseUser(request);
  if (!user) return json({ error: "unauthorized" }, 401);
  const header = request.headers.get("Authorization") || "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const batches = [];
  if (user.email) batches.push(queryOrders(idToken, "instructorEmail", user.email));
  batches.push(queryOrders(idToken, "instructorId", user.uid));
  const groups = await Promise.all(batches);
  const orders = /* @__PURE__ */ new Map();
  groups.flat().forEach(function(row) {
    const order = orderFromQueryRow(row);
    if (order) orders.set(order.id, order);
  });
  return json({
    orders: Array.from(orders.values()).sort(function(a, b) {
      return String(b.createdAt).localeCompare(String(a.createdAt));
    })
  });
}
__name(listInstructorOrders, "listInstructorOrders");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/notifications") || url.pathname.startsWith("/api/push")) {
      try {
        return await handleApi(request, env);
      } catch (err) {
        return json({ error: err && err.message ? err.message : "server error" }, 500);
      }
    }
    if (url.pathname === "/api/instructor/orders" && request.method === "GET") {
      try {
        return await listInstructorOrders(request);
      } catch (err) {
        return json({ error: err && err.message ? err.message : "server error" }, 500);
      }
    }
    const pages = {
      "/contact": "/contact.html",
      "/privacy-policy": "/privacy-policy.html",
      "/terms": "/terms.html"
    };
    const pretty = pages[url.pathname.replace(/\/$/, "")];
    if (pretty) {
      const next = new URL(request.url);
      next.pathname = pretty;
      return env.ASSETS.fetch(new Request(next, request));
    }
    return env.ASSETS.fetch(request);
  }
};

// ../../AppData/Local/Temp/cursor-sandbox-cache/f2bf91a8186462f4b8c5fe520251bfca/npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../AppData/Local/Temp/cursor-sandbox-cache/f2bf91a8186462f4b8c5fe520251bfca/npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-5nWL5t/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../AppData/Local/Temp/cursor-sandbox-cache/f2bf91a8186462f4b8c5fe520251bfca/npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-5nWL5t/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
