/**
 * Firestore mail queue (Trigger Email Extension format) + optional EmailJS fallback.
 */
import { db } from './firebase-config.js';
import {
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  fetchCheckoutConfig,
  isEmailJsConfigured,
  getEmailDeliveryWarning,
  getMissingEmailJsKeys,
  logEmailJsConfigStatus,
} from './checkout-config.js';

var emailDeliveryWarningShown = false;

export var STUDENT_APPROVAL_EMAILJS = {
  serviceId: 'service_8mp116m',
  templateId: 'template_b6ozru',
};

function normalizeRecipients(value) {
  if (Array.isArray(value)) {
    return value.map(function (e) {
      return String(e || '').trim();
    }).filter(function (e) {
      return e.indexOf('@') !== -1;
    });
  }
  var single = String(value || '').trim();
  return single.indexOf('@') !== -1 ? [single] : [];
}

export function buildTriggerEmailPayload(to, subject, html) {
  return {
    to: normalizeRecipients(to),
    message: {
      subject: String(subject || '').trim(),
      html: String(html || '').trim(),
    },
  };
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function paragraphHtml(text) {
  return '<p style="font-family:Tahoma,Arial,sans-serif;line-height:1.7;color:#1e293b;">' +
    escapeHtml(text).replace(/\n/g, '<br>') +
    '</p>';
}

export function buildOrderAdminAlertHtml(orderId, payload) {
  var methodLabel = payload.paymentMethod === 'zaincash' ? 'زين كاش' : 'ماستر كارد / كي كارد';
  return (
    '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;">' +
    '<h2 style="color:#0ea5e9;">طلب دفع جديد بانتظار المراجعة</h2>' +
    paragraphHtml(
      'رقم الطلب: ' + orderId +
        '\nالمنتج: ' + (payload.productTitle || '') +
        '\nالمبلغ: ' + (payload.amountLabel || payload.amount) +
        '\nطريقة الدفع: ' + methodLabel +
        '\nالطالب: ' + (payload.userName || '') + ' <' + (payload.userEmail || '') + '>' +
        '\nراجع الوصل من لوحة الإدارة → طلبات الشراء.'
    ) +
    '</div>'
  );
}

export function buildStudentStatusHtml(status, order, customMessage) {
  var approved = status === 'approved';
  var title = approved ? 'تم قبول طلبك' : 'تم رفض طلبك';
  var intro = approved
    ? 'تم تفعيل وصولك للمحتوى المرتبط بطلبك. يمكنك الآن متابعة التعلم من المنصة.'
    : 'نعتذر، لم يتم قبول طلب الدفع الحالي. يمكنك مراجعة الوصل وإعادة المحاولة.';
  var note = customMessage ? '\n\nملاحظة من الإدارة:\n' + customMessage : '';
  return (
    '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;">' +
    '<h2 style="color:' + (approved ? '#16a34a' : '#dc2626') + ';">' + escapeHtml(title) + '</h2>' +
    paragraphHtml(
      'المنتج: ' + (order.productTitle || '') +
        '\nالمبلغ: ' + (order.amountLabel || order.amount || '') +
        '\n\n' + intro + note
    ) +
    '<p><a href="https://iraqi-fiber-academy.web.app/index.html#courses" style="color:#0ea5e9;">الذهاب إلى الكورسات</a></p>' +
    '</div>'
  );
}

function notifyEmailDeliveryUnconfigured(message) {
  if (!message) return;
  console.warn('[MailNotifications] ' + message);
  try {
    window.dispatchEvent(
      new CustomEvent('ifa:mail-delivery-unconfigured', {
        detail: { message: message },
      })
    );
    document.dispatchEvent(
      new CustomEvent('ifa:mail-delivery-unconfigured', {
        detail: { message: message },
      })
    );
  } catch (err) {
    /* ignore */
  }
}

export function buildStudentApprovalTemplateParams(order) {
  var target = order || {};
  var studentEmail =
    target.userEmail || target.email || target.customerEmail || target.user_email || '';
  var studentName = target.userName || target.name || target.customerName || 'Student';
  var orderId = target.id || target.orderId || '';
  return {
    to_email: String(studentEmail).trim(),
    to_name: String(studentName).trim(),
    order_id: String(orderId).trim(),
  };
}

function buildEmailJsTemplateParams(recipient, subject, html, orderPayload) {
  var payload = orderPayload && typeof orderPayload === 'object' ? orderPayload : {};
  var studentEmail = String(payload.userEmail || '').trim();
  return {
    to_email: String(recipient || '').trim(),
    admin_email: String(recipient || '').trim(),
    user_email: studentEmail,
    user_name: String(payload.userName || '').trim(),
    product_title: String(payload.productTitle || '').trim(),
    amount: String(payload.amountLabel || payload.amount || '').trim(),
    payment_method: String(payload.paymentMethod || '').trim(),
    subject: String(subject || '').trim(),
    message_html: String(html || '').trim(),
    reply_to: studentEmail || String(recipient || '').trim(),
  };
}

export async function tryEmailJsDispatch(to, subject, html, config, orderPayload, dispatchOptions) {
  dispatchOptions = dispatchOptions && typeof dispatchOptions === 'object' ? dispatchOptions : {};
  var isStrictDispatch = dispatchOptions.strict === true;
  var resolvedConfig = config || (await fetchCheckoutConfig());
  var publicKey = String(resolvedConfig.emailjsPublicKey || '').trim();
  var serviceId = isStrictDispatch
    ? String(dispatchOptions.serviceId || '').trim()
    : String(dispatchOptions.serviceId || resolvedConfig.emailjsServiceId || '').trim();
  var templateId = isStrictDispatch
    ? String(dispatchOptions.templateId || '').trim()
    : String(dispatchOptions.templateId || resolvedConfig.emailjsTemplateId || '').trim();
  var usingCustomTemplate = isStrictDispatch || !!(dispatchOptions.serviceId || dispatchOptions.templateId);
  var missingKeys = [];

  if (!publicKey) missingKeys.push('emailjsPublicKey');
  if (!serviceId) missingKeys.push(usingCustomTemplate ? 'serviceId' : 'emailjsServiceId');
  if (!templateId) missingKeys.push(usingCustomTemplate ? 'templateId' : 'emailjsTemplateId');

  if (missingKeys.length) {
    if (!usingCustomTemplate) {
      logEmailJsConfigStatus(resolvedConfig);
    }
    missingKeys.forEach(function (key) {
      console.error('[MailNotifications] EmailJS missing key:', key);
    });
    var unconfiguredMsg = usingCustomTemplate
      ? 'EmailJS public key is missing in settings/checkout_config.'
      : getEmailDeliveryWarning(resolvedConfig);
    console.error('[MailNotifications] EmailJS not configured:', unconfiguredMsg);
    notifyEmailDeliveryUnconfigured(unconfiguredMsg);
    return { sent: false, error: 'emailjs_not_configured: ' + missingKeys.join(', ') };
  }

  var templateParams = null;
  var recipient = '';

  if (isStrictDispatch) {
    if (!dispatchOptions.templateParams || typeof dispatchOptions.templateParams !== 'object') {
      console.error('[MailNotifications] Strict EmailJS dispatch requires templateParams');
      return { sent: false, error: 'missing_template_params' };
    }
    templateParams = dispatchOptions.templateParams;
    recipient = normalizeRecipients(templateParams.to_email || to)[0];
  } else {
    recipient = normalizeRecipients(to)[0];
    if (!recipient) {
      console.error('[MailNotifications] EmailJS skipped — no valid recipient for:', to);
      return { sent: false, error: 'invalid_recipient' };
    }
    templateParams =
      dispatchOptions.templateParams && typeof dispatchOptions.templateParams === 'object'
        ? dispatchOptions.templateParams
        : buildEmailJsTemplateParams(recipient, subject, html, orderPayload);
  }

  if (!recipient) {
    console.error('[MailNotifications] EmailJS skipped — no valid recipient for:', to);
    return { sent: false, error: 'invalid_recipient' };
  }

  console.log('[EmailJS] Preparing send:', {
    strict: isStrictDispatch,
    serviceId: serviceId,
    templateId: templateId,
    to_email: isStrictDispatch ? templateParams.to_email : recipient,
    templateParams: isStrictDispatch ? templateParams : undefined,
    subject: subject,
    publicKeyConfigured: !!publicKey,
    publicKeyLength: publicKey.length,
  });

  try {
    var response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lib_version: '3.2.0',
        user_id: publicKey,
        service_id: serviceId,
        template_id: templateId,
        template_params: templateParams,
      }),
    });
    if (!response.ok) {
      var responseText = await response.text();
      var errorBody = responseText;
      try {
        errorBody = JSON.parse(responseText);
      } catch (parseErr) {
        /* keep raw text */
      }
      console.error('[EmailJS Error]', errorBody);
      var apiError =
        'EmailJS API HTTP ' + response.status + ' ' + response.statusText + ': ' + responseText;
      console.error(
        '[MailNotifications] EmailJS API error — HTTP ' +
          response.status +
          ' ' +
          response.statusText +
          '\nResponse body: ' +
          responseText +
          '\nTemplate params: ' +
          JSON.stringify(templateParams)
      );
      return { sent: false, error: apiError };
    }
    console.log('[EmailJS] Send succeeded');
    return { sent: true, error: null };
  } catch (err) {
    console.error('[EmailJS] Runtime error:', err);
    console.error('[MailNotifications] EmailJS dispatch exception:', err);
    return { sent: false, error: String((err && err.message) || err) };
  }
}

