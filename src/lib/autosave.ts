/**
 * The debounced writer behind the note editor's autosave.
 *
 * Writes are keyed, so a second edit to one note replaces the first while an
 * edit to another queues behind it, and serialised, so two writes are never in
 * flight at once.
 */

export type Autosaver<T> = {
  schedule: (value: T) => void;
  /** Writes everything queued now. Resolves once the queue stops draining. */
  flush: () => Promise<void>;
  /** Forgets a queued write, for a note that is about to be deleted. */
  drop: (key: string) => void;
  cancel: () => void;
  /** True while anything is queued or in flight, including a failed write. */
  pending: () => boolean;
  /**
   * True while an edit is waiting to be written, ignoring the one in flight. A
   * write asking `pending` would always see itself.
   */
  queued: () => boolean;
};

type Options<T> = {
  /** Idle time before a queued write goes out. */
  delay: number;
  /** Longest a continuous typist waits for one. */
  maxDelay: number;
  key: (value: T) => string;
  save: (value: T) => Promise<void>;
  onError?: (error: unknown, value: T) => void;
};

export function createAutosaver<T>({
  delay,
  maxDelay,
  key,
  save,
  onError,
}: Options<T>): Autosaver<T> {
  const queued = new Map<string, T>();
  let idle: ReturnType<typeof setTimeout> | null = null;
  let cap: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;

  function clearTimers() {
    if (idle !== null) {
      clearTimeout(idle);
      idle = null;
    }
    if (cap !== null) {
      clearTimeout(cap);
      cap = null;
    }
  }

  function drain(): Promise<void> {
    if (running) return running;
    if (queued.size === 0) return Promise.resolve();
    clearTimers();
    const task = (async () => {
      // Yields once so `running` is set before the first write can observe it.
      await Promise.resolve();
      try {
        while (queued.size > 0) {
          const [id, value] = queued.entries().next().value as [string, T];
          queued.delete(id);
          try {
            await save(value);
          } catch (error) {
            onError?.(error, value);
            // Left queued for the next edit or flush rather than retried here,
            // which against an unreachable server would spin.
            if (!queued.has(id)) queued.set(id, value);
            return;
          }
        }
      } finally {
        running = null;
      }
    })();
    running = task;
    return task;
  }

  return {
    schedule(value: T) {
      queued.set(key(value), value);
      if (idle !== null) clearTimeout(idle);
      idle = setTimeout(() => {
        idle = null;
        void drain();
      }, delay);
      if (cap === null) {
        cap = setTimeout(() => {
          cap = null;
          void drain();
        }, maxDelay);
      }
    },
    async flush() {
      clearTimers();
      await drain();
    },
    drop(id: string) {
      queued.delete(id);
    },
    cancel() {
      clearTimers();
      queued.clear();
    },
    pending() {
      return queued.size > 0 || running !== null;
    },
    queued() {
      return queued.size > 0;
    },
  };
}
