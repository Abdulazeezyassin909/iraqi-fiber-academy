/**
 * Admin — Payment & Notification settings (settings/checkout_config).
 */
import {
  fetchCheckoutConfig,
  saveCheckoutConfig,
  DEFAULT_CHECKOUT_CONFIG,
  isEmailJsConfigured,
  getEmailDeliveryWarning,
} from './checkout-config.js';

function setStatus(message, isError) {
  var el = document.getElementById('checkoutSettingsSaveStatus');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('is-error', !!isError);
}

function ensureEmailDeliveryBanner() {
  var form = document.getElementById('checkoutSettingsForm');
  if (!form || document.getElementById('checkoutSettingsEmailWarning')) return;
  var banner = document.createElement('p');
  banner.id = 'checkoutSettingsEmailWarning';
  banner.className = 'admin-panel__meta admin-field__hint';
  banner.setAttribute('role', 'alert');
  banner.hidden = true;
  form.insertBefore(banner, form.firstChild);
}

function updateEmailDeliveryBanner(config) {
  ensureEmailDeliveryBanner();
  var banner = document.getElementById('checkoutSettingsEmailWarning');
  if (!banner) return;
  var warning = getEmailDeliveryWarning(config);
  if (warning) {
    banner.textContent = warning;
    banner.classList.add('is-error');
    banner.hidden = false;
  } else {
    banner.textContent =
      'EmailJS مفعّل — سيتم إرسال البريد مباشرة عند الطلب، مع الاحتفاظ بنسخة في mail_notifications.';
    banner.classList.remove('is-error');
    banner.hidden = false;
  }
}

function populateForm(config) {
  var adminEmail = document.getElementById('checkoutSettingsAdminEmail');
  var zaincash = document.getElementById('checkoutSettingsZaincash');
  var mastercard = document.getElementById('checkoutSettingsMastercard');
  var iban = document.getElementById('checkoutSettingsIban');
  var emailjsKey = document.getElementById('checkoutSettingsEmailjsKey');
  var emailjsService = document.getElementById('checkoutSettingsEmailjsService');
  var emailjsTemplate = document.getElementById('checkoutSettingsEmailjsTemplate');

  if (adminEmail) adminEmail.value = config.adminEmail || DEFAULT_CHECKOUT_CONFIG.adminEmail;
  if (zaincash) zaincash.value = config.zaincashWallet || DEFAULT_CHECKOUT_CONFIG.zaincashWallet;
  if (mastercard) mastercard.value = config.mastercardCard || DEFAULT_CHECKOUT_CONFIG.mastercardCard;
  if (iban) iban.value = config.mastercardIban || DEFAULT_CHECKOUT_CONFIG.mastercardIban;
  if (emailjsKey) emailjsKey.value = config.emailjsPublicKey || '';
  if (emailjsService) emailjsService.value = config.emailjsServiceId || '';
  if (emailjsTemplate) emailjsTemplate.value = config.emailjsTemplateId || '';
}

async function loadCheckoutSettingsForm() {
  setStatus('جاري التحميل…', false);
  try {
    var config = await fetchCheckoutConfig();
    populateForm(config);
    updateEmailDeliveryBanner(config);
    setStatus('', false);
  } catch (err) {
    console.error('[AdminCheckoutSettings] load failed', err);
    populateForm(DEFAULT_CHECKOUT_CONFIG);
    setStatus('تعذر تحميل الإعدادات. تم عرض القيم الافتراضية.', true);
  }
}

async function handleSave(ev) {
  if (ev && ev.preventDefault) ev.preventDefault();

  var adminEmailEl = document.getElementById('checkoutSettingsAdminEmail');
  var zaincashEl = document.getElementById('checkoutSettingsZaincash');
  var mastercardEl = document.getElementById('checkoutSettingsMastercard');
  var ibanEl = document.getElementById('checkoutSettingsIban');
  var emailjsKeyEl = document.getElementById('checkoutSettingsEmailjsKey');
  var emailjsServiceEl = document.getElementById('checkoutSettingsEmailjsService');
  var emailjsTemplateEl = document.getElementById('checkoutSettingsEmailjsTemplate');
  var adminEmail = String((adminEmailEl && adminEmailEl.value) || '').trim();
  var zaincashWallet = String((zaincashEl && zaincashEl.value) || '').trim();
  var mastercardCard = String((mastercardEl && mastercardEl.value) || '').trim();
  var mastercardIban = String((ibanEl && ibanEl.value) || '').trim();
  var emailjsPublicKey = String((emailjsKeyEl && emailjsKeyEl.value) || '').trim();
  var emailjsServiceId = String((emailjsServiceEl && emailjsServiceEl.value) || '').trim();
  var emailjsTemplateId = String((emailjsTemplateEl && emailjsTemplateEl.value) || '').trim();

  if (!adminEmail || adminEmail.indexOf('@') === -1) {
    setStatus('يرجى إدخال بريد إشعارات صالح.', true);
    return;
  }
  if (!zaincashWallet) {
    setStatus('يرجى إدخال رقم زين كاش.', true);
    return;
  }
  if (!mastercardCard) {
    setStatus('يرجى إدخال رقم البطاقة / كي كارد.', true);
    return;
  }

  var saveBtn = document.getElementById('checkoutSettingsSaveBtn');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'جاري الحفظ…';
  }
  setStatus('جاري الحفظ…', false);

  try {
    var saved = await saveCheckoutConfig({
      adminEmail: adminEmail,
      zaincashWallet: zaincashWallet,
      mastercardCard: mastercardCard,
      mastercardIban: mastercardIban,
      emailjsPublicKey: emailjsPublicKey,
      emailjsServiceId: emailjsServiceId,
      emailjsTemplateId: emailjsTemplateId,
    });
    updateEmailDeliveryBanner(saved);
    setStatus(
      isEmailJsConfigured(saved)
        ? 'تم حفظ الإعدادات. EmailJS جاهز لإرسال البريد.'
        : 'تم حفظ الإعدادات. لتفعيل الإرسال الفعلي، أضف مفاتيح EmailJS أو ثبّت Firebase Trigger Email Extension.',
      !isEmailJsConfigured(saved)
    );
  } catch (err) {
    console.error('[AdminCheckoutSettings] save failed', err);
    setStatus((err && err.message) || 'تعذر حفظ الإعدادات.', true);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'حفظ التغييرات';
    }
  }
}

function bindCheckoutSettingsPanel() {
  var panel = document.getElementById('settings-checkout');
  if (!panel || panel.dataset.bound === '1') return;
  panel.dataset.bound = '1';

  ensureEmailDeliveryBanner();

  var form = document.getElementById('checkoutSettingsForm');
  if (form) {
    form.addEventListener('submit', handleSave);
  }

  document.addEventListener('ifa:mail-delivery-unconfigured', function (e) {
    var message = e && e.detail && e.detail.message;
    if (message) {
      setStatus(message, true);
      updateEmailDeliveryBanner({});
    }
  });
}

function initAdminCheckoutSettings() {
  bindCheckoutSettingsPanel();
  if (window.location.hash === '#settings-checkout') {
    loadCheckoutSettingsForm();
  }
}

window.loadAdminCheckoutSettings = loadCheckoutSettingsForm;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdminCheckoutSettings);
} else {
  initAdminCheckoutSettings();
}
