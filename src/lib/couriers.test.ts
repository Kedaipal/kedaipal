import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COUNTRIES } from "../../convex/lib/country";
import {
	COURIER_GROUP_ORDER,
	COURIERS,
	couriersFor,
	hasParcelCouriers,
	mockQuotes,
} from "./couriers";

/**
 * Guards the landing courier catalogue (z8r3fdegej). Same posture as
 * `payment-methods.test.ts`: the array exists so a courier is a data edit, and
 * these tests stop that edit from shipping a broken mark, a raster, a nameless
 * chip, or a region with nothing to show.
 */

const PUBLIC_DIR = join(process.cwd(), "public");

describe("landing courier catalogue", () => {
	it("gives every courier a unique id and a name", () => {
		const ids = COURIERS.map((c) => c.id);
		expect(new Set(ids).size, `duplicate ids in ${ids.join(", ")}`).toBe(ids.length);
		expect(COURIERS.filter((c) => !c.name.trim()).map((c) => c.id)).toEqual([]);
	});

	it("keys every row to a supported country", () => {
		for (const c of COURIERS) expect(COUNTRIES).toContain(c.country);
	});

	it("only ever points at SVG marks that exist", () => {
		const broken: string[] = [];
		for (const c of COURIERS) {
			if (!c.src) continue;
			if (!c.src.endsWith(".svg")) broken.push(`${c.id}: not an SVG`);
			if (!existsSync(join(PUBLIC_DIR, c.src))) broken.push(`${c.id}: missing ${c.src}`);
			if (!c.markClass) broken.push(`${c.id}: mark without markClass`);
		}
		expect(broken, broken.join("\n")).toEqual([]);
	});

	it("rejects a raster wearing an .svg extension", () => {
		for (const c of COURIERS) {
			if (!c.src) continue;
			const svg = readFileSync(join(PUBLIC_DIR, c.src), "utf8");
			expect(svg, `${c.id} embeds a raster`).not.toMatch(/<image\b|data:image\/(png|jpe?g|webp);base64/i);
		}
	});

	it("keeps Malaysia's parcel, cold-chain and rider groups each non-empty", () => {
		for (const group of COURIER_GROUP_ORDER) {
			expect(
				couriersFor("MY").filter((c) => c.group === group).length,
				`MY has no visible ${group} courier`,
			).toBeGreaterThan(0);
		}
	});

	it("marks the two cold-chain lanes the ticket names", () => {
		const cold = couriersFor("MY").filter((c) => c.group === "cold").map((c) => c.name);
		expect(cold).toContain("Ninja Cold");
		expect(cold).toContain("Chill Freshbox");
	});

	it("orders groups parcel → cold → sameday for the rail", () => {
		const groups = couriersFor("MY").map((c) => c.group);
		const firstIndex = (g: string) => groups.indexOf(g as never);
		expect(firstIndex("parcel")).toBeLessThan(firstIndex("cold"));
		expect(firstIndex("cold")).toBeLessThan(firstIndex("sameday"));
	});

	it("never shows Singapore a Delyva courier that is not enabled yet", () => {
		// The SG tenant had no service providers on 3 Sep 2026; a parcel row
		// becomes visible only once Delyva confirms it (docs/delivery-delyva.md).
		expect(hasParcelCouriers("SG")).toBe(false);
		expect(couriersFor("SG").map((c) => c.name)).toEqual(["Lalamove"]);
	});

	it("gives the quote mock three cheapest-first rows for Malaysia", () => {
		const rows = mockQuotes("MY");
		expect(rows).toHaveLength(3);
		expect(rows[0].name).toBe("J&T Express");
		const quotes = rows.map((r) => r.mockQuote);
		expect(quotes).toEqual([...quotes].sort((a, b) => a - b));
	});

	it("still quotes something for Singapore while parcels are pending", () => {
		expect(mockQuotes("SG").length).toBeGreaterThan(0);
	});
});
