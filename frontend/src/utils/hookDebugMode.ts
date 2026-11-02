/**
 * Whether the batch backtest runs on the MAIN THREAD instead of the Web Worker.
 *
 * The worker is the right default for a 20 000-bar sweep, but it makes a custom entry hook
 * effectively undebuggable: the hook executes on the worker thread, so a breakpoint or
 * `debugger` inside it never pauses the main-thread devtools. This flag is how you develop a
 * strategy — turn it on, debug normally, turn it off when the strategy is stable.
 *
 * Deliberately stored on its own localStorage key rather than anywhere else that exists:
 *
 *   - NOT in AutoBacktestConfig — that object is persisted per saved configuration and
 *     re-applied by presets, so a debugging preference would travel with a shared strategy.
 *   - NOT in the session's uiSettings — those sync to Firestore (firebaseSessionService).
 *
 * It is a property of "this browser, while I am working", which is exactly what
 * localStorage is for.
 */
const STORAGE_KEY = 'bt.hookDebugMode';

/** `?debugHook` in the URL forces it on for one session, without touching the stored value. */
function urlOverride(): boolean {
  try {
    return typeof window !== 'undefined'
      && new URLSearchParams(window.location.search).has('debugHook');
  } catch {
    return false;
  }
}

export function getHookDebugMode(): boolean {
  if (urlOverride()) return true;
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // Private mode / storage disabled — the feature degrades to "worker only", never throws.
    return false;
  }
}

export function setHookDebugMode(on: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (on) localStorage.setItem(STORAGE_KEY, '1');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore — the in-memory store field still reflects the choice for this session.
  }
}

/** True when the URL forced it on, so the UI can explain why the toggle looks stuck. */
export function isHookDebugForcedByUrl(): boolean {
  return urlOverride();
}
