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
	},
});
