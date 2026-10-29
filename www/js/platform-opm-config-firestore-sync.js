/**
 * Boots real-time Firestore sync for Optical Power Meter toolbox config on lab pages.
 */
import { startOpmConfigFirestoreSync } from './firestore-simulators.js';

if (window.OpmSettings) {
  startOpmConfigFirestoreSync();
} else {
  console.warn('[platform-opm-config-firestore-sync] OpmSettings not loaded');
}
