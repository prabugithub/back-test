import { db } from '../config/firebase';
import { doc, setDoc, getDoc, writeBatch, deleteDoc } from 'firebase/firestore';
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
const SNAPSHOT_PREFIX = "snapshot_session_";

// Helper to remove undefined values which Firestore doesn't support
const sanitizeData = (data: any): any => {
    if (data === null || data === undefined) return null;
    if (typeof data !== 'object') return data;

    if (Array.isArray(data)) {
        return data.map(item => sanitizeData(item));
    }

    const cleaned: any = {};
    Object.keys(data).forEach(key => {
        const value = data[key];
        if (value !== undefined) {
            cleaned[key] = sanitizeData(value);
        }
    });
    return cleaned;
};

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
        const dataToSave = sanitizeData({
            ...state,
            lastUpdated: Date.now()
        });

        await setDoc(sessionRef, dataToSave);
    } catch (error) {
        console.error('Error saving session:', error);
        throw error;
    }
};

/**
 * Saves a permanent manual snapshot that won't be rotated
 */
export const saveSnapshot = async (state: SessionState, snapshotName: string) => {
    try {
        const id = `${SNAPSHOT_PREFIX}${Date.now()}`;
        const snapshotRef = doc(db, 'sessions', id);

        const dataToSave = sanitizeData({
            ...state,
            name: snapshotName,
            archivedAt: Date.now(),
            isSnapshot: true
        });
        await setDoc(snapshotRef, dataToSave);
        console.log('Manual snapshot saved:', snapshotName);
    } catch (error) {
        console.error('Error saving snapshot:', error);
        throw error;
    }
};

export const deleteSnapshot = async (snapshotId: string) => {
    try {
        if (!snapshotId.startsWith(SNAPSHOT_PREFIX)) {
            throw new Error("Invalid snapshot ID");
        }
        const snapshotRef = doc(db, 'sessions', snapshotId);
        await deleteDoc(snapshotRef);
        console.log('Snapshot deleted:', snapshotId);
    } catch (error) {
        console.error('Error deleting snapshot:', error);
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
 * Lists all manual snapshots
 */
export const listSnapshots = async (): Promise<SessionState[]> => {
    try {
        const { collection, getDocs } = await import('firebase/firestore');
        const sessCol = collection(db, 'sessions');
        const snap = await getDocs(sessCol);

        return snap.docs
            .map(d => ({ ...d.data(), id: d.id } as SessionState))
            .filter(d => d.id?.startsWith(SNAPSHOT_PREFIX))
            .sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
    } catch (error) {
        console.error('Error listing snapshots:', error);
        return [];
    }
};

/**
 * Restores a specific backup slot or snapshot
 */
export const restoreBackup = async (idOrPath?: string): Promise<SessionState | null> => {
    try {
        const sessionRef = doc(db, 'sessions', CONSTANT_SESSION_ID);
        let backupData: SessionState | null = null;

        if (idOrPath) {
            const docRef = doc(db, 'sessions', idOrPath);
            const snap = await getDoc(docRef);
            if (snap.exists()) {
                backupData = snap.data() as SessionState;
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

        const { id, archivedAt, isSnapshot, ...cleanData } = backupData as any;
        const dataToRestore = sanitizeData({
            ...cleanData,
            lastUpdated: Date.now()
        });
        await setDoc(sessionRef, dataToRestore);

        return backupData;
    } catch (error) {
        console.error('Error restoring backup:', error);
        throw error;
    }
};
