// @vitest-environment jsdom
/**
 * Parcel weight is asked only of goods that SHIP (Zaki, 25 Oct 2026: "it
 * should only be for those product related, and not calendar booking
 * services kind, which has no delivery"). The form is rendered for real —
 * the pure `buildSubmitVariants` tests prove the refusal, these prove WHICH
 * products the form hands the requirement to, on a store whose couriers
 * price by weight.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

import { EMPTY_EVENT_DRAFT } from "./event-fields";
import { ProductForm } from "./product-form";

afterEach(cleanup);

type Initial = NonNullable<Parameters<typeof ProductForm>[0]["initialValues"]>;

function renderForm(initialValues: Partial<Initial>) {
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
			weightPricing="courier"
			initialValues={{ name: "Item", ...initialValues } as Initial}
		/>,
	);
}

const asked = () =>
	(document.body.textContent ?? "").includes("Your couriers price by weight");
const requiredInputs = () =>
	document.querySelectorAll(
		'input[aria-required="true"][aria-label^="Parcel weight"]',
	).length;

describe("which products are asked for a parcel weight", () => {
	it("physical goods are — promoted, required, with the courier's reason", () => {
		renderForm({ kind: "physical" });
		expect(asked()).toBe(true);
		expect(requiredInputs()).toBeGreaterThan(0);
	});

	it("a service is not — it has no parcel", () => {
		renderForm({ kind: "service" });
		expect(asked()).toBe(false);
		expect(requiredInputs()).toBe(0);
	});

	it("a calendar booking is not — nothing is delivered", () => {
		renderForm({ kind: "booking", capacityPerNight: "5" });
		expect(asked()).toBe(false);
		expect(requiredInputs()).toBe(0);
	});

	it("an event RSVP is not — guests are met at the venue", () => {
		renderForm({
			kind: "physical",
			eventDraft: { ...EMPTY_EVENT_DRAFT, on: true, date: "2026-12-01" },
		});
		expect(asked()).toBe(false);
		expect(requiredInputs()).toBe(0);
	});
});
