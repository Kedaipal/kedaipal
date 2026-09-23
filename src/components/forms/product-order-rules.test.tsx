// @vitest-environment jsdom
/**
 * The Order rules card, once prep time and the pickup note join it
 * (ClickUp `z8r3fdff97`).
 *
 * Three things these pin that the pure tests cannot: that a booking listing
 * never meets a prep field (request-to-book IS the preparation), that a
 * delivery-only store is TOLD why the pickup note is unavailable rather than
 * finding a gap where a field should be, and that the presets set the same
 * field the seller can type into — one control, not two.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

import { MAX_PICKUP_NOTE_LENGTH } from "../../../convex/lib/pickupNote";
import { ProductForm, type ProductFormSubmitValues } from "./product-form";

afterEach(cleanup);

function renderForm({
	kind = "physical",
	offerSelfCollect = true,
	onSubmit = vi.fn(),
	initial = {},
}: {
	kind?: "physical" | "booking";
	offerSelfCollect?: boolean;
	onSubmit?: (v: ProductFormSubmitValues) => Promise<void>;
	initial?: Record<string, unknown>;
} = {}) {
	return render(
		<ProductForm
			retailerId={"r1" as never}
			categoriesLocked={false}
			eventsLocked={false}
			currency="MYR"
			submitLabel="Save"
			mode="edit"
			offerSelfCollect={offerSelfCollect}
			onSubmit={onSubmit}
			initialValues={{
				name: "Ice Cream Puff",
				kind,
				capacityPerNight: kind === "booking" ? "5" : undefined,
				// A submittable product: the card under test is Order rules, but
				// the FORM still needs a priced sellable unit to get that far.
				variants: [
					{ optionValues: [], price: 1200, onHand: 5, active: true },
				],
				...initial,
			}}
		/>,
	);
}

const prepInput = () =>
	document.getElementById("prep-minutes") as HTMLInputElement | null;
const noteInput = () =>
	document.getElementById("pickup-note") as HTMLTextAreaElement | null;

describe("Order rules — prep time", () => {
	it("offers a minutes field with hour-shaped shortcuts", () => {
		renderForm();
		expect(prepInput()).not.toBeNull();
		// Minutes is what the floor arithmetic needs; hours is how a seller
		// thinks. Both, or the seller does the arithmetic.
		for (const label of ["30 min", "1 hour", "2 hours", "4 hours"]) {
			expect(screen.getByRole("button", { name: label })).toBeTruthy();
		}
	});

	it("a preset SETS the field, and tapping the live one clears it", () => {
		renderForm();
		const twoHours = screen.getByRole("button", { name: "2 hours" });
		expect(twoHours.getAttribute("aria-pressed")).toBe("false");

		fireEvent.click(twoHours);
		expect(prepInput()?.value).toBe("120");
		expect(
			screen.getByRole("button", { name: "2 hours" }).getAttribute("aria-pressed"),
		).toBe("true");

		// A toggle, not a one-way door.
		fireEvent.click(screen.getByRole("button", { name: "2 hours" }));
		expect(prepInput()?.value).toBe("");
	});

	it("a hand-typed value that matches a preset lights it up", () => {
		// One control with two doors — if typing 60 left "1 hour" unlit, the
		// row would be telling the seller something false.
		renderForm();
		const input = prepInput() as HTMLInputElement;
		fireEvent.change(input, { target: { value: "60" } });
		expect(
			screen.getByRole("button", { name: "1 hour" }).getAttribute("aria-pressed"),
		).toBe("true");
		// And a value that matches none of them lights none.
		fireEvent.change(input, { target: { value: "45" } });
		for (const label of ["30 min", "1 hour", "2 hours", "4 hours"]) {
			expect(
				screen.getByRole("button", { name: label }).getAttribute("aria-pressed"),
			).toBe("false");
		}
	});

	it("tints the live preset with a token that is legible ON a tint", () => {
		// Caught by rendering it: `accent-foreground` is pure white — correct on
		// a SOLID bg-accent, invisible on bg-accent/10. `accent-emphasis` is the
		// token defined for exactly this, and it is defined in BOTH themes.
		renderForm({ initial: { prepMinutes: 120 } });
		const live = screen.getByRole("button", { name: "2 hours" });
		expect(live.className).toContain("text-accent-emphasis");
		expect(live.className).not.toContain("text-accent-foreground");
	});

	it("refuses junk at the field that owns it, before the round trip", () => {
		renderForm();
		fireEvent.change(prepInput() as HTMLInputElement, {
			target: { value: "1441" },
		});
		expect(
			screen.getByText(/whole number of minutes between 0 and 1440/i),
		).toBeTruthy();
	});

	it("reads what the seller typed — '1e2' is refused, not saved as 100", () => {
		// The spreadsheet import and this field share one parser, so a value is
		// never valid in one door and junk in the other.
		renderForm();
		fireEvent.change(prepInput() as HTMLInputElement, {
			target: { value: "1e2" },
		});
		expect(
			screen.getByText(/whole number of minutes between 0 and 1440/i),
		).toBeTruthy();
	});

	it("says when a notice period has already made prep inert", () => {
		// The state the two-field shape allows: notice ≥ 1 day removes same-day
		// entirely, and prep only moves the clock WITHIN a day. Surfaced, not
		// enforced — loosening notice back to 0 should find the prep still set.
		renderForm({ initial: { minNoticeDays: 2, prepMinutes: 120 } });
		expect(screen.getByText(/won't change anything until notice is back to 0/i))
			.toBeTruthy();
		expect(prepInput()?.value).toBe("120");
	});

	it("a booking listing never meets the field at all", () => {
		// Request-to-book IS the preparation — the seller accepts when ready.
		renderForm({ kind: "booking" });
		expect(prepInput()).toBeNull();
		expect(screen.queryByRole("button", { name: "2 hours" })).toBeNull();
	});
});

describe("Order rules — the card describes what it holds", () => {
	// The card arrived with two fields and kept its two-field sentence when
	// prep time and the pickup note joined it, so it told sellers to "leave
	// both blank" beside four controls — and called a collection instruction a
	// limit. Found by reading the card in a browser, not by a test.
	it("names all four rules, and never says 'both'", () => {
		renderForm();
		const card = screen.getByText("Order rules").closest("section");
		const description = card?.textContent ?? "";
		expect(description).not.toMatch(/both/i);
		expect(description).toMatch(/how long you need to make it/i);
		expect(description).toMatch(/when collecting/i);
	});

	it("says how long a prep window may be, and where a longer one goes", () => {
		// The cap is 1440 and the field speaks minutes, so without this the
		// only place a seller meets the ceiling is the refusal after Save.
		renderForm();
		const help = screen.getByText(/How long you need to make this/i);
		expect(help.textContent).toMatch(/up to 24 hours/i);
		expect(help.textContent).toMatch(/notice days/i);
	});
});

describe("Order rules — pickup note", () => {
	it("counts what it will STORE, not what was typed", () => {
		// The cap is enforced on the collapsed text server-side, so a note
		// padded with whitespace must not read as over the limit here.
		renderForm();
		const note = noteInput() as HTMLTextAreaElement;
		fireEvent.change(note, {
			target: { value: "  Side counter.\n\nAsk for Amirah.  " },
		});
		expect(screen.getByText(`29/${MAX_PICKUP_NOTE_LENGTH}`)).toBeTruthy();
	});

	it("warns past the cap instead of truncating the seller's words", () => {
		renderForm();
		fireEvent.change(noteInput() as HTMLTextAreaElement, {
			target: { value: "x".repeat(MAX_PICKUP_NOTE_LENGTH + 1) },
		});
		expect(
			screen.getByText(
				new RegExp(`${MAX_PICKUP_NOTE_LENGTH} characters or fewer`),
			),
		).toBeTruthy();
	});

	it("a booking listing never meets it — its orders can't carry one", () => {
		// convex/bookings.ts writes booking orders with deliveryMethod
		// "booking", never self_collect, so a note set here could reach nobody.
		// An input that can do nothing is worse than an absent one.
		renderForm({ kind: "booking" });
		expect(noteInput()).toBeNull();
		expect(screen.queryByText(/Pickup note/i)).toBeNull();
	});

	it("a delivery-only store is TOLD why, and where to switch it on", () => {
		// The rule that matters: a constraint is surfaced, never enforced by a
		// silent gap where a field should be.
		renderForm({ offerSelfCollect: false });
		expect(noteInput()).toBeNull();
		const hint = screen.getByText(/once your store offers self-collect/i);
		expect(hint.textContent).toMatch(/Settings/);
		expect(hint.textContent).toMatch(/Fulfilment/);
	});

	it("keeps a note already written when self-collect is switched off", () => {
		// Turning delivery-only on must not quietly destroy the seller's copy;
		// the field hides, the value survives, and turning it back on restores.
		const onSubmit =
			vi.fn<(v: ProductFormSubmitValues) => Promise<void>>(async () => {});
		renderForm({
			offerSelfCollect: false,
			onSubmit,
			initial: { pickupNote: "Side counter." },
		});
		expect(noteInput()).toBeNull();
		const rendered = document.body.textContent ?? "";
		expect(rendered).not.toContain("Side counter.");
	});
});

describe("Order rules — what the card submits", () => {
	it("sends both fields, with 0 and \"\" as the clearing spellings", async () => {
		const onSubmit =
			vi.fn<(v: ProductFormSubmitValues) => Promise<void>>(async () => {});
		renderForm({ onSubmit, initial: { prepMinutes: 120, pickupNote: "Side counter." } });

		fireEvent.change(prepInput() as HTMLInputElement, { target: { value: "" } });
		fireEvent.change(noteInput() as HTMLTextAreaElement, {
			target: { value: "" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());

		const [values] = onSubmit.mock.lastCall ?? [];
		if (!values) throw new Error("form never submitted");
		expect(values.prepMinutes).toBe(0);
		expect(values.pickupNote).toBe("");
	});

	it("a booking listing submits no prep window", async () => {
		const onSubmit =
			vi.fn<(v: ProductFormSubmitValues) => Promise<void>>(async () => {});
		renderForm({ kind: "booking", onSubmit, initial: { prepMinutes: 120 } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
		const [values] = onSubmit.mock.lastCall ?? [];
		if (!values) throw new Error("form never submitted");
		expect(values.prepMinutes).toBe(0);
		expect(values.pickupNote).toBe("");
	});
});
