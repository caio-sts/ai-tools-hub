export interface DebouncedAnnouncer {
  announce(message: string): void;
  cancel(): void;
  flush(): void;
}

/**
 * Writes result counts into an aria-live region on a quiet-period debounce
 * so a screen reader hears one settled number, not one per keystroke.
 */
export function createDebouncedAnnouncer(
  setText: (message: string) => void,
  delayMs = 300,
): DebouncedAnnouncer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: string | null = null;

  const emit = (): void => {
    timer = null;
    if (pending === null) return;
    const message = pending;
    pending = null;
    setText(message);
  };

  return {
    announce(message: string): void {
      pending = message;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(emit, delayMs);
    },
    cancel(): void {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
    },
    flush(): void {
      if (timer !== null) clearTimeout(timer);
      emit();
    },
  };
}
