// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MissingWeightsNotice } from "./missing-weights-notice";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		params: _params,
		...props
	}: Record<string, unknown> & { to?: string; params?: unknown }) => (
		<a href={to} {...props} />
	),
}));

afterEach(cleanup);

const missing = {
	count: 3,
	choiceCount: 7,
	named: [
		{ productId: "p1" as never, name: "Oversized Tee" },
		{ productId: "p2" as never, name: "Cap" },
	],
};

/**
 * The readiness notice (23 Oct 2026) — one control for Settings and the
 * Products list, with the fix as its primary affordance.
 */
describe("MissingWeightsNotice", () => {
	it("names the products, counts the rest, and links the bulk fill with the choice count", () => {
		const { container } = render(
			<MissingWeightsNotice missingWeights={missing} reason="courier" />,
		);
		expect(container.textContent).toContain("3 products have no parcel weight");
		expect(screen.getByRole("link", { name: "Oversized Tee" })).toBeTruthy();
		expect(container.textContent).toContain("+1 more");
		const fix = screen.getByRole("link", { name: /set parcel weights/i });
		expect(fix.getAttribute("href")).toBe("/app/products/weights");
		expect(fix.textContent).toContain("7 choices");
	});

	it("the consequence follows the reason — a courier quotes the floor, a rate card can't price", () => {
		const courier = render(
			<MissingWeightsNotice missingWeights={missing} reason="courier" />,
		);
		expect(courier.container.textContent).toContain("1 kg parcel");
		expect(courier.container.textContent).not.toContain("can't be priced");
		cleanup();
		const rateCard = render(
			<MissingWeightsNotice missingWeights={missing} reason="rate_card" />,
		);
		expect(rateCard.container.textContent).toContain("can't be priced");
		expect(rateCard.container.textContent).not.toContain("1 kg");
	});

	it("renders nothing while unknown or when every product is weighed", () => {
		const unknown = render(
			<MissingWeightsNotice missingWeights={undefined} reason="courier" />,
		);
		expect(unknown.container.textContent).toBe("");
		cleanup();
		const none = render(
			<MissingWeightsNotice
				missingWeights={{ count: 0, choiceCount: 0, named: [] }}
				reason="courier"
			/>,
		);
		expect(none.container.textContent).toBe("");
	});
});
