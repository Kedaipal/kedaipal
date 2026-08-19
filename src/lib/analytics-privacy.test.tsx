// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DeliveryAddressDisplay } from "../components/storefront/delivery-address-display";
import { isTrackingTokenPath, MASK_PII } from "./analytics-privacy";

afterEach(cleanup);

const ADDRESS = {
	line1: "12 Jalan Kenanga",
	line2: "Taman Seri Indah",
	postcode: "43000",
	city: "Kajang",
	state: "Selangor",
	notes: "Leave with the guard house",
};

describe("MASK_PII", () => {
	// Clarity's default (Balanced) masks only numbers, emails, and input/select
	// contents — rendered text like a buyer's name or street is captured. This
	// attribute is what overrides that per subtree, so the exact spelling is a
	// contract with a third party, not an internal detail.
	it("is the attribute Clarity looks for", () => {
		expect(MASK_PII).toEqual({ "data-clarity-mask": "true" });
	});

	it("reaches the DOM when spread onto an element", () => {
		render(
			<div {...MASK_PII} data-testid="region">
				secret
			</div>,
		);

		expect(
			screen.getByTestId("region").getAttribute("data-clarity-mask"),
		).toBe("true");
	});
});

describe("isTrackingTokenPath", () => {
	// Shared by useClarity (refuses to boot) and useGoogleAnalytics (neither
	// initializes nor sends) — the tracking URL is the buyer's capability
	// secret, so both providers key off this single predicate.
	it("matches the tracking routes", () => {
		expect(isTrackingTokenPath("/track")).toBe(true);
		expect(isTrackingTokenPath("/track/")).toBe(true);
		expect(isTrackingTokenPath("/track/8f3c09b1a7e24d5c9b0e")).toBe(true);
	});

	it("leaves every other route alone", () => {
		expect(isTrackingTokenPath("/")).toBe(false);
		expect(isTrackingTokenPath("/tracking-guide")).toBe(false);
		expect(isTrackingTokenPath("/app/orders")).toBe(false);
		expect(isTrackingTokenPath("/k-frozen-food")).toBe(false);
	});
});

describe("PII surfaces carry the mask", () => {
	// DeliveryAddressDisplay is shared by the seller's order detail and the
	// buyer's tracking page, so this one assertion covers both call sites.
	it("masks the delivery address and its notes", () => {
		const { container } = render(<DeliveryAddressDisplay address={ADDRESS} />);

		const masked = container.querySelector('[data-clarity-mask="true"]');
		expect(masked).not.toBeNull();
		// The PII must sit *inside* the masked subtree, not merely alongside it.
		expect(masked?.textContent).toContain("12 Jalan Kenanga");
		expect(masked?.textContent).toContain("Leave with the guard house");
	});
});

describe("MASK_PII sweep coverage (86eyn25g9)", () => {
	// Lint-style guard: every file known to render buyer/staff/rider PII must
	// keep at least its audited number of `{...MASK_PII}` spreads. Rendering
	// the big route components here would need heavy router/Convex mocks, so
	// this pins the source instead — delete a mask and the count goes red.
	// A NEW surface that renders a customer's name/phone/address/notes must be
	// added to this table (and masked). See docs/analytics.md §Privacy.
	const MASKED_FILES: Array<[path: string, minSpreads: number]> = [
		["src/components/storefront/delivery-address-display.tsx", 1],
		["src/components/dashboard/customer-card.tsx", 1],
		["src/components/dashboard/customer-detail.tsx", 1],
		["src/components/dashboard/customer-list.tsx", 1],
		["src/routes/app.orders.$shortId.tsx", 5],
		["src/routes/app.orders.index.tsx", 1],
		["src/routes/app.index.tsx", 1],
		["src/routes/app.customers.$customerId.tsx", 1],
		["src/routes/app.checkout.tsx", 6],
		["src/components/order/send-order-document.tsx", 1],
		["src/components/order/book-delivery-card.tsx", 2],
		["src/components/settings/fulfilment-tab.tsx", 1],
		["src/components/storefront/checkout-form.tsx", 1],
	];

	it.each(MASKED_FILES)("%s keeps ≥%i MASK_PII spreads", (file, min) => {
		const source = readFileSync(file, "utf8");
		const spreads = source.match(/\{\.\.\.MASK_PII\}/g)?.length ?? 0;
		expect(spreads).toBeGreaterThanOrEqual(min);
	});

	// Toasts portal to document root — outside every masked subtree — so the
	// convention there is "no buyer name in toast copy", not masking. Pin the
	// two sites that used to interpolate one.
	it("keeps buyer names out of portal-rendered toast copy", () => {
		const orderDetail = readFileSync(
			"src/routes/app.orders.$shortId.tsx",
			"utf8",
		);
		const sendDoc = readFileSync(
			"src/components/order/send-order-document.tsx",
			"utf8",
		);
		expect(orderDetail).not.toContain("${who} will receive it");
		expect(sendDoc).not.toContain("resent to ${who}");
	});
});
