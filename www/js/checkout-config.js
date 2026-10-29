/**
 * Shared checkout payment & notification settings (Firestore: settings/checkout_config).
 */
import { db } from './firebase-config.js';
import { doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export var CHECKOUT_CONFIG_DOC_ID = 'checkout_config';
export var checkoutConfigRef = doc(db, 'settings', CHECKOUT_CONFIG_DOC_ID);

export var DEFAULT_CHECKOUT_CONFIG = {
  adminEmail: 'info@fiberacademy.iq',
  zaincashWallet: '078XXXXXXXX',
  mastercardCard: '5358-XXXX-XXXX-XXXX',
  mastercardIban: 'IQXX XXXX XXXX XXXX XXXX XXXX XX',
  emailjsPublicKey: '',
  emailjsServiceId: '',
  emailjsTemplateId: '',
};

export function normalizeCheckoutConfig(raw) {
  var src = raw && typeof raw === 'object' ? raw : {};
  return {
    adminEmail: String(src.adminEmail || DEFAULT_CHECKOUT_CONFIG.adminEmail).trim(),
    zaincashWallet: String(src.zaincashWallet || DEFAULT_CHECKOUT_CONFIG.zaincashWallet).trim(),
    mastercardCard: String(src.mastercardCard || DEFAULT_CHECKOUT_CONFIG.mastercardCard).trim(),
    mastercardIban: String(src.mastercardIban || DEFAULT_CHECKOUT_CONFIG.mastercardIban).trim(),
    emailjsPublicKey: String(src.emailjsPublicKey || DEFAULT_CHECKOUT_CONFIG.emailjsPublicKey).trim(),
    emailjsServiceId: String(src.emailjsServiceId || DEFAULT_CHECKOUT_CONFIG.emailjsServiceId).trim(),
    emailjsTemplateId: String(src.emailjsTemplateId || DEFAULT_CHECKOUT_CONFIG.emailjsTemplateId).trim(),
    updatedAt: src.updatedAt || null,
  };
}

var EMAILJS_REQUIRED_KEYS = ['emailjsPublicKey', 'emailjsServiceId', 'emailjsTemplateId'];

export function getMissingEmailJsKeys(config) {
  var normalized = normalizeCheckoutConfig(config);
  return EMAILJS_REQUIRED_KEYS.filter(function (key) {
    return !String(normalized[key] || '').trim();
  });
}

export function logEmailJsConfigStatus(config) {
  var missing = getMissingEmailJsKeys(config);
  if (!missing.length) return;
  console.warn(
    '[CheckoutConfig] EmailJS incomplete — missing keys: ' +
      missing.join(', ') +
      '. Fill them in Admin → إعدادات الدفع والإشعارات or install Firebase Trigger Email Extension.'
  );
}

export function isEmailJsConfigured(config) {
  return getMissingEmailJsKeys(config).length === 0;
}

export function getEmailDeliveryWarning(config) {
  if (isEmailJsConfigured(config)) return '';
  return (
    'تنبيه: لم يتم تكوين EmailJS. رسائل البريد تُحفظ في Firestore (mail_notifications) فقط ' +
    'حتى تقوم بتعبئة مفاتيح EmailJS أدناه أو تثبيت Firebase Trigger Email Extension على المشروع.'
  );
}

export function toPaymentDisplayConfig(config) {
  var normalized = normalizeCheckoutConfig(config);
  return {
    zaincash: {
      wallet: normalized.zaincashWallet,
      label: 'رقم زين كاش',
    },
    mastercard: {
      card: normalized.mastercardCard,
      iban: normalized.mastercardIban,
      label: 'رقم البطاقة / الحساب',
    },
    adminEmail: normalized.adminEmail,
  };
}

export async function fetchCheckoutConfig() {
  try {
    var snap = await getDoc(checkoutConfigRef);
    if (!snap.exists()) return normalizeCheckoutConfig(null);
    return normalizeCheckoutConfig(snap.data());
  } catch (err) {
    console.warn('[CheckoutConfig] fetch failed, using defaults', err);
    return normalizeCheckoutConfig(null);
  }
}

export async function saveCheckoutConfig(payload) {
  var normalized = normalizeCheckoutConfig(payload);
  await setDoc(
    checkoutConfigRef,
    Object.assign({}, normalized, { updatedAt: serverTimestamp() }),
    { merge: true }
  );
  return normalized;
}
