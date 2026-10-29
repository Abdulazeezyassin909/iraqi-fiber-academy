/**
 * Manual checkout — ZainCash / Mastercard transfer + Base64 receipt (no Storage).
 * Creates Firestore order, in-app admin notification, and mail_notifications email trigger.
 */
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  fetchCheckoutConfig,
  toPaymentDisplayConfig,
  getMissingEmailJsKeys,
} from './checkout-config.js';
import { notifyAdminNewOrder } from './mail-notifications.js';

var MAX_RECEIPT_INPUT_BYTES = 8 * 1024 * 1024;
var MAX_RECEIPT_BASE64_LEN = 150 * 1024;
var RECEIPT_MAX_DIMENSION = 800;
var RECEIPT_JPEG_QUALITY = 0.7;

var state = {
  user: null,
  product: null,
  planId: '',
  courseId: '',
  paymentMethod: 'zaincash',
  submitting: false,
  paymentConfig: toPaymentDisplayConfig(null),
};

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function readQueryParams() {
  try {
    var params = new URLSearchParams(window.location.search);
    return {
      planId: String(params.get('planId') || params.get('plan') || '').trim(),
      courseId: String(params.get('courseId') || params.get('course') || '').trim(),
    };
  } catch (err) {
    return { planId: '', courseId: '' };
  }
}

function formatIqd(amount) {
  var n = Number(amount);
  if (!isFinite(n) || n <= 0) return '0 د.ع';
  var grouped = String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return grouped + ' د.ع';
}

function parsePrice(val) {
  if (typeof val === 'number' && isFinite(val)) return val < 0 ? 0 : val;
  var clean = String(val == null ? '' : val)
    .replace(/,/g, '')
    .replace(/٬/g, '')
    .trim();
  var n = Number(clean);
  return isFinite(n) && n > 0 ? n : 0;
}

function newOrderId() {
  return 'ord_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function loadImageFromFile(file) {
  return new Promise(function (resolve, reject) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      reject(new Error('تعذر قراءة الصورة المرفقة.'));
    };
    img.src = url;
  });
}

/**
 * Compress receipt via Canvas → JPEG Base64 data URL (target ≤ 150KB string).
 */
async function compressReceiptToBase64(file) {
  var img = await loadImageFromFile(file);
  var width = img.naturalWidth || img.width;
  var height = img.naturalHeight || img.height;
  if (!width || !height) throw new Error('صورة الوصل غير صالحة.');

  var scale = 1;
  if (width > RECEIPT_MAX_DIMENSION || height > RECEIPT_MAX_DIMENSION) {
    scale = RECEIPT_MAX_DIMENSION / Math.max(width, height);
  }
  var targetW = Math.max(1, Math.round(width * scale));
  var targetH = Math.max(1, Math.round(height * scale));

  var canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  var ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('تعذر معالجة الصورة على هذا المتصفح.');
  ctx.drawImage(img, 0, 0, targetW, targetH);

  var quality = RECEIPT_JPEG_QUALITY;
  var dataUrl = canvas.toDataURL('image/jpeg', quality);
  while (dataUrl.length > MAX_RECEIPT_BASE64_LEN && quality > 0.35) {
    quality -= 0.08;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }

  if (dataUrl.length > MAX_RECEIPT_BASE64_LEN) {
    throw new Error('حجم صورة الوصل كبير جداً بعد الضغط. التقط صورة أقرب أو بإضاءة أقل.');
  }
  return dataUrl;
}

