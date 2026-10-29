/**
 * Boots real-time Firestore sync for Fusion Splicer toolbox config.
 */
import { startSplicerConfigFirestoreSync } from './firestore-simulators.js';

if (window.FusionSplicerSettings) {
  startSplicerConfigFirestoreSync();
} else {
  console.warn('[platform-splicer-config-firestore-sync] FusionSplicerSettings not loaded');
}