/**
 * Queue email for Firebase Trigger Email + optional EmailJS fallback.
 */
export async function queueMailNotification(notificationId, to, subject, html, meta) {
  var recipients = normalizeRecipients(to);
  if (!recipients.length) {
    console.warn('[MailNotifications] skipped — no valid recipient');
    return { queued: false, sent: false, notificationId: notificationId, error: 'no_recipient' };
  }

  var triggerPayload = buildTriggerEmailPayload(recipients, subject, html);
  var docPayload = Object.assign(
    {
      type: (meta && meta.type) || 'generic',
      status: 'pending',
      orderId: (meta && meta.orderId) || '',
      userId: (meta && meta.userId) || '',
      createdAt: serverTimestamp(),
    },
    triggerPayload,
    meta && meta.extra ? meta.extra : {}
  );

  var queued = false;
  try {
    await setDoc(doc(db, 'mail_notifications', notificationId), docPayload, { merge: true });
    queued = true;
  } catch (queueErr) {
    console.error(
      '[MailNotifications] Firestore queue write failed — will still attempt EmailJS',
      queueErr
    );
  }

  var config = (meta && meta.checkoutConfig) || (await fetchCheckoutConfig());
  var emailJsConfigured = isEmailJsConfigured(config);
  var orderPayload = meta && meta.orderPayload ? meta.orderPayload : null;
  var dispatchOptions = meta && meta.emailJsDispatch ? meta.emailJsDispatch : null;
  var dispatchResult = await tryEmailJsDispatch(
    recipients,
    subject,
    html,
    config,
    orderPayload,
    dispatchOptions
  );
  var sent = !!(dispatchResult && dispatchResult.sent);
  var deliveryError = dispatchResult && dispatchResult.error ? dispatchResult.error : null;
  var deliveryChannel = sent ? 'emailjs' : emailJsConfigured ? 'emailjs' : 'queue_only';
  var deliveryStatus = sent ? 'sent' : 'failed';

  console.log('[MailNotifications] Dispatch result:', {
    notificationId: notificationId,
    queued: queued,
    sent: sent,
    emailJsConfigured: emailJsConfigured,
    deliveryChannel: deliveryChannel,
    deliveryStatus: deliveryStatus,
    deliveryError: deliveryError,
  });

  if (queued) {
    try {
      await updateDoc(doc(db, 'mail_notifications', notificationId), {
        deliveryChannel: deliveryChannel,
        deliveryStatus: deliveryStatus,
        deliveredAt: serverTimestamp(),
        deliveryError: deliveryError || null,
      });
    } catch (err) {
      console.error('[MailNotifications] Failed to update delivery metadata for', notificationId, err);
    }
  }

  if (!sent) {
    var warning = getEmailDeliveryWarning(config);
    var deliveryMsg =
      (deliveryError || warning || 'EmailJS dispatch failed.') +
      (queued
        ? ' Message queued in mail_notifications (' + notificationId + ') pending server/extension delivery.'
        : ' Firestore queue was unavailable; only direct EmailJS was attempted.');
    console.error('[MailNotifications] Delivery failed:', deliveryMsg);
    if (!emailDeliveryWarningShown) {
      emailDeliveryWarningShown = true;
      notifyEmailDeliveryUnconfigured(deliveryMsg);
    }
  }

  return {
    queued: queued,
    sent: sent,
    notificationId: notificationId,
    emailJsConfigured: emailJsConfigured,
    deliveryChannel: deliveryChannel,
    deliveryStatus: deliveryStatus,
    error: deliveryError,
  };
}