async function loadProduct(planId, courseId) {
  if (planId) {
    var planSnap = await getDoc(doc(db, 'pricing', planId));
    if (!planSnap.exists()) throw new Error('الباقة غير موجودة أو غير متاحة.');
    var plan = planSnap.data() || {};
    var amount = parsePrice(plan.price);
    if (amount <= 0) throw new Error('هذه الباقة مجانية ولا تتطلب دفعاً.');
    var instructorId = '';
    if (plan.sourceCourseId) {
      var sourceSnap = await getDoc(doc(db, 'courses', String(plan.sourceCourseId)));
      if (sourceSnap.exists()) instructorId = String((sourceSnap.data() || {}).instructorId || '').trim();
    }
    return {
      type: 'plan',
      id: planId,
      planId: planId,
      courseId: String(plan.sourceCourseId || '').trim(),
      title: String(plan.name || 'باقة تدريبية').trim(),
      description: String(plan.description || '').trim(),
      amount: amount,
      currency: String(plan.currency || 'IQD').toUpperCase(),
      period: String(plan.period || '').trim(),
      instructorId: instructorId,
    };
  }

  if (courseId) {
    var courseSnap = await getDoc(doc(db, 'courses', courseId));
    if (!courseSnap.exists()) throw new Error('الكورس غير موجود أو غير متاح.');
    var course = courseSnap.data() || {};
    if (String(course.status || '').toLowerCase() !== 'published') {
      throw new Error('هذا الكورس غير منشور حالياً.');
    }
    var courseAmount = parsePrice(course.price);
    if (courseAmount <= 0) throw new Error('هذا الكورس مجاني ولا يتطلب دفعاً.');
    return {
      type: 'course',
      id: courseId,
      planId: String(course.requiredPlanId || '').trim(),
      courseId: courseId,
      title: String(course.title || 'كورس تدريبي').trim(),
      description: String(course.description || '').trim(),
      amount: courseAmount,
      currency: String(course.currency || 'IQD').toUpperCase(),
      period: 'شراء لمرة واحدة',
      instructorId: String(course.instructorId || '').trim(),
    };
  }

  throw new Error('يرجى تحديد باقة أو كورس عبر رابط صالح (planId أو courseId).');
}

function renderAuthGate(root) {
  root.innerHTML =
    '<div class="checkout-auth-gate">' +
    '<h1 class="checkout-page__title">تسجيل الدخول مطلوب</h1>' +
    '<p>يجب تسجيل الدخول بحساب Google أو البريد الإلكتروني قبل إرسال طلب الدفع.</p>' +
    '<button type="button" class="btn btn--primary" id="checkoutLoginBtn">تسجيل الدخول</button>' +
    '<p style="margin-top:1rem;"><a href="index.html#pricing">← العودة للباقات</a></p>' +
    '</div>';

  var loginBtn = document.getElementById('checkoutLoginBtn');
  if (loginBtn) {
    loginBtn.addEventListener('click', function () {
      if (window.IFAAuth && typeof window.IFAAuth.openAuthModal === 'function') {
        window.IFAAuth.openAuthModal('login');
        return;
      }
      var slot = document.querySelector('[data-auth-slot] button, [data-auth-slot] a');
      if (slot) slot.click();
    });
  }
}

