// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * The dashboard shell's main column must be able to SHRINK.
 *
 * It sits beside the sidebar in a flex row, and a flex item's default
 * `min-width: auto` refuses to go below its content's min-content width. Any
 * page wider than the space left over — the orders TABLE with a few extra
 * columns switched on — therefore pushed the whole shell past the viewport:
 * the page scrolled sideways and the toolbar's right-hand controls (Columns,
 * Export CSV) went off screen. Found by driving the table at 1281px with the
 * sidebar expanded during the z8r3fdff97 test round; `min-w-0` on the column
 * took `document.scrollingElement.scrollWidth` from 1392 back to 1281 and
 * handed the scrolling back to the table's own `overflow-x-auto` box.
 *
 * jsdom does no layout, so the rule is pinned where it is expressible: the
 * class stays on both shell columns (the real one and the loading skeleton,
 * which must lay out identically). House precedent for a scan-the-source gate:
 * `src/lib/convex-read-pattern.test.ts`.
 */
// Lives in lib/, not routes/: every file in `src/routes` is a ROUTE, and the
// reserved-slug gate reads the directory as the store namespace.
const SHELL = readFileSync(join(__dirname, "..", "routes", "app.tsx"), "utf8");

/** The flex column that holds every dashboard page, and its skeleton twin. */
const COLUMN_RE = /className="mx-auto flex w-full[^"]*flex-1 flex-col[^"]*"/g;

describe("dashboard shell — the main column shrinks with the window", () => {
	test("both shell columns carry min-w-0", () => {
		const columns = SHELL.match(COLUMN_RE) ?? [];
		// The loaded shell and the pending skeleton.
		expect(columns).toHaveLength(2);
		for (const cls of columns) {
			expect(cls).toMatch(/\bmin-w-0\b/);
		}
	});
});
