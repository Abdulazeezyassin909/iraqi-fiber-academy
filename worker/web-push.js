function bytesToB64url(bytes) {
  let str = '';
  bytes.forEach(function (b) {
    str += String.fromCharCode(b);
  });
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlToBytes(value) {
  const padded = String(value || '').replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function concat(parts) {
  const size = parts.reduce(function (sum, part) {
    return sum + part.length;
  }, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  parts.forEach(function (part) {
    out.set(part, offset);
    offset += part.length;
  });
  return out;
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt, info: info },
    key,
    length * 8
  );
  return new Uint8Array(bits);
}

async function encryptPayload(subscription, payloadText) {
  const userPublic = b64urlToBytes(subscription.p256dh);
  const authSecret = b64urlToBytes(subscription.auth);
  const localKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const localPublic = new Uint8Array(await crypto.subtle.exportKey('raw', localKeys.publicKey));
  const remoteKey = await crypto.subtle.importKey('raw', userPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: remoteKey }, localKeys.privateKey, 256)
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyInfo = concat([
    new TextEncoder().encode('WebPush: info'),
    new Uint8Array([0]),
    userPublic,
    localPublic,
  ]);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);
  const cek = await hkdf(salt, ikm, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const record = concat([new TextEncoder().encode(payloadText), new Uint8Array([2])]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, record));
  const header = new Uint8Array(16 + 4 + 1 + localPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = localPublic.length;
  header.set(localPublic, 21);
  return { body: concat([header, ciphertext]), localPublic: localPublic };
}

async function vapidJwt(env, audience) {
  const jwk = JSON.parse(env.VAPID_PRIVATE_JWK);
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = bytesToB64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = bytesToB64url(
    new TextEncoder().encode(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: 'mailto:admin@iraqi-fiber-academy.local',
      })
    )
  );
  const unsigned = header + '.' + body;
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned))
  );
  return unsigned + '.' + bytesToB64url(sig);
}

export async function sendWebPush(env, subscription, payload) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_JWK) return;
  const endpoint = String(subscription.endpoint || '');
  const audience = new URL(endpoint).origin;
  const jwt = await vapidJwt(env, audience);
  const encrypted = await encryptPayload(subscription, JSON.stringify(payload));
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: 'vapid t=' + jwt + ', k=' + env.VAPID_PUBLIC_KEY,
      'Crypto-Key': 'p256ecdsa=' + env.VAPID_PUBLIC_KEY,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    },
    body: encrypted.body,
  });
  if (response.status === 404 || response.status === 410) {
    await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?1').bind(endpoint).run();
  } else if (!response.ok) {
    console.warn('web push failed', response.status, await response.text());
  }
}

export async function dispatchWebPushes(env, payload) {
  if (!env.DB || !env.VAPID_PUBLIC_KEY) return;
  const rows = await env.DB.prepare(
    'SELECT endpoint, p256dh, auth, user_id, email, role FROM push_subscriptions'
  ).all();
  const target = String(payload.target || 'all').trim().toLowerCase();
  const jobs = (rows.results || []).filter(function (row) {
    const email = String(row.email || '').toLowerCase();
    const role = String(row.role || '').toLowerCase();
    if (target === 'all' || target === 'all_students') return role !== 'instructor';
    if (target === 'admins') return role === 'admin';
    return target === email || target === String(row.user_id || '');
  });
  await Promise.all(
    jobs.map(function (row) {
      return sendWebPush(env, row, {
        title: payload.title,
        message: payload.message,
        linkUrl: payload.linkUrl || '/',
        type: payload.type || '',
        tag: payload.type || payload.tag || 'general-notification',
        renotify: false,
        icon: '/images/logo.png',
        badge: '/images/badge.png',
      }).catch(function (err) {
        console.warn('web push send failed', err);
      });
    })
  );
}
