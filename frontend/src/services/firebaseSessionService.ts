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

const CONSTANT_SESSION_ID = "current_session"; // For now, single session for simplicity

export const saveSession = async (state: SessionState) => {
    try {
        const sessionRef = doc(db, 'sessions', CONSTANT_SESSION_ID);
        await setDoc(sessionRef, {
            ...state,
            lastUpdated: Date.now()
        });
        console.log('Session saved successfully');
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
        } else {
            console.log('No such session!');
            return null;
        }
    } catch (error) {
        console.error('Error loading session:', error);
        throw error;
    }
};
