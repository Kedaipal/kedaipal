// @vitest-environment jsdom
/**
 * The second hop of a product-page spotlight: `/app/products/<id>?spot=`
 * hands the key to the form, which scrolls to the question row that key
 * names, opens it and rings it (z8r3fdv1z2: the weekend rate is its own
 * "Do weekend nights cost more?" row). Pins that the ring lands on that row
 * of a stay listing, that it is the brand mint, that the row opens so the
 * field is in view, that the scroll actually fires, and that a form with no
 * such row (a physical product) is a no-op.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("convex/react", () => ({
	useMutation: () => vi.fn(),
}));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: undefined, isPending: true }),
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		children,
		...rest
	}: {
		to: string;
		children: React.ReactNode;
	}) => (
		<a href={to} {...rest}>
			{children}
		</a>
	),
}));

import { SPOTLIGHT_ANCHOR } from "../../lib/spotlight";
import { ProductForm } from "./product-form";

const scrollIntoView = vi.fn();

beforeEach(() => {
	scrollIntoView.mockClear();
	Element.prototype.scrollIntoView = scrollIntoView;
	// The form defers the scroll one frame so the card exists; run it now.
	vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
		cb(0);
		return 1;
	});
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function renderForm({
	kind,
	spotlight,
}: {
	kind: "booking" | "physical";
	spotlight?: "weekend_rate";
}) {
	return render(
		<ProductForm
			retailerId={"r1" as never}
			categoriesLocked={false}
			eventsLocked={false}
			promoLocked={false}
			currency="MYR"
			submitLabel="Save"
			onSubmit={vi.fn()}
			mode="edit"
			spotlight={spotlight}
			initialValues={{
				name: "Campsite",
				kind,
				capacityPerNight: kind === "booking" ? "5" : undefined,
			}}
		/>,
	);
}

const anchor = SPOTLIGHT_ANCHOR.weekend_rate.anchor;

describe("ProductForm — ?spot= spotlight", () => {
	it("rings and opens the weekend-rate row of a stay listing, and scrolls to it", () => {
		renderForm({ kind: "booking", spotlight: "weekend_rate" });
		const row = document.getElementById(anchor);
		expect(row, `no element with id ${anchor}`).not.toBeNull();
		const cls = row?.className ?? "";
		expect(cls).toMatch(/ring-accent/);
		expect(cls).toMatch(/animate-kp-spotlight/);
		expect(cls).not.toMatch(/destructive|amber/);
		expect(row?.textContent).toContain("Do weekend nights cost more?");
		// Opened, so the seller lands on the field rather than a closed row.
		expect(row?.querySelector("button")?.getAttribute("aria-expanded")).toBe(
			"true",
		);
		expect(
			document.getElementById("booking-weekend")?.closest("[hidden]"),
		).toBeNull();
		expect(scrollIntoView).toHaveBeenCalledTimes(1);
	});

	it("without a spotlight the row stays plain and collapsed, and nothing scrolls", () => {
		renderForm({ kind: "booking" });
		const row = document.getElementById(anchor);
		expect(row).not.toBeNull();
		expect(row?.className).not.toMatch(/ring-accent|animate-kp-spotlight/);
		expect(row?.querySelector("button")?.getAttribute("aria-expanded")).toBe(
			"false",
		);
		expect(scrollIntoView).not.toHaveBeenCalled();
	});

	it("is a no-op on a form that has no such card (a physical product)", () => {
		// The list never forwards the key to a physical row, but a hand-typed
		// URL can — nothing to ring, so nothing rings and nothing throws.
		renderForm({ kind: "physical", spotlight: "weekend_rate" });
		expect(document.getElementById(anchor)).toBeNull();
		expect(scrollIntoView).not.toHaveBeenCalled();
	});
});
