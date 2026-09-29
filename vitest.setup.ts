/**
 * Runs before every test file, in that file's own environment.
 *
 * Testing Library's `asyncUtilTimeout` is the budget for `waitFor` / `findBy*`.
 * Unlike vitest's `testTimeout` (see vitest.config.ts) this one is REAL
 * protection: `waitFor` is genuinely asynchronous, so the budget can interrupt
 * a promise that never settles, and it is what makes a broken async
 * expectation fail in seconds rather than at the test timeout. So it is raised
 * from 1s to 5s, not removed, and stays 6x tighter than `testTimeout`.
 *
 * This is a MARGIN fix, not a reproduced flake — stated plainly because the
 * distinction matters. Sweeping the value down until the suite breaks puts the
 * real cost at ~620ms, and it is concentrated in four tests in
 * `src/components/order/book-delivery-card.test.tsx` that wait on a real
 * product timer: `SPEND_ARM_DELAY_MS` (600ms), the anti-misclick delay that
 * arms Dispatch once a courier price lands. So the 1s default left ~400ms of
 * slack over a fixed 600ms floor.
 *
 * That slack held under every load we could manufacture (full suite green at
 * load averages 237 and 278 on 8 cores), and the reason is worth writing down:
 * the dominant term is a wall-clock `setTimeout`, which CPU starvation barely
 * stretches. Which is also why that result does NOT clear the budget — it means
 * our synthetic load UNDER-models the risk. What actually eats 400ms of slack
 * is slower hardware running the polling and re-render around the timer (CI is
 * 4 shared vCPU, not 8 fast local ones), or anyone raising
 * `SPEND_ARM_DELAY_MS`, which would silently spend the remaining slack.
 *
 * 5s is ~8x the measured cost. If you add a product delay above ~800ms,
 * re-measure rather than re-deriving the headroom by argument — that is what
 * `ASYNC_UTIL_TIMEOUT_MS` is for. See docs/ci.md.
 */
if (typeof document !== "undefined") {
	// Guarded + dynamic: most of the suite runs in `edge-runtime` (Convex
	// functions), which has no DOM and must not pay for — or trip over —
	// importing Testing Library.
	const { configure } = await import("@testing-library/react");
	configure({
		asyncUtilTimeout: Number(process.env.ASYNC_UTIL_TIMEOUT_MS ?? 5_000),
	});
}

// Top-level `await` needs this file to be a module, and the only import it has
// is the guarded dynamic one above (TS1375).
export {};
