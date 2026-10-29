/**
 * Firebase Storage helpers for CMS media uploads.
 * Deploy rules: firebase deploy --only storage
 */
import { storage } from './firebase-config.js';
import {
  ref,
  uploadBytes,
  getDownloadURL,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';

/**
 * Returns true when the value is a base64 data URL (must not be stored in Firestore).
 * @param {string} url
 * @returns {boolean}
 */
export function rejectDataUrl(url) {
  return /^data:/i.test(String(url == null ? '' : url).trim());
}

/**
 * Upload a file to Firebase Storage under the cms/ prefix.
 * @param {string} path - Storage path, e.g. cms/articles/art-123/cover.jpg
 * @param {File|Blob} file
 * @returns {Promise<string>} Public download URL
 */
export async function uploadCmsFile(path, file) {
  var key = String(path || '').trim().replace(/^\/+/, '');
  if (!key) {
    throw new Error('مسار التخزين غير صالح.');
  }
  if (!key.startsWith('cms/')) {
    throw new Error('مسار التخزين يجب أن يبدأ بـ cms/.');
  }
  if (!file) {
    throw new Error('لم يتم اختيار ملف للرفع.');
  }

  var storageRef = ref(storage, key);
  var snapshot = await uploadBytes(storageRef, file);
  return getDownloadURL(snapshot.ref);
}
