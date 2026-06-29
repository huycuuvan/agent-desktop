export interface RunGuard<T> {
  runOrSkip: () => Promise<T | null>;
  isRunning: () => boolean;
}

export function createRunGuard<T>(run: () => Promise<T>): RunGuard<T> {
  let running = false;

  return {
    isRunning: () => running,
    runOrSkip: async (): Promise<T | null> => {
      if (running) {
        return null;
      }

      running = true;
      try {
        return await run();
      } finally {
        running = false;
      }
    },
  };
}
