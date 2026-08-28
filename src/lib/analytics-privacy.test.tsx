// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DeliveryAddressDisplay } from "../components/storefront/delivery-address-display";
import { isCapabilityTokenPath, MASK_PII } from "./analytics-privacy";

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

describe("isCapabilityTokenPath", () => {
	// Shared by useClarity (refuses to boot) and useGoogleAnalytics (neither
	// initializes nor sends) — the URL is the buyer's capability secret, so
	// both providers key off this single predicate.
	it("matches the tracking routes", () => {
		expect(isCapabilityTokenPath("/track")).toBe(true);
		expect(isCapabilityTokenPath("/track/")).toBe(true);
		expect(isCapabilityTokenPath("/track/8f3c09b1a7e24d5c9b0e")).toBe(true);
	});

	// The claim token is the STRONGER capability of the two: it reads the
	// buyer's name/phone and can commit an order that decrements stock. It
	// shipped excluded from Clerk but not from analytics (PR #227 review).
	it("matches the claim routes", () => {
		expect(isCapabilityTokenPath("/claim")).toBe(true);
		expect(isCapabilityTokenPath("/claim/")).toBe(true);
		expect(isCapabilityTokenPath("/claim/8f3c09b1a7e24d5c9b0e")).toBe(true);
	});

	it("leaves every other route alone", () => {
		expect(isCapabilityTokenPath("/")).toBe(false);
		expect(isCapabilityTokenPath("/tracking-guide")).toBe(false);
		expect(isCapabilityTokenPath("/app/orders")).toBe(false);
		expect(isCapabilityTokenPath("/k-frozen-food")).toBe(false);
		// A store slug that merely STARTS with a guarded word is a normal
		// storefront page — the prefix match must not swallow it.
		expect(isCapabilityTokenPath("/claim-your-free-kuih")).toBe(false);
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
		["src/components/order/order-document-actions.tsx", 1],
		["src/components/order/book-delivery-card.tsx", 2],
		["src/components/settings/fulfilment-tab.tsx", 1],
		["src/components/storefront/checkout-form.tsx", 1],
		// Claim links (86eyq0epn). The BUYER-facing two shipped unmasked (PR #227
		// review): with Clarity booting on /claim, Balanced mode records every
		// rendered string verbatim, so the buyer's name and phone landed in
		// session replays.
		["src/routes/claim.$token.tsx", 1],
		["src/components/claim/claim-checkout-page.tsx", 1],
		["src/components/claim/send-claim.tsx", 2],
		["src/components/claim/waiting-on-buyer.tsx", 2],
	];

	it.each(MASKED_FILES)("%s keeps ≥%i MASK_PII spreads", (file, min) => {
		const source = readFileSync(file, "utf8");
		const spreads = source.match(/\{\.\.\.MASK_PII\}/g)?.length ?? 0;
		expect(spreads).toBeGreaterThanOrEqual(min);
	});

	/**
	 * The text of every `toast.…(…)` call in a source file, paren-matched so a
	 * multi-line call (title + `description`) is captured whole.
	 */
	function toastCalls(source: string): string[] {
		const calls: string[] = [];
		const opener = /toast\.\w+\(/g;
		let match = opener.exec(source);
		while (match !== null) {
			let depth = 1;
			let i = match.index + match[0].length;
			while (i < source.length && depth > 0) {
				if (source[i] === "(") depth++;
				else if (source[i] === ")") depth--;
				i++;
			}
			calls.push(source.slice(match.index, i));
			match = opener.exec(source);
		}
		return calls;
	}

	// Toasts portal to the document root — outside every masked subtree — so the
	// convention there is "no buyer name in toast copy", not masking. Asserted
	// against the shape of the call rather than two literal strings: the two
	// sites that originally interpolated a name were both deleted by 86eyd63r8
	// (one message per order), and a guard pinned to deleted text passes for the
	// wrong reason. This one still goes red if a future toast reaches for the
	// buyer's name.
	const TOAST_FILES = [
		"src/routes/app.orders.$shortId.tsx",
		"src/components/order/order-document-actions.tsx",
		"src/routes/app.checkout.tsx",
	];
	const BUYER_NAME_INTERPOLATIONS = [
		"${who}",
		"${buyerName}",
		"${customerName}",
	];

	it.each(TOAST_FILES)(
		"%s keeps buyer names out of portal-rendered toast copy",
		(file) => {
			for (const call of toastCalls(readFileSync(file, "utf8"))) {
				for (const token of BUYER_NAME_INTERPOLATIONS) {
					expect(call).not.toContain(token);
				}
			}
		},
	);
});
