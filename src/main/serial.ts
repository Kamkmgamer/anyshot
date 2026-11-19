/**
 * A queue that runs tasks one at a time in call order. A failed task rejects
 * its own caller only; later tasks still run.
 */
export function serialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let chain: Promise<unknown> = Promise.resolve();
  return (task) => {
    const next = chain.then(task, task);
    chain = next.catch(() => undefined);
    return next;
  };
}