function renderCheckoutForm(root) {
  var product = state.product;
  var user = state.user;
  var payment = state.paymentConfig || toPaymentDisplayConfig(null);
  var userName =
    String(user.displayName || '').trim() ||
    (user.email ? user.email.split('@')[0] : 'مستخدم');

  root.innerHTML =
    '<header class="checkout-page__header">' +
    '<p class="checkout-page__back"><a href="index.html#pricing">← العودة للباقات</a></p>' +
    '<h1 class="checkout-page__title">إتمام الدفع اليدوي</h1>' +
    '<p class="checkout-page__subtitle">اختر طريقة الدفع، حوّل المبلغ، ثم ارفع صورة الوصل. سيتم مراجعة طلبك وتفعيل الوصول خلال أقرب وقت.</p>' +
    '</header>' +
    '<div class="checkout-layout">' +
    '<section class="checkout-card checkout-summary" aria-labelledby="checkoutSummaryTitle">' +
    '<h2 class="checkout-card__title" id="checkoutSummaryTitle">الفاتورة</h2>' +
    '<div class="checkout-summary__row"><span class="checkout-summary__label">المنتج</span><span class="checkout-summary__value">' +
    escapeHtml(product.title) +
    '</span></div>' +
    (product.description
      ? '<div class="checkout-summary__row"><span class="checkout-summary__label">الوصف</span><span class="checkout-summary__value">' +
        escapeHtml(product.description.slice(0, 80)) +
        (product.description.length > 80 ? '…' : '') +
        '</span></div>'
      : '') +
    '<div class="checkout-summary__row"><span class="checkout-summary__label">النوع</span><span class="checkout-summary__value">' +
    (product.type === 'plan' ? 'باقة' : 'كورس') +
    '</span></div>' +
    (product.period
      ? '<div class="checkout-summary__row"><span class="checkout-summary__label">المدة</span><span class="checkout-summary__value">' +
        escapeHtml(product.period) +
        '</span></div>'
      : '') +
    '<div class="checkout-summary__row"><span class="checkout-summary__label">المشتري</span><span class="checkout-summary__value">' +
    escapeHtml(userName) +
    '</span></div>' +
    '<div class="checkout-summary__row"><span class="checkout-summary__label">البريد</span><span class="checkout-summary__value">' +
    escapeHtml(user.email || '') +
    '</span></div>' +
    '<div class="checkout-summary__total"><span>المبلغ المطلوب</span><strong>' +
    escapeHtml(formatIqd(product.amount)) +
    '</strong></div>' +
    '</section>' +
    '<section class="checkout-card">' +
    '<h2 class="checkout-card__title">طريقة الدفع</h2>' +
    '<div class="checkout-methods" role="radiogroup" aria-label="طريقة الدفع">' +
    '<label class="checkout-method is-selected" data-method="zaincash">' +
    '<input type="radio" name="paymentMethod" value="zaincash" checked />' +
    '<div class="checkout-method__body">' +
    '<div class="checkout-method__name">زين كاش (ZainCash)</div>' +
    '<div class="checkout-method__hint">تحويل فوري عبر محفظة زين كاش</div>' +
    '</div></label>' +
    '<label class="checkout-method" data-method="mastercard">' +
    '<input type="radio" name="paymentMethod" value="mastercard" />' +
    '<div class="checkout-method__body">' +
    '<div class="checkout-method__name">ماستر كارد / كي كارد (Mastercard / QiCard)</div>' +
    '<div class="checkout-method__hint">تحويل يدوي إلى بطاقة أو حساب بنكي</div>' +
    '</div></label>' +
    '</div>' +
    '<div class="checkout-instructions is-visible" id="checkoutInstrZain" data-instructions="zaincash">' +
    '<strong>تعليمات زين كاش:</strong>' +
    '<ol>' +
    '<li>افتح تطبيق زين كاش على هاتفك.</li>' +
    '<li>اختر «تحويل مبلغ» وأدخل الرقم أدناه.</li>' +
    '<li>حوّل المبلغ الظاهر في الفاتورة بالضبط: <strong>' +
    escapeHtml(formatIqd(product.amount)) +
    '</strong>.</li>' +
    '<li>احفظ لقطة شاشة للوصل وارفعها في الحقل أدناه.</li>' +
    '</ol>' +
    '<div class="checkout-pay-detail" dir="ltr">' +
    escapeHtml(payment.zaincash.wallet) +
    '</div>' +
    '</div>' +
    '<div class="checkout-instructions" id="checkoutInstrCard" data-instructions="mastercard">' +
    '<strong>تعليمات ماستر كارد / كي كارد:</strong>' +
    '<ol>' +
    '<li>استخدم تطبيق البنك أو المحفظة لإجراء تحويل محلي.</li>' +
    '<li>حوّل المبلغ الظاهر في الفاتورة: <strong>' +
    escapeHtml(formatIqd(product.amount)) +
    '</strong>.</li>' +
    '<li>أدخل رقم البطاقة/الحساب أو الـ IBAN الموضّح أدناه.</li>' +
    '<li>ارفع صورة واضحة للوصل بعد إتمام التحويل.</li>' +
    '</ol>' +
    '<div class="checkout-pay-detail" dir="ltr">' +
    escapeHtml(payment.mastercard.card) +
    '</div>' +
    '<div class="checkout-pay-detail" style="margin-top:0.5rem;font-size:0.85rem;" dir="ltr">' +
    escapeHtml(payment.mastercard.iban) +
    '</div>' +
    '</div>' +
    '<form id="checkoutForm" novalidate>' +
    '<div class="checkout-field checkout-file">' +
    '<label class="checkout-field__label" for="checkoutReceipt">رفع صورة الوصل <span aria-hidden="true">*</span></label>' +
    '<input class="checkout-file__input" type="file" id="checkoutReceipt" name="receipt" accept="image/jpeg,image/png,image/webp,image/gif" required />' +
    '<label class="checkout-file__btn" for="checkoutReceipt">📷 اختيار صورة الوصل</label>' +
    '<span class="checkout-file__name" id="checkoutReceiptName">لم يتم اختيار ملف بعد</span>' +
    '<img class="checkout-file__preview" id="checkoutReceiptPreview" alt="معاينة الوصل" />' +
    '<p class="checkout-field__hint">صيغ مقبولة: JPG, PNG, WEBP, GIF — تُضغط تلقائياً قبل الإرسال</p>' +
    '</div>' +
    '<div class="checkout-error" id="checkoutError" hidden role="alert"></div>' +
    '<button type="submit" class="btn btn--primary checkout-submit" id="checkoutSubmitBtn">إرسال الطلب للمراجعة</button>' +
    '</form>' +
    '</section>' +
    '</div>';

  bindCheckoutInteractions();
}

