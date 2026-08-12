// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const pkg = JSON.parse(
	readFileSync(join(__dirname, "../../package.json"), "utf8"),
) as {
	dependencies: Record<string, string>;
	devDependencies: Record<string, string>;
};

const allSpecs = Object.entries({
	...pkg.dependencies,
	...pkg.devDependencies,
});

// The TanStack router/start monorepo ships breaking rewrites as PATCH
// releases (the 4 Aug 2026 lane-scheduler rewrite landed in
// react-router@1.170.19 tagged "Fix"), so caret/tilde ranges on these
// packages are the same hazard as a dist-tag: any lockfile re-resolution
// jumps the framework untested. They stay exact-pinned; upgrades are a
// deliberate, lockstep task (86eyjadza) with a buyer-surface regression pass.
// Clerk rides the same freeze because it PEER-depends on the pinned TanStack
// family: @clerk/tanstack-react-start@1.5.0 requires react-start >=1.167.17
// while we pin 1.167.16, and pnpm installs an unmet peer with only a warning.
// A caret range here silently resolved onto exactly that during the 86eyetz94
// security bump — an auth SDK running against a framework version its own
// changelog says it needs a fix from. Upgrading Clerk past 1.4.x is therefore
// part of the lockstep TanStack task (86eyjadza), not a range that drifts.
const EXACT_PINNED = [
	"@tanstack/react-router",
	"@tanstack/react-start",
	"@tanstack/react-router-devtools",
	"@tanstack/react-devtools",
	"@tanstack/devtools-vite",
	"@tanstack/router-plugin",
	"@clerk/tanstack-react-start",
];

describe("dependency pins", () => {
	test("no dependency uses a dist-tag or wildcard specifier", () => {
		// A spec like "latest" re-resolves on any lockfile touch (pnpm add of an
		// unrelated package), silently riding a framework jump into an unrelated
		// PR. Every spec must state a concrete version.
		for (const [name, spec] of allSpecs) {
			expect(spec, `${name} must pin a version, got "${spec}"`).toMatch(
				/^[\^~]?\d/,
			);
		}
	});

	test("peer-coupled framework packages are exact-pinned", () => {
		for (const name of EXACT_PINNED) {
			const spec = pkg.dependencies[name] ?? pkg.devDependencies[name];
			expect(spec, `${name} missing from package.json`).toBeDefined();
			expect(spec, `${name} must be exact-pinned, got "${spec}"`).toMatch(
				/^\d/,
			);
		}
	});
});
