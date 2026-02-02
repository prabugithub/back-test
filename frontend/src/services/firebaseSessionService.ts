import { db } from '../config/firebase';
import { doc, setDoc, getDoc, writeBatch } from 'firebase/firestore';
import type { Trade, Position } from '../types';

export interface SessionState {
    id?: string;
    name: string;
    lastUpdated: number;
    archivedAt?: number; // Added for history tracking
    instrument: string;
    interval: string;
    fromDate: string;
    toDate: string;
    currentIndex: number;
    trades: Trade[];
    position: Position | null;
}

const CONSTANT_SESSION_ID = "current_session";
const HISTORY_PREFIX = "history_session_";

export const saveSession = async (state: SessionState) => {
    try {
        const sessionRef = doc(db, 'sessions', CONSTANT_SESSION_ID);

        // 1. Get current data to archive it if it exists
        const currentDoc = await getDoc(sessionRef);
        if (currentDoc.exists()) {
            const currentData = currentDoc.data();

            // Shift history: 3->4, 2->3, 1->2
            const batch = writeBatch(db);

            for (let i = 3; i >= 1; i--) {
                const oldRef = doc(db, 'sessions', `${HISTORY_PREFIX}${i}`);
                const oldDoc = await getDoc(oldRef);
                if (oldDoc.exists()) {
                    const nextRef = doc(db, 'sessions', `${HISTORY_PREFIX}${i + 1}`);
                    batch.set(nextRef, oldDoc.data());
                }
            }

            // Move current to Slot 1
            const h1Ref = doc(db, 'sessions', `${HISTORY_PREFIX}1`);
            batch.set(h1Ref, {
                ...currentData,
                archivedAt: Date.now()
            });

            await batch.commit();
        }

        // 2. Save new state to primary slot
        await setDoc(sessionRef, {
            ...state,
            lastUpdated: Date.now()
        });
        console.log('Session saved successfully (Flat history rotation)');
    } catch (error) {
        console.error('Error saving session:', error);
        throw error;
    }
};

export const loadSession = async (): Promise<SessionState | null> => {
    try {
        const sessionRef = doc(db, 'sessions', CONSTANT_SESSION_ID);
        const docSnap = await getDoc(sessionRef);

        if (docSnap.exists()) {
            return docSnap.data() as SessionState;
        }
        return null;
    } catch (error) {
        console.error(`Error loading session:`, error);
        throw error;
    }
};

/**
 * Lists available backups from flat history slots
 */
export const listHistory = async (): Promise<SessionState[]> => {
    try {
        const history: SessionState[] = [];
        for (let i = 1; i <= 4; i++) {
            const hRef = doc(db, 'sessions', `${HISTORY_PREFIX}${i}`);
            const hSnap = await getDoc(hRef);
            if (hSnap.exists()) {
                history.push({
                    ...hSnap.data(),
                    id: `${HISTORY_PREFIX}${i}`
                } as SessionState);
            }
        }
        // Sort by archivedAt descending
        return history.sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
    } catch (error) {
        console.error('Error listing history:', error);
        return [];
    }
};

/**
 * Restores a specific backup slot
 */
export const restoreBackup = async (historyId?: string): Promise<SessionState | null> => {
    try {
        const sessionRef = doc(db, 'sessions', CONSTANT_SESSION_ID);
        let backupData: SessionState | null = null;

        if (historyId) {
            const historyDocRef = doc(db, 'sessions', historyId);
            const historySnap = await getDoc(historyDocRef);
            if (historySnap.exists()) {
                backupData = historySnap.data() as SessionState;
            }
        } else {
            const history = await listHistory();
            if (history.length > 0) {
                backupData = history[0];
            }
        }

        if (!backupData) {
            throw new Error('No backup version found to restore.');
        }

        const { id, archivedAt, ...cleanData } = backupData as any;
        await setDoc(sessionRef, {
            ...cleanData,
            lastUpdated: Date.now()
        });

        return backupData;
    } catch (error) {
        console.error('Error restoring backup:', error);
        throw error;
    }
};