function bindCheckoutInteractions() {
  var methods = document.querySelectorAll('.checkout-method');
  methods.forEach(function (label) {
    label.addEventListener('click', function () {
      var method = label.getAttribute('data-method') || 'zaincash';
      state.paymentMethod = method;
      methods.forEach(function (m) {
        m.classList.toggle('is-selected', m.getAttribute('data-method') === method);
      });
      document.querySelectorAll('.checkout-instructions').forEach(function (panel) {
        panel.classList.toggle('is-visible', panel.getAttribute('data-instructions') === method);
      });
      var radio = label.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
    });
  });

  var fileInput = document.getElementById('checkoutReceipt');
  var fileNameEl = document.getElementById('checkoutReceiptName');
  var previewEl = document.getElementById('checkoutReceiptPreview');
  if (fileInput) {
    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) {
        if (fileNameEl) fileNameEl.textContent = 'لم يتم اختيار ملف بعد';
        if (previewEl) {
          previewEl.classList.remove('is-visible');
          previewEl.removeAttribute('src');
        }
        return;
      }
      if (fileNameEl) fileNameEl.textContent = file.name;
      if (previewEl && file.type.indexOf('image/') === 0) {
        previewEl.src = URL.createObjectURL(file);
        previewEl.classList.add('is-visible');
      }
    });
  }

  var form = document.getElementById('checkoutForm');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      handleSubmit();
    });
  }
}

function showError(message) {
  var el = document.getElementById('checkoutError');
  if (!el) return;
  if (!message) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = message;
}

function validateReceiptFile(file) {
  if (!file) return 'يرجى رفع صورة الوصل قبل الإرسال.';
  if (file.type.indexOf('image/') !== 0) {
    return 'يرجى اختيار ملف صورة صالح (JPG, PNG, WEBP, GIF).';
  }
  if (file.size > MAX_RECEIPT_INPUT_BYTES) {
    return 'حجم الصورة كبير جداً. الحد الأقصى 8 ميجابايت قبل الضغط.';
  }
  return '';
}

