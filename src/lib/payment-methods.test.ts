import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	compactMethods,
	methodsInGroup,
	PAYMENT_GROUP_ORDER,
	PAYMENT_METHODS,
} from "./payment-methods";

/**
 * Guards the landing payment strip's config array (ClickUp 86eye3p6z §G). The
 * whole point of the array is that adding a rail is a data edit — these tests
 * are what stop that edit from silently shipping a broken mark, a raster, a
 * logo with no accessible name, or a group nobody renders.
 */

const PUBLIC_DIR = join(process.cwd(), "public");

describe("landing payment-method catalogue", () => {
	it("gives every method a unique id", () => {
		const ids = PAYMENT_METHODS.map((mth) => mth.id);
		expect(new Set(ids).size, `duplicate ids in ${ids.join(", ")}`).toBe(
			ids.length,
		);
	});

	it("gives every method an accessible name", () => {
		// The name IS the alt/aria text in every locale — a blank one means a
		// screen-reader user hears nothing where a payment rail should be.
		const nameless = PAYMENT_METHODS.filter((mth) => !mth.name.trim());
		expect(nameless.map((mth) => mth.id)).toEqual([]);
	});

	it("only ever points at SVG assets that exist", () => {
		// No raster on the landing (design system), and a 404'd mark renders as
		// AppImage's error box — worse than the wordmark fallback we already have.
		const broken: string[] = [];
		for (const method of PAYMENT_METHODS) {
			if (!method.src) continue;
			if (!method.src.endsWith(".svg")) broken.push(`${method.id}: not an SVG`);
			if (!existsSync(join(PUBLIC_DIR, method.src)))
				broken.push(`${method.id}: missing ${method.src}`);
		}
		expect(broken, broken.join("\n")).toEqual([]);
	});

	it("normalises optical size wherever a mark renders", () => {
		const unsized = PAYMENT_METHODS.filter(
			(mth) => mth.visible && mth.src && !mth.markClass,
		);
		expect(unsized.map((mth) => mth.id)).toEqual([]);

		const unsizedCompact = PAYMENT_METHODS.filter(
			(mth) => mth.visible && mth.compact && mth.src && !mth.compactMarkClass,
		);
		expect(unsizedCompact.map((mth) => mth.id)).toEqual([]);
	});

	it("keeps every group renderable from PAYMENT_GROUP_ORDER", () => {
		const known = new Set(PAYMENT_GROUP_ORDER);
		const orphans = PAYMENT_METHODS.filter((mth) => !known.has(mth.group));
		expect(orphans.map((mth) => `${mth.id} → ${mth.group}`)).toEqual([]);
	});

	it("keeps the compact footer row a subset of what the page shows", () => {
		const visible = new Set(
			PAYMENT_METHODS.filter((mth) => mth.visible).map((mth) => mth.id),
		);
		const strays = compactMethods().filter((mth) => !visible.has(mth.id));
		expect(strays.map((mth) => mth.id)).toEqual([]);
	});

	it("still defers the cross-border (tourist) wallets", () => {
		// Twenty logos is noise, not trust, until a seller actually serves
		// tourists. Flipping one of these to visible is a product decision — this
		// failing is the reminder to make it deliberately.
		expect(methodsInGroup("crossborder")).toEqual([]);
	});

	it("shows the four Malaysian groups the landing promises", () => {
		for (const group of ["bank", "cards", "wallets", "bnpl"] as const) {
			expect(methodsInGroup(group).length, group).toBeGreaterThan(0);
		}
	});
});
