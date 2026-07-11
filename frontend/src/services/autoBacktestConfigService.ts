import { db } from '../config/firebase';
import { doc, setDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';
import type { AutoBacktestConfig } from '../utils/autoBacktestEngine';
import { sanitizeData } from './firebaseSessionService';

export interface SavedAutoBacktestConfig {
    id: string;
    name: string;
    config: AutoBacktestConfig;
    createdAt: number;
    updatedAt: number;
}

const COLLECTION = 'autoBacktestConfigs';
const ID_PREFIX = 'autobt_config_';

export const saveAutoBacktestConfigAs = async (
    name: string,
    config: AutoBacktestConfig
): Promise<SavedAutoBacktestConfig> => {
    const id = `${ID_PREFIX}${Date.now()}`;
    const now = Date.now();
    const saved: SavedAutoBacktestConfig = { id, name, config, createdAt: now, updatedAt: now };
    await setDoc(doc(db, COLLECTION, id), sanitizeData({ name, config, createdAt: now, updatedAt: now }));
    return saved;
};

export const updateAutoBacktestConfig = async (
    id: string,
    config: AutoBacktestConfig,
    name?: string
): Promise<void> => {
    const patch: any = sanitizeData({ config, updatedAt: Date.now() });
    if (name !== undefined) patch.name = name;
    await setDoc(doc(db, COLLECTION, id), patch, { merge: true });
};

export const listAutoBacktestConfigs = async (): Promise<SavedAutoBacktestConfig[]> => {
    try {
        const snap = await getDocs(collection(db, COLLECTION));
        return snap.docs
            .map(d => ({ ...(d.data() as any), id: d.id } as SavedAutoBacktestConfig))
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    } catch (error) {
        console.error('Error listing auto-backtest configs:', error);
        return [];
    }
};

export const deleteAutoBacktestConfig = async (id: string): Promise<void> => {
    await deleteDoc(doc(db, COLLECTION, id));
};
