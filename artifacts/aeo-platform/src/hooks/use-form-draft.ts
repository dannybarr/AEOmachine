import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Recoverable browser drafts for consequential forms.
 *
 * PostgreSQL stays the source of truth for submitted business data — this hook
 * only protects *unfinished* work from refreshes and accidental closes. Drafts
 * are cleared after a confirmed server save or an explicit discard.
 */

const PREFIX = "aeo-draft:";

function storageKey(key: string) {
  return `${PREFIX}${key}`;
}

export function readDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeDraft<T>(key: string, value: T) {
  try {
    localStorage.setItem(storageKey(key), JSON.stringify(value));
  } catch {
    // Storage full/unavailable — drafts are best-effort protection only.
  }
}

export function clearDraft(key: string) {
  try {
    localStorage.removeItem(storageKey(key));
  } catch {
    // ignore
  }
}

interface UseFormDraftOptions<T> {
  /** Unique per form + owning entity, e.g. `deploy-idea:12`. */
  key: string;
  /** Current form values to protect. */
  value: T;
  /** True while the form is visible/being edited (e.g. dialog open). */
  active: boolean;
  /** Skip saving when the form is empty/pristine. */
  isEmpty: (value: T) => boolean;
}

/**
 * Persists `value` to localStorage (debounced) while `active`, and reports
 * whether a previously saved draft exists so the caller can offer recovery.
 */
export function useFormDraft<T>({ key, value, active, isEmpty }: UseFormDraftOptions<T>) {
  const [recoveredDraft, setRecoveredDraft] = useState<T | null>(null);
  const skipNextSave = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest active-form value plus whether any edit is awaiting a write.
  const latestRef = useRef<{ value: T; dirty: boolean } | null>(null);
  // Set by clearAfterSave/discardDraft so no flush resurrects a cleared draft.
  const clearedRef = useRef(false);
  const isEmptyRef = useRef(isEmpty);
  isEmptyRef.current = isEmpty;

  // Flush writes always target the key of the editing session that produced
  // the value: the key is passed in from the effect closure, never read from
  // a render-updated ref. Otherwise switching owners (e.g. company A → B)
  // could write A's pending edits under B's key.
  const flushNow = useCallback((flushKey: string) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const latest = latestRef.current;
    if (!latest || !latest.dirty || clearedRef.current) return;
    latest.dirty = false;
    if (isEmptyRef.current(latest.value)) clearDraft(flushKey);
    else writeDraft(flushKey, latest.value);
  }, []);

  // Look for an existing draft when the form becomes active.
  useEffect(() => {
    if (!active) {
      setRecoveredDraft(null);
      return;
    }
    skipNextSave.current = true;
    clearedRef.current = false;
    latestRef.current = null;
    setRecoveredDraft(readDraft<T>(key));
  }, [active, key]);

  // Debounced save while editing. Deactivation (dialog close, unmount) and
  // page unload flush the latest edit synchronously instead of dropping it.
  useEffect(() => {
    if (!active) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      // Track the seeded value but do not persist it: nothing was edited yet.
      latestRef.current = { value, dirty: false };
      return;
    }
    latestRef.current = { value, dirty: true };
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flushNow(key);
    }, 400);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key, JSON.stringify(value)]);

  // Flush when the form deactivates (dialog closed, component unmounted) or
  // the key changes (e.g. switching companies), targeting the *previous* key.
  useEffect(() => {
    if (!active) return;
    return () => flushNow(key);
  }, [active, key, flushNow]);

  // Flush on page unload/refresh so the newest keystrokes are protected.
  useEffect(() => {
    if (!active) return;
    const onPageHide = () => flushNow(key);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onPageHide);
    };
  }, [active, key, flushNow]);

  // Clearing must also cancel any pending write and block later flushes,
  // or a stale draft would be re-written right after a confirmed save or
  // explicit discard.
  const cancelPendingWrite = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    clearedRef.current = true;
    if (latestRef.current) latestRef.current.dirty = false;
    skipNextSave.current = true;
  }, []);

  const discardDraft = useCallback(() => {
    cancelPendingWrite();
    clearDraft(key);
    setRecoveredDraft(null);
  }, [key, cancelPendingWrite]);

  /** Call after a confirmed server save. */
  const clearAfterSave = useCallback(() => {
    cancelPendingWrite();
    clearDraft(key);
    setRecoveredDraft(null);
  }, [key, cancelPendingWrite]);

  const consumeRecovered = useCallback(() => {
    const d = recoveredDraft;
    setRecoveredDraft(null);
    return d;
  }, [recoveredDraft]);

  return { recoveredDraft, consumeRecovered, discardDraft, clearAfterSave };
}
