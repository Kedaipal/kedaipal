// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The autocomplete talks to Convex (Places actions) — stub it with a button
// that fires a canned pick. The tests here are about the FIELD GROUP's pin
// lifecycle, not Google's UI.
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
					formattedAddress: "12, Jalan Ceylon, 50200 Kuala Lumpur",
					addressComponents: [],
					latitude: 3.1456,
					longitude: 101.7021,
					placeId: "place-123",
				})
			}
		>
			mock-pick
		</button>
	),
}));

import { type CheckoutAddressValues, emptyAddress } from "../../lib/schemas";
import { useAppForm } from "../forms/form";
import { AddressFieldset } from "./address-fieldset";

afterEach(cleanup);

/** Minimal parent harness — mirrors how the checkout page mounts the group,
 * and exposes live address values for assertions. */
function Harness({
	initial = { ...emptyAddress },
	allowManualEntry = true,
	onState,
}: {
	initial?: CheckoutAddressValues;
	allowManualEntry?: boolean;
	onState: (values: CheckoutAddressValues) => void;
}) {
	const form = useAppForm({
		defaultValues: { address: initial },
	});
	return (
		<>
			<AddressFieldset
				form={form}
				fields="address"
				retailerId={undefined}
				allowManualEntry={allowManualEntry}
				legend={undefined}
			/>
			<form.Subscribe selector={(s) => s.values.address}>
				{(address) => {
					onState(address);
					return null;
				}}
			</form.Subscribe>
		</>
	);
}

/** Open the "Can't find your address?" escape hatch. */
function openManualEntry() {
	fireEvent.click(screen.getByRole("button", { name: /Enter it manually/i }));
}

const PINNED_ADDRESS: CheckoutAddressValues = {
	...emptyAddress,
	line1: "Old Street 1",
	city: "Bangi",
	state: "Selangor",
	postcode: "43650",
	latitude: "2.9",
	longitude: "101.78",
	placeId: "old-place",
};

describe("AddressFieldset — pin is the single source of truth (86eye50qv)", () => {
	it("before a pick, the search is the only address input", () => {
		render(<Harness onState={() => {}} />);
		expect(screen.getByText("mock-pick")).toBeTruthy();
		// No parallel manual form competing with the search.
		expect(screen.queryByLabelText(/Address line 1/i)).toBeNull();
		expect(screen.queryByLabelText(/Postcode/i)).toBeNull();
	});

	it("picking a suggestion locks the location into a read-only card", () => {
		let latest = { ...emptyAddress };
		render(
			<Harness
				onState={(v) => {
					latest = v;
				}}
			/>,
		);

		fireEvent.click(screen.getByText("mock-pick"));

		expect(latest.latitude).toBe("3.1456");
		expect(latest.longitude).toBe("101.7021");
		expect(latest.placeId).toBe("place-123");
		// The location fields are gone — they can no longer contradict the pin.
		expect(screen.getByText("Location confirmed")).toBeTruthy();
		expect(screen.queryByLabelText(/Address line 1/i)).toBeNull();
		expect(screen.queryByLabelText(/Postcode/i)).toBeNull();
		expect(screen.queryByLabelText(/^City/i)).toBeNull();
	});

	it("keeps unit + notes editable while locked (neither moves the pin)", () => {
		let latest = { ...emptyAddress };
		render(
			<Harness
				onState={(v) => {
					latest = v;
				}}
			/>,
		);
		fireEvent.click(screen.getByText("mock-pick"));

		fireEvent.change(screen.getByLabelText(/Unit \/ floor/i), {
			target: { value: "Unit 12-3" },
		});
		fireEvent.change(screen.getByLabelText(/Delivery notes/i), {
			target: { value: "gate code 4321" },
		});

		expect(latest.line2).toBe("Unit 12-3");
		expect(latest.notes).toBe("gate code 4321");
		expect(latest.latitude).toBe("3.1456");
		expect(latest.longitude).toBe("101.7021");
	});

	it("'Search again' drops the location but keeps the unit + delivery notes", () => {
		let latest = { ...emptyAddress };
		render(
			<Harness
				initial={{
					...PINNED_ADDRESS,
					line2: "Unit 12-3",
					notes: "call on arrival",
				}}
				onState={(v) => {
					latest = v;
				}}
			/>,
		);
		// A restored address WITH a pin mounts straight into the locked state.
		expect(screen.getByText("Location confirmed")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: /Search again/i }));

		expect(latest.line1).toBe("");
		expect(latest.postcode).toBe("");
		expect(latest.city).toBe("");
		expect(latest.latitude).toBe("");
		expect(latest.placeId).toBe("");
		// Notes describe HOW to deliver, not WHERE — they survive.
		expect(latest.notes).toBe("call on arrival");
		// So does the unit/floor: it's the buyer's own typing, the locked card
		// leaves it editable, and a re-pick never restores it — wiping it here
		// would silently ship the order to a high-rise with no floor.
		expect(latest.line2).toBe("Unit 12-3");
		// …and we're back on the search.
		expect(screen.getByText("mock-pick")).toBeTruthy();
	});
});

