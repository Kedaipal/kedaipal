// @vitest-environment jsdom
/**
 * "How are the N days counted?" (z8r3fdhpm7) — the seller's side of an
 * open-days package: asked only where it means something (a DAY package),
 * explained with a worked example from the store's own schedule, and honest
 * when there is nothing to skip yet.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDaysExample, PackageDayCounting } from "./package-day-counting";

vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: undefined, isPending: true }),
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: React.ReactNode }) => (
		<a href="#x">{children}</a>
	),
}));

import { ProductForm, type ProductFormSubmitValues } from "./product-form";

/** Open 9–6, closed Sundays. */
const SUNDAYS_OFF = Array.from({ length: 7 }, (_, i) =>
	i === 0
		? { open: 540, close: 1080, closed: true }
		: { open: 540, close: 1080 },
);
const WED_30_SEP = Date.UTC(2026, 8, 30) - 8 * 3_600_000;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	// Tue 29 Sep 2026, 10:00 MYT — "tomorrow" is Wed 30 Sep.
	vi.setSystemTime(new Date("2026-09-29T02:00:00Z"));
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe("openDaysExample", () => {
	it("finds the first start whose term steps over a shut day", () => {
		expect(
			openDaysExample(5, SUNDAYS_OFF, [
				{
					startDate: WED_30_SEP + 86_400_000,
					endDate: WED_30_SEP + 86_400_000,
				},
			]),
		).toEqual({
			start: WED_30_SEP,
			lastDay: WED_30_SEP + 6 * 86_400_000,
			skipped: [WED_30_SEP + 86_400_000, WED_30_SEP + 4 * 86_400_000],
		});
	});

	it("null when nothing in reach is ever shut", () => {
		expect(openDaysExample(5, undefined, undefined)).toBeNull();
	});
});

describe("PackageDayCounting", () => {
	it("two pick-one cards; picking one reports it", () => {
		const onChange = vi.fn();
		render(
			<PackageDayCounting
				packageLength={5}
				skipsClosedDays={false}
				onChange={onChange}
				schedule={{ openingHours: SUNDAYS_OFF }}
			/>,
		);
		expect(screen.getByText("How are the 5 days counted?")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: /Only days you're open/ }),
		);
		expect(onChange).toHaveBeenCalledWith(true);
		expect(
			screen
				.getByRole("button", { name: /Every day in a row/ })
				.getAttribute("aria-pressed"),
		).toBe("true");
	});

	it("open days: a worked example from THIS store's schedule", () => {
		render(
			<PackageDayCounting
				packageLength={5}
				skipsClosedDays
				onChange={() => {}}
				schedule={{ openingHours: SUNDAYS_OFF }}
			/>,
		);
		// Wed 30 Sep + 5 open days, Sunday skipped → last day Mon 5 Oct.
		expect(
			screen.getByText(
				/Starting Wed 30 Sep, it runs to Mon 5 Oct — skips Sun 4 Oct\./,
			),
		).toBeTruthy();
	});

	it("a store with nothing to skip is told so, with where to set days off", () => {
		render(
			<PackageDayCounting
				packageLength={5}
				skipsClosedDays
				onChange={() => {}}
				schedule={{}}
			/>,
		);
		expect(
			screen.getByText(/open every day with no closed dates/),
		).toBeTruthy();
		expect(screen.getByText("Settings → Fulfilment")).toBeTruthy();
	});

	it("an unknown schedule never claims the store is open every day", () => {
		render(
			<PackageDayCounting
				packageLength={5}
				skipsClosedDays
				onChange={() => {}}
				schedule={undefined}
			/>,
		);
		expect(screen.queryByText(/open every day/)).toBeNull();
		expect(screen.getByText(/Your closed days are skipped/)).toBeTruthy();
	});
});

describe("ProductForm — the choice sits under a DAY package only", () => {
	function renderForm(booking: {
		packageLength?: string;
		packageUnit?: "day" | "night" | "month";
		skipsClosedDays?: boolean;
	}) {
		render(
			<ProductForm
				retailerId={"r1" as never}
				categoriesLocked={false}
				eventsLocked={false}
				currency="MYR"
				submitLabel="Save"
				onSubmit={vi.fn()}
				mode="edit"
				storeSchedule={{ openingHours: SUNDAYS_OFF }}
				initialValues={{
					name: "Kayak course",
					kind: "booking",
					capacityPerNight: "4",
					...booking,
				}}
			/>,
		);
	}

	it("asked for a day package, and the summary strip names the rule", () => {
		renderForm({
			packageLength: "5",
			packageUnit: "day",
			skipsClosedDays: true,
		});
		expect(screen.getByText("How are the 5 days counted?")).toBeTruthy();
		expect(document.body.textContent).toContain(
			"5-day package (open days only)",
		);
	});

	it.each([
		["a month package", { packageLength: "1", packageUnit: "month" as const }],
		["a night package", { packageLength: "2", packageUnit: "night" as const }],
		["a free-range stay", {}],
	])("not asked for %s", (_label, booking) => {
		renderForm({ ...booking, skipsClosedDays: true });
		expect(screen.queryByText(/How are the .* counted\?/)).toBeNull();
		expect(document.body.textContent).not.toContain("open days only");
	});
});

describe("ProductForm — what it SUBMITS for the day-counting choice", () => {
	async function submitWith(booking: {
		packageLength?: string;
		packageUnit?: "day" | "night" | "month";
		skipsClosedDays?: boolean;
	}) {
		const onSubmit = vi.fn<(v: ProductFormSubmitValues) => Promise<void>>(
			async () => {},
		);
		render(
			<ProductForm
				retailerId={"r1" as never}
				categoriesLocked={false}
				eventsLocked={false}
				currency="MYR"
				submitLabel="Save"
				onSubmit={onSubmit}
				mode="edit"
				storeSchedule={{ openingHours: SUNDAYS_OFF }}
				initialValues={{
					name: "Kayak course",
					kind: "booking",
					capacityPerNight: "4",
					variants: [
						{ optionValues: [], price: 50000, onHand: 0, active: true },
					],
					...booking,
				}}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
		const [values] = onSubmit.mock.lastCall ?? [];
		if (!values) throw new Error("form never submitted");
		return values.booking?.skipsClosedDays;
	}

	it("a day package sends it", async () => {
		expect(
			await submitWith({
				packageLength: "5",
				packageUnit: "day",
				skipsClosedDays: true,
			}),
		).toBe(true);
	});

	it("a value kept from a day package never rides along on a month — the server would refuse it", async () => {
		expect(
			await submitWith({
				packageLength: "1",
				packageUnit: "month",
				skipsClosedDays: true,
			}),
		).toBeUndefined();
	});
});