async function ensureCheckoutNotificationConfig() {
  var adminEmail = state.paymentConfig && state.paymentConfig.adminEmail;
  var missingAdminEmail = !adminEmail || String(adminEmail).indexOf('@') === -1;
  var checkoutConfig = await fetchCheckoutConfig();

  if (missingAdminEmail || getMissingEmailJsKeys(checkoutConfig).length > 0) {
    state.paymentConfig = toPaymentDisplayConfig(checkoutConfig);
  }

  console.log('[Checkout] Loaded checkout_config from Firestore:', {
    adminEmail: checkoutConfig.adminEmail,
    emailjsServiceId: checkoutConfig.emailjsServiceId,
    emailjsTemplateId: checkoutConfig.emailjsTemplateId,
    emailjsPublicKeyPresent: !!checkoutConfig.emailjsPublicKey,
    emailjsPublicKeyLength: String(checkoutConfig.emailjsPublicKey || '').length,
    missingEmailJsKeys: getMissingEmailJsKeys(checkoutConfig),
  });

  return {
    adminEmail: (state.paymentConfig && state.paymentConfig.adminEmail) || checkoutConfig.adminEmail,
    checkoutConfig: checkoutConfig,
  };
}

async function recordAdminOrderNotification(orderId, product, userId) {
  var message =
    'تم استلام طلب شراء جديد لـ ' +
    String(product.title || 'منتج') +
    ' بقيمة ' +
    formatIqd(product.amount);
  try {
    await setDoc(doc(db, 'notifications', 'order_' + orderId), {
      type: 'new_order',
      title: 'طلب شراء جديد',
      body: message,
      message: message,
      orderId: orderId,
      read: false,
      active: true,
      targetAudience: 'admin',
      linkUrl: 'admin.html#orders',
      userId: userId,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error('[Checkout] Failed to record in-app admin notification for order', orderId, err);
  }
}

async function queueAdminNotification(orderId, orderPayload, adminEmail, checkoutConfig) {
  var recipient = String(adminEmail || '').trim();
  if (!recipient || recipient.indexOf('@') === -1) {
    console.error(
      '[Checkout] Admin notification skipped — adminEmail is missing or invalid.',
      'Configure a valid admin email in settings/checkout_config.',
      { orderId: orderId, adminEmail: adminEmail }
    );
    return { queued: false, sent: false, error: 'invalid_admin_email' };
  }
  return notifyAdminNewOrder(
    orderId,
    Object.assign({}, orderPayload, {
      amountLabel: formatIqd(orderPayload.amount),
    }),
    recipient,
    { checkoutConfig: checkoutConfig || null }
  );
}

function showSuccessModal() {
  var modal = document.getElementById('checkoutSuccessModal');
  if (!modal) return;
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
}

function bindSuccessModal() {
  var modal = document.getElementById('checkoutSuccessModal');
  if (!modal || modal.dataset.bound === '1') return;
  modal.dataset.bound = '1';
  modal.querySelectorAll('[data-checkout-success-close]').forEach(function (el) {
    el.addEventListener('click', function () {
      modal.hidden = true;
      modal.setAttribute('aria-hidden', 'true');
      window.location.href = 'index.html#courses';
    });
  });
}

async function handleSubmit() {
  if (state.submitting) return;
  showError('');

  var user = state.user;
  var product = state.product;
  if (!user || !product) {
    showError('جلسة غير صالحة. أعد تحميل الصفحة.');
    return;
  }

  var fileInput = document.getElementById('checkoutReceipt');
  var file = fileInput && fileInput.files ? fileInput.files[0] : null;
  var fileError = validateReceiptFile(file);
  if (fileError) {
    showError(fileError);
    return;
  }

  var methodInput = document.querySelector('input[name="paymentMethod"]:checked');
  var paymentMethod = methodInput ? methodInput.value : state.paymentMethod;
  if (paymentMethod !== 'zaincash' && paymentMethod !== 'mastercard') {
    showError('يرجى اختيار طريقة دفع صالحة.');
    return;
  }

  var submitBtn = document.getElementById('checkoutSubmitBtn');
  state.submitting = true;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'جاري الضغط والإرسال…';
  }

  var orderId = newOrderId();
  var userName = String(user.displayName || '').trim() || (user.email ? user.email.split('@')[0] : 'مستخدم');

  try {
    var receiptBase64 = await compressReceiptToBase64(file);

    var orderData = {
      userId: user.uid,
      userEmail: String(user.email || '').trim(),
      userName: userName,
      planId: state.planId || product.planId || '',
      courseId: state.courseId || product.courseId || '',
      productType: product.type,
      productTitle: product.title,
      amount: product.amount,
      currency: product.currency || 'IQD',
      paymentMethod: paymentMethod,
      receiptBase64: receiptBase64,
      status: 'pending',
      createdAt: serverTimestamp(),
    };
    if (product.instructorId) orderData.instructorId = product.instructorId;

    await setDoc(doc(db, 'orders', orderId), orderData);

    try {
      await recordAdminOrderNotification(orderId, product, user.uid);
    } catch (inAppErr) {
      console.warn(
        '[Checkout] In-app admin notification failed (order saved, continuing)',
        inAppErr
      );
    }

    var mailResult = { queued: false, sent: false, error: 'not_attempted' };
    try {
      var notificationConfig = await ensureCheckoutNotificationConfig();
      mailResult = await queueAdminNotification(
        orderId,
        {
          userId: user.uid,
          userEmail: orderData.userEmail,
          userName: userName,
          productTitle: product.title,
          amount: product.amount,
          paymentMethod: paymentMethod,
        },
        notificationConfig.adminEmail,
        notificationConfig.checkoutConfig
      );
    } catch (emailErr) {
      console.error(
        '[Checkout] Admin email notification failed (order saved, continuing)',
        emailErr
      );
    }

    if (!mailResult || mailResult.sent !== true) {
      console.warn(
        '[Checkout] Admin notification email was not sent.',
        'Order was saved successfully, but email delivery failed.',
        'Configure EmailJS in Admin → إعدادات الدفع والإشعارات',
        'or install Firebase Trigger Email Extension.',
        {
          orderId: orderId,
          queued: mailResult && mailResult.queued,
          sent: mailResult && mailResult.sent,
          notificationId: mailResult && mailResult.notificationId,
          error: mailResult && mailResult.error,
        }
      );
    }

    showSuccessModal();
    var form = document.getElementById('checkoutForm');
    if (form) form.reset();
    var previewEl = document.getElementById('checkoutReceiptPreview');
    if (previewEl) {
      previewEl.classList.remove('is-visible');
      previewEl.removeAttribute('src');
    }
    var fileNameEl = document.getElementById('checkoutReceiptName');
    if (fileNameEl) fileNameEl.textContent = 'لم يتم اختيار ملف بعد';
  } catch (err) {
    console.error('[Checkout] submit failed', err);
    showError((err && err.message) || 'تعذر إرسال الطلب. تحقق من الاتصال وحاول مرة أخرى.');
  } finally {
    state.submitting = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'إرسال الطلب للمراجعة';
    }
  }
}

