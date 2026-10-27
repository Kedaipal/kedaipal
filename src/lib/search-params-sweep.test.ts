// Every route's validateSearch RETURNS every key it reads (z8r3fdtk87).
//
// TanStack merges the validator's result over the raw parsed search, so a key
// the validator reads and then leaves out of its result is not dropped: the
// raw URL value leaks into `Route.useSearch()` in whatever type the URL gave
// it (`?q=9981` → a number). That is how `/app/admin/sellers?q=9981` and the
// public `/stores?q=2024` crashed. See src/lib/search-params.ts.
//
// The sweep runs each validator against a search object that records every
// key it reads and answers each read with a hostile value (a number, a
// boolean, an array). Each key it read must then be an own property of the
// result, `undefined` or not. A new route that spreads `...(ok ? { k } : {})`
// fails here instead of in production.
import type { AnyRoute } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

/** Keys a validator may read without returning, each with the reason the raw
 * value is harmless. Adding one needs a reason a reviewer can check. */
const OPEN_BY_DESIGN: Record<string, readonly string[]> = {
	// `p` is the raw prefill token. The page only reads the DECODED `prefill`,
	// and the auth round-trip preserves the token through `location.href`, not
	// through `useSearch()`.
	"onboarding.tsx": ["p"],
};

const HOSTILE: readonly unknown[] = [9981, true, [1, 2]];

function readKeysAndResult(
	validate: (search: Record<string, unknown>) => unknown,
	value: unknown,
) {
	const read = new Set<string>();
	const search = new Proxy({} as Record<string, unknown>, {
		get(_target, key) {
			if (typeof key !== "string") return undefined;
			read.add(key);
			return value;
		},
		has(_target, key) {
			return typeof key === "string";
		},
	});
	const result = validate(search) as Record<string, unknown>;
	return { read, result };
}

const modules = import.meta.glob<{ Route?: AnyRoute }>([
	"../routes/*.tsx",
	"!../routes/*.test.tsx",
]);

describe("validateSearch closes every key it reads", async () => {
	const routes: {
		path: string;
		validate: (s: Record<string, unknown>) => unknown;
	}[] = [];
	for (const [file, load] of Object.entries(modules)) {
		const validate = (await load()).Route?.options.validateSearch;
		if (typeof validate === "function") {
			routes.push({ path: file.replace("../routes/", ""), validate });
		}
	}

	it("finds the routes that validate search (the sweep is not silently empty)", () => {
		expect(routes.length).toBeGreaterThanOrEqual(10);
	});

	for (const { path, validate } of routes) {
		it(`${path}: a key read from the URL is never left to leak`, () => {
			const open = new Set(OPEN_BY_DESIGN[path] ?? []);
			for (const value of HOSTILE) {
				const { read, result } = readKeysAndResult(validate, value);
				const leaking = [...read].filter(
					(key) => !open.has(key) && !Object.hasOwn(result, key),
				);
				expect(leaking, `with every param = ${JSON.stringify(value)}`).toEqual(
					[],
				);
			}
		});
	}
});
