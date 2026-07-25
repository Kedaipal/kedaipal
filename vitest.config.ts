import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "edge-runtime",
		// Claude Code nests full repo worktrees under .claude/worktrees/ — without
		// this, a run from the main checkout collects every worktree's test suite.
		exclude: [...configDefaults.exclude, "**/.claude/**"],
		server: { deps: { inline: ["convex-test"] } },
	},
});
