import { defaultExclude, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "edge-runtime",
		server: { deps: { inline: ["convex-test"] } },
		// Claude Code's legacy worktrees live INSIDE the repo (`.claude/worktrees/`,
		// gitignored) and hold full checkouts of older branches. Without this,
		// vitest collects THEIR test files as if they were ours, so `pnpm gate`
		// fails in the main checkout on code that isn't on this branch — the same
		// class of bug `biome.json`'s `**/.claude/**` exclusion already fixed for
		// lint (Biome runs with `useIgnoreFile: false`, and vitest likewise doesn't
		// read .gitignore).
		//
		// KEEP THIS even though `.claude/worktrees/` is empty today (cleared
		// 2026-08-24, ClickUp 86eyqgy05). It is preventative, not dead config: the
		// directory regenerates the moment anyone uses `EnterWorktree`, and the
		// resulting phantom failures come from code that isn't on your branch —
		// confusing enough that it cost two debugging sessions to diagnose the
		// first time. Task work belongs in a SIBLING worktree (`../kedaipal-wt-<id>`
		// off `origin/staging`), never inside the repo. See docs/ci.md.
		exclude: [...defaultExclude, "**/.claude/**"],

		// A jsdom component test is SYNCHRONOUS, so the per-test timeout cannot
		// protect it — it can only misfire. `withTimeout` (@vitest/runner) sets
		// the timer BEFORE calling the test body; a synchronous body then blocks
		// the event loop, so the timer never fires, and on return `resolve()`
		// clears it and instead asserts `Date.now() - startTime < timeout`. The
		// check is therefore a post-hoc wall-clock measurement: it can neither
		// interrupt a hang nor fail before the body finishes. Its ONLY possible
		// effect on a synchronous test is to turn "the machine was busy" into
		// "the test failed".
		//
		// At the 5s default that bit: rendering `CheckoutPage` once in jsdom
		// costs ~9ms and a `getByRole({ name })` lookup ~20ms, so an ordinary
		// component test sits at 100–700ms — under 8x machine load it crosses
		// 5s and CI goes red on green code. Reproduced on `origin/staging`:
		// `checkout-form.test.tsx` and `booking-checkout-form.test.tsx` both
		// failed with "Test timed out in 5000ms" under load, passing the same
		// commit on an idle box. `ubuntu-latest` gives 4 shared vCPU, so this
		// is a CI risk, not just a local-parallel-sessions one.
		//
		// 30s is ~40x the heaviest synchronous component test we have. The real
		// backstop for something genuinely stuck stays `timeout-minutes: 10` on
		// the CI job, and an async test that never settles still fails fast on
		// Testing Library's own 1s `waitFor` budget, which this does not touch.
		// See docs/ci.md.
		testTimeout: 30_000,

		// Testing Library's own `waitFor` budget is raised alongside it, for the
		// same reason but NOT to the same value — that one is real protection and
		// has to keep failing fast. See vitest.setup.ts.
		setupFiles: ["./vitest.setup.ts"],
	},
});
