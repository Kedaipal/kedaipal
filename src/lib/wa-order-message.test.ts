import { describe, expect, test } from "vitest";
import { formatFulfilmentDate } from "../../convex/lib/fulfilmentDate";
import { formatPrice } from "./format";
import { buildOrderWaMessage, waOrderUrl } from "./wa-order-message";

const baseOrder = {
	shortId: "ORD-1234",
	storeName: "Kek Lisa",
	items: [
		{ name: "Burnt Cheesecake", variantLabel: "1kg", price: 8000, quantity: 1 },
		{ name: "Brownies", price: 1500, quantity: 2 },
	],
	currency: "MYR",
	total: 11000,
};

describe("buildOrderWaMessage", () => {
	test("delivery order with address, maps pin and note", () => {
		const msg = buildOrderWaMessage({
			...baseOrder,
			deliveryMethod: "delivery",
			deliveryAddress: {
				line1: "12 Jalan Mawar",
				line2: "Taman Melati",
				city: "Kuala Lumpur",
				state: "WP Kuala Lumpur",
				postcode: "53100",
				notes: "Guard house drop",
				latitude: 3.2,
				longitude: 101.7,
			},
			customerNote: "Less sugar please",
		});
		expect(msg).toContain("Hi Kek Lisa, I'd like to place this order:");
		expect(msg).toContain("Order: ORD-1234");
		expect(msg).toContain("• 1x Burnt Cheesecake (1kg)");
		expect(msg).toContain("• 2x Brownies");
		expect(msg).toContain(`Total: ${formatPrice(11000, "MYR")}`);
		expect(msg).toContain(
			"🚚 Deliver to: 12 Jalan Mawar, Taman Melati, 53100 Kuala Lumpur, WP Kuala Lumpur",
		);
		expect(msg).toContain("📍 https://www.google.com/maps/search/");
		expect(msg).toContain("📝 Guard house drop");
		expect(msg).toContain("📝 Note for seller:\nLess sugar please");
		// The parseable order ref must come before the free-text note.
		expect(msg.indexOf("Order: ORD-1234")).toBeLessThan(
			msg.indexOf("Note for seller"),
		);
	});

	test("self-collect order with snapshot, schedule and pickup fee", () => {
		const msg = buildOrderWaMessage({
			...baseOrder,
			total: 11500,
			pickupFee: 500,
			deliveryMethod: "self_collect",
			pickupSnapshot: {
				label: "Pasar Malam TTDI",
				address: "Lorong Rahim Kajai 14",
				locationType: "drop_off",
				scheduleNote: "Every Sat 3-5pm",
			},
			fulfilmentDate: Date.UTC(2026, 6, 25) - 8 * 60 * 60 * 1000,
		});
		expect(msg).toContain(`Pickup fee: ${formatPrice(500, "MYR")}`);
		expect(msg).toContain(`Total: ${formatPrice(11500, "MYR")}`);
		expect(msg).toContain("📍 Drop-off at: Pasar Malam TTDI");
		expect(msg).toContain("Lorong Rahim Kajai 14");
		expect(msg).toContain("🗓️ Every Sat 3-5pm");
		expect(msg).toContain(
			`🗓️ Collect on: ${formatFulfilmentDate(Date.UTC(2026, 6, 25) - 8 * 60 * 60 * 1000)}`,
		);
	});

	test("delivery order with a resolved charge shows the fee line, total is final", () => {
		const msg = buildOrderWaMessage({
			...baseOrder,
			// total already includes the resolved delivery fee (server-computed).
			total: 11500,
			deliveryFee: 500,
			deliveryMethod: "delivery",
			deliveryAddress: {
				line1: "12 Jalan Mawar",
				city: "Kuala Lumpur",
				state: "WP Kuala Lumpur",
				postcode: "53100",
			},
		});
		expect(msg).toContain(`Delivery fee: ${formatPrice(500, "MYR")}`);
		expect(msg).toContain(`Total: ${formatPrice(11500, "MYR")}`);
		// A resolved fee is final — no provisional caveat.
		expect(msg).not.toContain("+ delivery");
		expect(msg).not.toContain("Delivery charge to be confirmed by seller");
	});

	test("arrange-later delivery flags the total as provisional", () => {
		const msg = buildOrderWaMessage({
			...baseOrder,
			// No fee baked into the total yet — the seller confirms it after checkout.
			deliveryFeePending: true,
			deliveryMethod: "delivery",
			deliveryAddress: {
				line1: "12 Jalan Mawar",
				city: "Kuala Lumpur",
				state: "WP Kuala Lumpur",
				postcode: "53100",
			},
		});
		expect(msg).toContain(`Total: ${formatPrice(11000, "MYR")} + delivery`);
		expect(msg).toContain("(Delivery charge to be confirmed by seller)");
		// Nothing to itemise while the charge is still unknown.
		expect(msg).not.toContain("Delivery fee:");
	});

	test("self-collect without snapshot falls back to a plain pickup line", () => {
		const msg = buildOrderWaMessage({
			...baseOrder,
			deliveryMethod: "self_collect",
		});
		expect(msg).toContain("📍 Pickup");
	});

	test("price-0 lines read as quotes only while the quote is pending", () => {
		const withQuote = {
			...baseOrder,
			items: [
				{ name: "Custom Cake", variantLabel: "Custom", price: 0, quantity: 1 },
			],
			total: 0,
		};
		const pending = buildOrderWaMessage({ ...withQuote, quotePending: true });
		expect(pending).toContain("• 1x Custom Cake (Custom) — price on quote");
		expect(pending).toContain("(Custom item price to be confirmed by seller)");

		const settled = buildOrderWaMessage({ ...withQuote, quotePending: false });
		expect(settled).toContain("• 1x Custom Cake (Custom)");
		expect(settled).not.toContain("price on quote");
	});

	test("undefined delivery method defaults to a plain delivery line", () => {
		const msg = buildOrderWaMessage(baseOrder);
		expect(msg).toContain("🚚 Delivery");
	});
});

describe("waOrderUrl", () => {
	test("builds a wa.me link with the message URL-encoded", () => {
		const url = waOrderUrl("60123456789", "Hi there\nOrder: ORD-1");
		expect(url).toBe(
			`https://wa.me/60123456789?text=${encodeURIComponent("Hi there\nOrder: ORD-1")}`,
		);
	});
});
