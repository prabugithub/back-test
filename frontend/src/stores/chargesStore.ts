import { create } from 'zustand';
import { DEFAULT_FUTURES_CHARGES, normalizeChargesConfig, type ChargesConfig } from '../utils/charges';
import { loadChargesSettings, saveChargesSettings } from '../services/chargesSettingsService';

/**
 * Trading-charge rates + the "Show charges" toggle.
 *
 * Deliberately a standalone store, not part of sessionStore:
 *   - NOT in the session's uiSettings — rates are global; restoring an old session
 *     snapshot must not roll them back.
 *   - NOT in AutoBacktestConfig — that travels with saved strategy configs.
 *
 * Persistence: localStorage for an instant, synchronous first paint, plus a Firestore
 * doc (appSettings/charges) so the rates follow the user across browsers. Firestore
 * wins when both exist (hydrateChargesSettings, called once from App).
 */
const STORAGE_KEY = 'bt.charges';
const SAVE_DEBOUNCE_MS = 800;

interface ChargesState {
  config: ChargesConfig;
  showCharges: boolean;
  setConfig: (patch: Partial<ChargesConfig>) => void;
  resetToDefaults: () => void;
  setShowCharges: (on: boolean) => void;
}

function readLocal(): { config: ChargesConfig; showCharges: boolean } {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      return { config: normalizeChargesConfig(parsed?.config), showCharges: parsed?.showCharges === true };
    }
  } catch {
    // Storage disabled / corrupt value — fall through to defaults.
  }
  return { config: { ...DEFAULT_FUTURES_CHARGES }, showCharges: false };
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function persist(config: ChargesConfig, showCharges: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ config, showCharges }));
  } catch {
    // Ignore — in-memory state still reflects the change for this session.
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void saveChargesSettings({ config, showCharges }); }, SAVE_DEBOUNCE_MS);
}

export const useChargesStore = create<ChargesState>((set, get) => ({
  ...readLocal(),
  setConfig: (patch) => {
    const config = normalizeChargesConfig({ ...get().config, ...patch });
    set({ config });
    persist(config, get().showCharges);
  },
  resetToDefaults: () => {
    const config = { ...DEFAULT_FUTURES_CHARGES };
    set({ config });
    persist(config, get().showCharges);
  },
  setShowCharges: (on) => {
    set({ showCharges: on });
    persist(get().config, on);
  },
}));

let hydrated = false;

/** Pulls the Firestore copy once per page load; it overrides the localStorage cache. */
export async function hydrateChargesSettings(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  const remote = await loadChargesSettings();
  if (!remote) return;
  const config = normalizeChargesConfig(remote.config);
  const showCharges = remote.showCharges === true;
  useChargesStore.setState({ config, showCharges });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ config, showCharges }));
  } catch { /* ignore */ }
}
