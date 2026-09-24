// @vitest-environment jsdom
/**
 * The Minimum notice row owns ONE control: a whole number of days.
 *
 * Regression cover for 9a935d7, which replaced both `<span>days</span>`
 * suffixes in this file with the booking package's months/days `<select>`.
 * The second one landed on Minimum notice, where it wrote `packageUnit` —
 * so a seller met a unit picker that was dropped on save for a normal
 * product (and on a booking listing quietly re-scaled the package length
 * they had priced). Huff & Puff read it as "I can't save hours, it keeps
 * going back to days".
 *
 * These assertions pin the shape, not the wiring: a unit `<select>` may
 * exist exactly where a unit is a real, saved field, and nowhere else.
 */
import { cleanup, render, screen } from "@testing-library/react";
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

import { ProductForm } from "./product-form";

afterEach(cleanup);

function renderForm(
	kind: "booking" | "physical",
	booking: {
		packageLength?: string;
		packageUnit?: "day" | "night" | "month";
	} = {},
) {
	return render(
		<ProductForm
			retailerId={"r1" as never}
			categoriesLocked={false}
			eventsLocked={false}
			currency="MYR"
			submitLabel="Save"
			onSubmit={vi.fn()}
			mode="edit"
			initialValues={{
				name: "Ice Cream Puff",
				kind,
				capacityPerNight: kind === "booking" ? "5" : undefined,
				...booking,
			}}
		/>,
	);
}

/** The flex row holding the notice input and its unit suffix. */
function noticeRow(): HTMLElement {
	const input = document.getElementById("min-notice-days");
	expect(input, "no #min-notice-days input on the form").not.toBeNull();
	const row = input?.parentElement;
	expect(row, "notice input has no wrapping row").not.toBeNull();
	return row as HTMLElement;
}

describe("ProductForm — Minimum notice is days, and only days", () => {
	it("suffixes the input with a static 'days', not a picker", () => {
		renderForm("physical");
		const row = noticeRow();
		expect(row.querySelector("select")).toBeNull();
		expect(row.textContent).toContain("days");
	});

	it("puts no unit picker anywhere on a non-booking product", () => {
		// `packageUnit` is only ever submitted inside the booking payload, so a
		// unit control on a physical product cannot be saved by definition.
		renderForm("physical");
		expect(screen.queryAllByLabelText("Package length unit")).toHaveLength(0);
	});

	it("keeps exactly one package-unit picker on a booking listing", () => {
		// The Package length row is its only legitimate home. Two of them meant
		// one shared `packageUnit` state behind two unrelated labels.
		renderForm("booking");
		expect(screen.getAllByLabelText("Package length unit")).toHaveLength(1);
		expect(noticeRow().querySelector("select")).toBeNull();
	});
});

describe("ProductForm — a package is described in its OWN unit", () => {
	// Found testing the hotfix in a browser: the summary strip said "1-day
	// package · per package" on a 1-month listing, and the helper said "runs 1
	// days" — and "days" even on a night package. Both read like the unit
	// quietly going back to days, which is the report this PR answers.
	it("summarises a monthly package as a month", () => {
		renderForm("booking", { packageLength: "1", packageUnit: "month" });
		expect(document.body.textContent).toContain("1-month package");
		expect(document.body.textContent).toContain("RM");
		expect(document.body.textContent).not.toContain("1-day package");
		expect(document.body.textContent).not.toMatch(/per package/);
	});

	it("says nights for a night package, never 'days'", () => {
		renderForm("booking", { packageLength: "2", packageUnit: "night" });
		expect(document.body.textContent).toContain("the booking runs 2 nights");
		expect(document.body.textContent).not.toContain("runs 2 days");
	});

	it("does not pluralise a length of one", () => {
		renderForm("booking", { packageLength: "1", packageUnit: "day" });
		expect(document.body.textContent).toContain("the booking runs 1 day from");
		expect(document.body.textContent).not.toContain("1 days");
	});

	it("keeps the monthly calendar wording, without a '(s)'", () => {
		renderForm("booking", { packageLength: "1", packageUnit: "month" });
		expect(document.body.textContent).toContain("1 month later");
		expect(document.body.textContent).not.toContain("month(s)");
	});
});
