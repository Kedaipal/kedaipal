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
		exclude: [...defaultExclude, "**/.claude/**"],
	},
});