export async function notifyAdminNewOrder(orderId, orderPayload, adminEmail, options) {
  options = options || {};
  var subject =
    '[طلب دفع جديد] ' + (orderPayload.productTitle || 'طلب') + ' — ' + (orderPayload.amountLabel || '');
  var html = buildOrderAdminAlertHtml(orderId, orderPayload);
  return queueMailNotification('mail_admin_' + orderId, adminEmail, subject, html, {
    type: 'order_pending',
    orderId: orderId,
    userId: orderPayload.userId,
    orderPayload: orderPayload,
    checkoutConfig: options.checkoutConfig || null,
  });
}

/**
 * Direct EmailJS-only student welcome email — no Firestore mail_notifications write.
 */
export async function dispatchStudentApprovalEmail(order, options) {
  options = options || {};
  var templateParams = buildStudentApprovalTemplateParams(order);
  if (!templateParams.to_email) {
    console.error('[MailNotifications] Student approval email skipped — no student email on order', order);
    return { queued: false, sent: false, error: 'no_student_email' };
  }

  var orderId = String(order.id || order.orderId || '').trim();
  console.log('[EmailJS] Student welcome approval send:', {
    serviceId: STUDENT_APPROVAL_EMAILJS.serviceId,
    templateId: STUDENT_APPROVAL_EMAILJS.templateId,
    to_email: templateParams.to_email,
    to_name: templateParams.to_name,
    order_id: templateParams.order_id,
  });

  var config = options.checkoutConfig || (await fetchCheckoutConfig());
  var dispatchResult = await tryEmailJsDispatch(
    templateParams.to_email,
    '',
    '',
    config,
    order,
    {
      strict: true,
      serviceId: STUDENT_APPROVAL_EMAILJS.serviceId,
      templateId: STUDENT_APPROVAL_EMAILJS.templateId,
      templateParams: templateParams,
    }
  );

  var sent = !!(dispatchResult && dispatchResult.sent);
  console.log('[MailNotifications] Student approval EmailJS result:', {
    orderId: orderId,
    sent: sent,
    error: dispatchResult && dispatchResult.error,
  });

  return {
    queued: false,
    sent: sent,
    notificationId: orderId ? 'emailjs_student_' + orderId : '',
    deliveryChannel: 'emailjs',
    deliveryStatus: sent ? 'sent' : 'failed',
    error: dispatchResult && dispatchResult.error,
  };
}

export async function notifyStudentOrderApproved(order, customMessage) {
  return dispatchStudentApprovalEmail(order, {});
}

export async function notifyStudentOrderStatus(order, status, customMessage) {
  if (!order || !order.userEmail) return { queued: false, sent: false, error: 'no_student_email' };
  if (status === 'approved') {
    return notifyStudentOrderApproved(order, customMessage);
  }
  var subject = 'تحديث حالة طلبك - مسار المهندس ‎°360';
  var html = buildStudentStatusHtml(status, order, customMessage);
  return queueMailNotification('mail_student_' + order.id + '_rejected', order.userEmail, subject, html, {
    type: 'order_rejected',
    orderId: order.id,
    userId: order.userId,
    orderPayload: order,
    extra: { adminNote: String(customMessage || '') },
  });
}
