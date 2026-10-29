/**
 * Firebase app + Auth + Firestore (ES module).
 * Engineer Path °360 — Email/Password + Google Sign-In & subscriber profiles.
 * Enable Email/Password in Firebase Console → Authentication → Sign-in method.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCA_FPwBFwbuQrwBgiT88Uu5HzxZA_7UDY',
  authDomain: 'iraqi-fiber-academy.firebaseapp.com',
  projectId: 'iraqi-fiber-academy',
  storageBucket: 'iraqi-fiber-academy.firebasestorage.app',
  messagingSenderId: '679037485945',
  appId: '1:679037485945:web:ae91390e54e2fcbc6ae5a8',
  measurementId: 'G-VQGHF0KJFL',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});
export const storage = getStorage(app);