describe("AddressFieldset — manual entry escape hatch", () => {
	it("is available by default and reveals the manual fields", () => {
		render(<Harness onState={() => {}} />);
		expect(screen.queryByLabelText(/Address line 1/i)).toBeNull();
		openManualEntry();
		expect(screen.getByLabelText(/Address line 1/i)).toBeTruthy();
		expect(screen.getByLabelText(/Postcode/i)).toBeTruthy();
	});

	it("is hidden when the store prices from coordinates", () => {
		render(<Harness allowManualEntry={false} onState={() => {}} />);
		expect(screen.queryByText(/Enter it manually/i)).toBeNull();
		expect(screen.queryByLabelText(/Address line 1/i)).toBeNull();
		// The search is still the way in.
		expect(screen.getByText("mock-pick")).toBeTruthy();
	});

	it("opens itself for a restored address that never had a pin", () => {
		render(
			<Harness
				initial={{ ...emptyAddress, line1: "Kampung Baru, Lot 5" }}
				onState={() => {}}
			/>,
		);
		// The buyer's own data is visible, not hidden behind a disclosure.
		expect(
			(screen.getByLabelText(/Address line 1/i) as HTMLInputElement).value,
		).toBe("Kampung Baru, Lot 5");
	});
});

describe("AddressFieldset — stale-coordinate guard (defence in depth)", () => {
	it("hand-editing a location field in manual mode clears a stale pin", () => {
		let latest = { ...emptyAddress };
		render(
			<Harness
				initial={PINNED_ADDRESS}
				onState={(v) => {
					latest = v;
				}}
			/>,
		);
		// Leave the locked state, then type the address by hand.
		fireEvent.click(screen.getByRole("button", { name: /Search again/i }));
		openManualEntry();
		fireEvent.change(screen.getByLabelText(/Address line 1/i), {
			target: { value: "99 Jalan Lain" },
		});

		expect(latest.line1).toBe("99 Jalan Lain");
		expect(latest.latitude).toBe("");
		expect(latest.longitude).toBe("");
		expect(latest.placeId).toBe("");
	});

	it("re-picking after a manual edit restores a fresh pin (last write wins)", () => {
		let latest = { ...emptyAddress };
		render(
			<Harness
				onState={(v) => {
					latest = v;
				}}
			/>,
		);
		openManualEntry();
		fireEvent.change(screen.getByLabelText(/^City/i), {
			target: { value: "Elsewhere" },
		});
		expect(latest.latitude).toBe("");

		// Pick again — the select handler sets structured fields first, coords
		// last, so the invalidation listeners can't eat the fresh pin.
		fireEvent.click(screen.getByText("mock-pick"));
		expect(latest.latitude).toBe("3.1456");
		expect(latest.longitude).toBe("101.7021");
	});
});
