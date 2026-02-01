import { db } from '../config/firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import type { Trade, Position } from '../types';

export interface SessionState {
    id?: string; // Optional if creating new
    name: string; // "My Analysis 1"
    lastUpdated: number;

    // Configuration to re-fetch data if needed
    instrument: string;
    interval: string; // e.g., '1D', '15min'
    fromDate: string;
    toDate: string;

    // Playback state
    currentIndex: number;
    trades: Trade[];
    position: Position | null;

    // Optional: Store candles if dataset is small, otherwise re-fetch
    // Storing candles in Firestore can be expensive and hit limits (1MB document limit).
    // Better to store parameters and re-fetch from backend/local cache.
}

const CONSTANT_SESSION_ID = "current_session";
const BACKUP_SESSION_ID = "current_session_backup";

export const saveSession = async (state: SessionState) => {
    try {
        const sessionRef = doc(db, 'sessions', CONSTANT_SESSION_ID);
        const backupRef = doc(db, 'sessions', BACKUP_SESSION_ID);

        // 1. Get current data to create backup if it exists
        const currentDoc = await getDoc(sessionRef);
        if (currentDoc.exists()) {
            // Copy current to backup
            await setDoc(backupRef, currentDoc.data());
        }

        // 2. Save new state
        await setDoc(sessionRef, {
            ...state,
            lastUpdated: Date.now()
        });
        console.log('Session saved successfully (with backup)');
    } catch (error) {
        console.error('Error saving session:', error);
        throw error;
    }
};

export const loadSession = async (type: 'current' | 'backup' = 'current'): Promise<SessionState | null> => {
    try {
        const id = type === 'current' ? CONSTANT_SESSION_ID : BACKUP_SESSION_ID;
        const sessionRef = doc(db, 'sessions', id);
        const docSnap = await getDoc(sessionRef);

        if (docSnap.exists()) {
            return docSnap.data() as SessionState;
        } else {
            console.log(`No ${type} session found!`);
            return null;
        }
    } catch (error) {
        console.error(`Error loading ${type} session:`, error);
        throw error;
    }
};

export const restoreBackup = async (): Promise<SessionState | null> => {
    try {
        const sessionRef = doc(db, 'sessions', CONSTANT_SESSION_ID);
        const backupRef = doc(db, 'sessions', BACKUP_SESSION_ID);

        const backupDoc = await getDoc(backupRef);
        if (!backupDoc.exists()) {
            throw new Error('No backup version found to restore.');
        }

        const backupData = backupDoc.data();
        // Overwrite current with backup
        await setDoc(sessionRef, backupData);

        return backupData as SessionState;
    } catch (error) {
        console.error('Error restoring backup:', error);
        throw error;
    }
};