function renderError(root, message) {
  root.innerHTML =
    '<div class="checkout-empty">' +
    '<h1 class="checkout-page__title">تعذر تحميل الطلب</h1>' +
    '<p>' +
    escapeHtml(message) +
    '</p>' +
    '<p style="margin-top:1.25rem;"><a class="btn btn--outline" href="index.html#pricing">العودة للباقات</a></p>' +
    '</div>';
}

async function initCheckout(user) {
  var root = document.getElementById('checkoutRoot');
  if (!root) return;

  bindSuccessModal();

  var query = readQueryParams();
  state.planId = query.planId;
  state.courseId = query.courseId;

  if (!query.planId && !query.courseId) {
    renderError(root, 'لم يتم تحديد منتج للشراء. استخدم رابطاً يحتوي على planId أو courseId.');
    return;
  }

  if (!user) {
    renderAuthGate(root);
    return;
  }

  state.user = user;

  try {
    var results = await Promise.all([
      loadProduct(query.planId, query.courseId),
      fetchCheckoutConfig(),
    ]);
    state.product = results[0];
    state.paymentConfig = toPaymentDisplayConfig(results[1]);
    renderCheckoutForm(root);
  } catch (err) {
    renderError(root, (err && err.message) || 'تعذر تحميل تفاصيل المنتج.');
  }
}

function boot() {
  onAuthStateChanged(auth, function (user) {
    initCheckout(user);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
