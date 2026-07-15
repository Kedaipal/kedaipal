/**
 * Minimal awaited retry-with-backoff for transactional sends that can't use the
 * durable action-retrier component (ordered multi-message sequences and
 * throw-driven fallbacks need `await`-with-throw semantics — the component is
 * fire-and-forget). Kept free of Convex imports so it unit-tests in isolation.
 */

export type InlineRetryPolicy = {
	/** Total attempts including the first (attempts: 3 = 1 try + 2 retries). */
	attempts: number;
	initialBackoffMs: number;
	base: number;
};

/** Sleep injectable for tests. */
const defaultSleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`, retrying on throw with exponential backoff. Rethrows the last
 * error once attempts are exhausted, so callers' catch/fallback behaviour is
 * exactly what it would be for a single failed call — just later.
 */
export async function withInlineRetries<T>(
	fn: () => Promise<T>,
	policy: InlineRetryPolicy,
	sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<T> {
	let lastErr: unknown;
	for (let attempt = 0; attempt < policy.attempts; attempt++) {
		if (attempt > 0) {
			await sleep(policy.initialBackoffMs * policy.base ** (attempt - 1));
		}
		try {
			return await fn();
		} catch (err) {
			lastErr = err;
		}
	}
	throw lastErr;
}
