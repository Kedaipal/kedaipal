// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DeliveryAddressDisplay } from "../components/storefront/delivery-address-display";
import { MASK_PII } from "./analytics-privacy";

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
