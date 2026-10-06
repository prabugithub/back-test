import { db } from '../config/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { sanitizeData } from './firebaseSessionService';
import type { ChargesConfig } from '../utils/charges';

// Global (not per-session) — restoring an old session snapshot must not revert the rates.
const SETTINGS_DOC = doc(db, 'appSettings', 'charges');

export interface StoredChargesSettings {
  config?: Partial<ChargesConfig>;
  showCharges?: boolean;
}

export const loadChargesSettings = async (): Promise<StoredChargesSettings | null> => {
  try {
    const snap = await getDoc(SETTINGS_DOC);
    return snap.exists() ? (snap.data() as StoredChargesSettings) : null;
  } catch (error) {
    console.error('Error loading charges settings:', error);
    return null;
  }
};

export const saveChargesSettings = async (settings: StoredChargesSettings): Promise<void> => {
  try {
    await setDoc(SETTINGS_DOC, sanitizeData({ ...settings, updatedAt: Date.now() }));
  } catch (error) {
    console.error('Error saving charges settings:', error);
  }
};
