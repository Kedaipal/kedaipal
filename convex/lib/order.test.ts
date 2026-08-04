import { describe, expect, test } from "vitest";
import { isCollectionGateClosed, isMockupGateClosed } from "./order";

describe("isCollectionGateClosed (86eyg0n8e)", () => {
	// The whole safety of this gate rests on it being FALSE for anything that
	// isn't a collection order — a truth table is the cheapest way to keep it
	// that way.
	const directions = [undefined, "standard", "collection"] as const;
	const stamps = [undefined, 1_785_000_000_000] as const;

	for (const deliveryDirection of directions) {
		for (const collectedAt of stamps) {
			const expected =
				deliveryDirection === "collection" && collectedAt === undefined;
			test(`direction=${deliveryDirection ?? "unset"} collectedAt=${
				collectedAt ? "set" : "unset"
			} → ${expected ? "closed" : "open"}`, () => {
				expect(isCollectionGateClosed({ deliveryDirection, collectedAt })).toBe(
					expected,
				);
			});
		}
	}

	test("is independent of the mockup gate — the two block for different reasons", () => {
		const order = {
			deliveryDirection: "collection" as const,
			collectedAt: undefined,
			mockupStatus: "approved" as const,
			mockupWaivedAt: undefined,
		};
		expect(isMockupGateClosed(order)).toBe(false);
		expect(isCollectionGateClosed(order)).toBe(true);
	});
});
