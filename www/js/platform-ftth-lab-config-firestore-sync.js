/**
 * Boots real-time Firestore sync for FTTH / OTDR lab toolbox config on lab pages.
 */
import { startFtthLabConfigFirestoreSync } from './firestore-simulators.js';

if (window.FtthLabSettings) {
  startFtthLabConfigFirestoreSync();
} else {
  console.warn('[platform-ftth-lab-config-firestore-sync] FtthLabSettings not loaded');
}
