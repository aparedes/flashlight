const DEFAULT_TIMEOUT = 10000;
const DEFAULT_CHECK_INTERVAL = 50;

/**
 * Polls `evaluateResult` (sync or async) every `checkInterval` ms until it returns a truthy
 * value, which is then returned. Rejects with `errorMessage` once `timeout` ms have elapsed.
 */
export const waitFor = async <T>(
  evaluateResult: () => T | undefined | null | Promise<T | undefined | null>,
  {
    timeout = DEFAULT_TIMEOUT,
    checkInterval = DEFAULT_CHECK_INTERVAL,
    errorMessage,
  }: { timeout?: number; checkInterval?: number; errorMessage?: string } = {}
): Promise<T> => {
  let remainingTime = timeout;

  while (remainingTime >= 0) {
    const result = await evaluateResult();
    if (result) return result;

    await new Promise((resolve) => setTimeout(resolve, checkInterval));
    remainingTime -= checkInterval;
  }

  throw new Error(errorMessage ?? "Waited for condition which never happened");
};
