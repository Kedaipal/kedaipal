// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { AddressEditDialog } from "./address-edit-dialog";

// Reads go through the TanStack adapter pair (docs/frontend-caching.md). A
// flat/free store: no live quote, so nothing but the form gates Save.
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: ({ args }: { args: unknown }) =>
		args === "skip" ? { data: undefined } : { data: { kind: "free" } },
}));
vi.mock("convex/react", () => ({
	useMutation: () => vi.fn(),
	useAction: () => vi.fn(),
}));

// The Places search is stubbed with a button that fires a canned pick —
// `pick.components` is what Google "returned".
const pick = vi.hoisted(() => ({ components: [] as unknown[] }));
vi.mock("../forms/google-address-autocomplete", () => ({
	GoogleAddressAutocomplete: ({
		onSelect,
	}: {
		onSelect: (payload: unknown) => void;
	}) => (
		<button
			type="button"
			onClick={() =>
				onSelect({
					formattedAddress: "123 Bedok North Avenue 3, Singapore",
					addressComponents: pick.components,
					latitude: 1.33,
					longitude: 103.93,
					placeId: "sg-place",
				})
			}
		>
			mock-pick
		</button>
	),
}));

beforeAll(() => {
	// A refused submit scrolls to the first error (focus-error.ts).
	Element.prototype.scrollIntoView ??= () => {};
});

const component = (type: string, text: string) => ({
	types: [type],
	longText: text,
	shortText: text,
});

beforeEach(() => {
	pick.components = [
		component("street_number", "123"),
		component("route", "Bedok North Avenue 3"),
	];
});
afterEach(cleanup);

const SAVED: NonNullable<Doc<"orders">["deliveryAddress"]> = {
	line1: "12 Bedok North Ave 3",
	city: "Singapore",
	state: "Singapore",
	postcode: "460012",
	latitude: 1.33,
	longitude: 103.93,
	placeId: "old-place",
};

function renderDialog() {
	render(
		<AddressEditDialog
			open
			onClose={() => {}}
			token="tok_abc"
			currentAddress={SAVED}
			retailerId={"ret_1" as Id<"retailers">}
			country="SG"
			subtotal={4500}
			orderItems={[]}
			currency="SGD"
		/>,
	);
}

const saveButton = () =>
	screen.getByRole("button", { name: /^Save address/ }) as HTMLButtonElement;

describe("AddressEditDialog — Save is never disabled without a reason", () => {
	it("an untouched, valid address saves with nothing to say", () => {
		renderDialog();
		expect(saveButton().disabled).toBe(false);
		expect(screen.queryByText(/to save$/)).toBeNull();
	});

	it("'Search again' empties the location: Save disables and says what's missing", () => {
		renderDialog();
		fireEvent.click(screen.getByRole("button", { name: /Search again/i }));
		expect(saveButton().disabled).toBe(true);
		expect(screen.getByText("Add your delivery address to save")).toBeTruthy();
	});

	it("a re-pick with no postal code asks for it on the card, names it by Save, and clears once filled", () => {
		renderDialog();
		fireEvent.click(screen.getByRole("button", { name: /Search again/i }));
		fireEvent.click(screen.getByText("mock-pick"));

		expect(screen.getByText("Location confirmed")).toBeTruthy();
		expect(saveButton().disabled).toBe(true);
		expect(screen.getByText("Add your postal code to save")).toBeTruthy();

		fireEvent.change(screen.getByLabelText(/Postal code/i), {
			target: { value: "460123" },
		});
		expect(screen.queryByText(/to save$/)).toBeNull();
		expect(saveButton().disabled).toBe(false);
	});
});
