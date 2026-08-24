import { readFileSync } from "node:fs";
import { cloudflare } from "@cloudflare/vite-plugin";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * The app version, read from `package.json` — the single source of truth
 * (86eyqgxna). Read via `fs` rather than a JSON import so this needs no
 * `resolveJsonModule` / import-attributes support in the config's own
 * type-check. Bumped by hand in the staging→main release PR; CI tags `main`
 * from this same value on deploy, so a version always maps to a commit.
 */
const APP_VERSION = (
	JSON.parse(
		readFileSync(new URL("./package.json", import.meta.url), "utf8"),
	) as { version?: string }
).version;

if (!APP_VERSION) {
	// Fail the build rather than shipping a version-less bundle: the whole point
	// is that a seller can read the number back to support, and "unknown" is
	// worse than not having the feature.
	throw new Error("package.json is missing a `version` field");
}

const config = defineConfig({
	// Inlined at build time so runtime code never imports package.json (which
	// would drag it into the client bundle). `src/lib/app-version.ts` is the
	// only reader — see its fallback note for why it guards on `typeof`.
	define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
	plugins: [
		paraglideVitePlugin({
			project: "./project.inlang",
			outdir: "./src/paraglide",
			strategy: ["cookie", "preferredLanguage", "baseLocale"],
		}),
		devtools(),
		cloudflare({ viteEnvironment: { name: "ssr" } }),
		tsconfigPaths({ projects: ["./tsconfig.json"] }),
		tailwindcss(),
		tanstackStart(),
		viteReact(),
	],
	server: {
		// Allow Cloudflare/ngrok tunnels for dev testing of WhatsApp flows that
		// require a public HTTPS URL (e.g. CTA URL buttons reject http/localhost).
		// Leading-dot prefix matches any subdomain.
		allowedHosts: [".trycloudflare.com", ".ngrok-free.app", ".ngrok.io"],
	},
});

export default config;
