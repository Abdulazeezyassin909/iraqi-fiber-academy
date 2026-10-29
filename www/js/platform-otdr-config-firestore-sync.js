/**
 * Boots real-time Firestore sync for OTDR Lab toolbox config.
 */
import { startOtdrConfigFirestoreSync } from './firestore-simulators.js';

if (window.OtdrSettings) {
  startOtdrConfigFirestoreSync();
} else {
  console.warn('[platform-otdr-config-firestore-sync] OtdrSettings not loaded');
}
