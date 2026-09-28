/**
 * Watches `.codehq/` for changes and debounces them into a single reload signal.
 *
 * The contract and package.json use Chokidar 5. This module uses its `ignored` function
 * and `awaitWriteFinish` options.
 */

import { watch, type FSWatcher } from "chokidar";
import path from "node:path";

const STABILITY_THRESHOLD_MS = 120;
const POLL_INTERVAL_MS = 20;
const DEBOUNCE_MS = 80;

export interface CodeHQWatcher {
  close(): Promise<void>;
}

export interface WatcherCallbacks {
  onChange(): void;
  onError(error: Error): void;
}

/** Ignore diagnostics.json (we write it), `*.tmp` (atomic-write staging files), and `.runtime/`. */
function isIgnoredPath(filePath: string): boolean {
  const base = path.basename(filePath);
  if (base === "diagnostics.json" || base.endsWith(".tmp")) {
    return true;
  }
  return filePath.split(path.sep).includes(".runtime");
}

/**
 * Watches `codeHQDir` (non-recursive concerns are chokidar's problem, not ours) and
 * calls `onChange` at most once per ~80ms burst, after chokidar's own `awaitWriteFinish`
 * has let a partial agent write settle for ~120ms. Watcher errors are surfaced via
 * `onError`, never swallowed.
 */
export function watchHQ(codeHQDir: string, callbacks: WatcherCallbacks): CodeHQWatcher {
  const watcher: FSWatcher = watch(codeHQDir, {
    ignoreInitial: true,
    ignored: (filePath: string) => isIgnoredPath(filePath),
    awaitWriteFinish: { stabilityThreshold: STABILITY_THRESHOLD_MS, pollInterval: POLL_INTERVAL_MS },
  });

  let debounceHandle: NodeJS.Timeout | null = null;
  const scheduleChange = (): void => {
    if (debounceHandle !== null) {
      clearTimeout(debounceHandle);
    }
    debounceHandle = setTimeout(() => {
      debounceHandle = null;
      callbacks.onChange();
    }, DEBOUNCE_MS);
  };

  watcher.on("add", scheduleChange);
  watcher.on("change", scheduleChange);
  watcher.on("unlink", scheduleChange);
  watcher.on("error", (error: unknown) => {
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
  });

  return {
    close: async (): Promise<void> => {
      if (debounceHandle !== null) {
        clearTimeout(debounceHandle);
        debounceHandle = null;
      }
      await watcher.close();
    },
  };
}

export interface SourceFileWatcher extends CodeHQWatcher {
  /** Replaces the watched set with exactly these absolute paths. */
  setFiles(absolutePaths: readonly string[]): void;
}

/**
 * Watches the individual source files that workflows reference, so a code edit can flag the
 * steps that point at it without anyone asking for a recheck. Same settle-and-debounce
 * behaviour as `watchHQ`; the watched set follows whatever the current workflows reference.
 */
export function watchSourceFiles(callbacks: WatcherCallbacks): SourceFileWatcher {
  const watcher: FSWatcher = watch([], {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: STABILITY_THRESHOLD_MS, pollInterval: POLL_INTERVAL_MS },
  });
  let watched = new Set<string>();

  let debounceHandle: NodeJS.Timeout | null = null;
  const scheduleChange = (): void => {
    if (debounceHandle !== null) {
      clearTimeout(debounceHandle);
    }
    debounceHandle = setTimeout(() => {
      debounceHandle = null;
      callbacks.onChange();
    }, DEBOUNCE_MS);
  };

  watcher.on("add", scheduleChange);
  watcher.on("change", scheduleChange);
  watcher.on("unlink", scheduleChange);
  watcher.on("error", (error: unknown) => {
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
  });

  return {
    setFiles: (absolutePaths) => {
      const next = new Set(absolutePaths);
      const added = [...next].filter((file) => !watched.has(file));
      const removed = [...watched].filter((file) => !next.has(file));
      if (removed.length > 0) {
        watcher.unwatch(removed);
      }
      if (added.length > 0) {
        watcher.add(added);
      }
      watched = next;
    },
    close: async (): Promise<void> => {
      if (debounceHandle !== null) {
        clearTimeout(debounceHandle);
        debounceHandle = null;
      }
      await watcher.close();
    },
  };
}
