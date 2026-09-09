import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Pins the production env-var wiring in `.github/workflows/deploy.yml`.
 *
 * The failure this guards against is SILENT: the workflow enumerates every
 * variable it forwards, so a `VITE_` var missing from the Build step's `env:`
 * block is simply blank in the bundle, and a Convex var missing from the
 * `CONVEX_ENV_VARS` array never reaches the deployment. The deploy goes green
 * and the feature no-ops. That happened to the server-side GA4 key events
 * (z8r3fdd1v1 shipped with neither var wired) and was caught only while
 * wiring PostHog (86eyrayux). Adding a repo variable is necessary but not
 * sufficient — this test is the "not sufficient" half made loud.
 *
 * Keep the lists below in step with the runtime readers: `clientEnv` in
 * `src/lib/env.ts` for the browser, and `process.env.*` in `convex/` for the
 * backend. A var read at runtime but absent here is exactly the bug.
 */
const deployYml = readFileSync(
	fileURLToPath(new URL("../../.github/workflows/deploy.yml", import.meta.url)),
	"utf8",
);

/** `VITE_` vars the app reads that MUST be baked into the production bundle. */
const REQUIRED_BUILD_VARS = [
	"VITE_CONVEX_URL",
	"VITE_CLERK_PUBLISHABLE_KEY",
	"VITE_GA_MEASUREMENT_ID",
	"VITE_CLARITY_PROJECT_ID",
	"VITE_POSTHOG_KEY",
] as const;

/** Convex runtime vars that MUST be synced to the production deployment. */
const REQUIRED_CONVEX_VARS = [
	"POSTHOG_PROJECT_KEY",
	"GA4_MEASUREMENT_ID",
	"GA4_MP_API_SECRET",
] as const;

/** Vars that are genuinely secret and must never be read from `vars.*`. */
const MUST_BE_SECRETS = ["GA4_MP_API_SECRET", "RESEND_API_KEY"] as const;

function buildStepEnv(): string {
	const start = deployYml.indexOf("- name: Build");
	const end = deployYml.indexOf("- name: Deploy to Cloudflare Workers");
	if (start === -1 || end === -1) throw new Error("Build step not found");
	return deployYml.slice(start, end);
}

function convexEnvVarsArray(): string {
	const match = deployYml.match(/CONVEX_ENV_VARS=\((.*)\)/);
	if (!match) throw new Error("CONVEX_ENV_VARS array not found");
	return match[1];
}

describe("deploy.yml forwards every production env var", () => {
	it.each(REQUIRED_BUILD_VARS)(
		"passes %s to the Build step so Vite bakes it into the bundle",
		(name) => {
			expect(buildStepEnv()).toMatch(
				new RegExp(`^\\s+${name}: \\$\\{\\{ vars\\.${name} \\}\\}$`, "m"),
			);
		},
	);

	it.each(REQUIRED_CONVEX_VARS)(
		"lists %s in CONVEX_ENV_VARS so the sync step pushes it",
		(name) => {
			expect(convexEnvVarsArray()).toContain(`"${name}"`);
		},
	);

	it.each(REQUIRED_CONVEX_VARS)(
		"maps %s from a GitHub value in the sync step env block",
		(name) => {
			expect(deployYml).toMatch(
				new RegExp(`^\\s+${name}: \\$\\{\\{ (vars|secrets)\\.${name} \\}\\}$`, "m"),
			);
		},
	);

	// Reading a secret from `vars.*` would work in CI and leak the value in
	// the workflow's environment listing. The distinction is the point.
	it.each(MUST_BE_SECRETS)("reads %s from secrets, never vars", (name) => {
		expect(deployYml).toMatch(
			new RegExp(`${name}: \\$\\{\\{ secrets\\.${name} \\}\\}`),
		);
		expect(deployYml).not.toMatch(
			new RegExp(`${name}: \\$\\{\\{ vars\\.${name} \\}\\}`),
		);
	});
});
