// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const component = (type: string, text: string) => ({
	types: [type],
	longText: text,
	shortText: text,
});

/** A complete MY pick — every field the strict schema asks for. */
const FULL_MY_COMPONENTS = [
	component("street_number", "12"),
	component("route", "Jalan Ceylon"),
	component("locality", "Kuala Lumpur"),
	component("administrative_area_level_1", "Wilayah Persekutuan Kuala Lumpur"),
	component("postal_code", "50200"),
];

// The autocomplete talks to Convex (Places actions) — stub it with a button
// that fires a canned pick. The tests here are about the FIELD GROUP's pin
// lifecycle, not Google's UI. `pick.components` is what Places "returned".
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
					formattedAddress: "12, Jalan Ceylon, 50200 Kuala Lumpur",
					addressComponents: pick.components,
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

beforeEach(() => {
	pick.components = FULL_MY_COMPONENTS;
});
afterEach(cleanup);

/** Minimal parent harness — mirrors how the checkout page mounts the group,
 * and exposes live address values for assertions. */
function Harness({
	initial = { ...emptyAddress },
	country = "MY" as const,
	allowManualEntry = true,
	collectsFromCustomer = false,
	onState,
}: {
	initial?: CheckoutAddressValues;
	country?: "MY" | "SG";
	allowManualEntry?: boolean;
	collectsFromCustomer?: boolean;
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
				country={country}
				allowManualEntry={allowManualEntry}
				legend={undefined}
				collectsFromCustomer={collectsFromCustomer}
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

describe("AddressFieldset — SG variant (86eynw29u)", () => {
	it("manual entry shows line1 + a postal-code field and NO state/city inputs", () => {
		render(<Harness country="SG" onState={() => {}} />);
		openManualEntry();
		expect(screen.getByLabelText(/Address line 1/i)).toBeTruthy();
		expect(screen.getByLabelText(/Postal code/i)).toBeTruthy();
		// Singapore has no state tier — neither field exists to contradict it.
		expect(screen.queryByLabelText(/^City/i)).toBeNull();
		expect(screen.queryByLabelText(/^State/i)).toBeNull();
	});

	it("a Google pick parses city and state to the 'Singapore' literal", () => {
		let latest = { ...emptyAddress };
		render(
			<Harness
				country="SG"
				onState={(v) => {
					latest = v;
				}}
			/>,
		);
		fireEvent.click(screen.getByText("mock-pick"));
		expect(latest.city).toBe("Singapore");
		expect(latest.state).toBe("Singapore");
		expect(latest.latitude).toBe("3.1456");
	});

	it("the confirmed card never prints 'Singapore, Singapore'", () => {
		render(
			<Harness
				country="SG"
				initial={{
					...emptyAddress,
					line1: "12 Bedok North Ave 3",
					city: "Singapore",
					state: "Singapore",
					postcode: "238859",
					latitude: "1.3",
					longitude: "103.8",
					placeId: "sg-place",
				}}
				onState={() => {}}
			/>,
		);
		expect(screen.getByText("Location confirmed")).toBeTruthy();
		expect(screen.getByText("238859 Singapore")).toBeTruthy();
		expect(screen.queryByText(/Singapore, Singapore/)).toBeNull();
	});

	it("MY manual entry keeps the classic postcode/city/state shape", () => {
		render(<Harness country="MY" onState={() => {}} />);
		openManualEntry();
		expect(screen.getByLabelText(/Postcode/i)).toBeTruthy();
		expect(screen.getByLabelText(/^City/i)).toBeTruthy();
		expect(screen.getByLabelText(/^State/i)).toBeTruthy();
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

describe("AddressFieldset — a pick missing a required field asks for it in place", () => {
	const SG_NO_POSTCODE = [
		component("street_number", "123"),
		component("route", "Bedok North Avenue 3"),
	];

	it("a complete pick asks for nothing — the card stays read-only", () => {
		render(<Harness onState={() => {}} />);
		fireEvent.click(screen.getByText("mock-pick"));
		expect(screen.getByText("Location confirmed")).toBeTruthy();
		expect(screen.queryByText(/Google didn't include/)).toBeNull();
		expect(screen.queryByLabelText(/Postcode/i)).toBeNull();
		expect(screen.queryByLabelText(/^City/i)).toBeNull();
		expect(screen.queryByLabelText(/^State/i)).toBeNull();
	});

	it("an SG pick with no postal code shows the postal-code input on the locked card, and keeps the pin", () => {
		pick.components = SG_NO_POSTCODE;
		let latest = { ...emptyAddress };
		render(
			<Harness
				country="SG"
				onState={(v) => {
					latest = v;
				}}
			/>,
		);
		fireEvent.click(screen.getByText("mock-pick"));

		expect(screen.getByText("Location confirmed")).toBeTruthy();
		expect(screen.getByText("123 Bedok North Avenue 3")).toBeTruthy();
		expect(
			screen.getByText(
				"Google didn't include the postal code for this spot — add it to finish your address.",
			),
		).toBeTruthy();
		const postal = screen.getByLabelText(/Postal code/i) as HTMLInputElement;
		expect(postal.value).toBe("");

		fireEvent.change(postal, { target: { value: "460123" } });
		expect(latest.postcode).toBe("460123");
		// Completing the pinned place doesn't move it — the pin survives.
		expect(latest.latitude).toBe("3.1456");
		expect(latest.longitude).toBe("101.7021");
		expect(latest.placeId).toBe("place-123");
		// …and the field stays put once it reads valid, so a typo stays fixable.
		expect(screen.getByLabelText(/Postal code/i)).toBe(postal);
		// The summary doesn't echo what's being typed below it.
		expect(screen.queryByText("460123 Singapore")).toBeNull();
	});

	it("a postcode Places got wrong is shown prefilled, to correct", () => {
		pick.components = [...SG_NO_POSTCODE, component("postal_code", "4601")];
		render(<Harness country="SG" onState={() => {}} />);
		fireEvent.click(screen.getByText("mock-pick"));
		expect(
			(screen.getByLabelText(/Postal code/i) as HTMLInputElement).value,
		).toBe("4601");
	});

	it("an MY pick with no locality and an unknown state asks for both, and only those", () => {
		pick.components = [
			component("route", "Jalan Ceylon"),
			component("administrative_area_level_1", "Somewhere Else"),
			component("postal_code", "50200"),
		];
		render(<Harness onState={() => {}} />);
		fireEvent.click(screen.getByText("mock-pick"));

		expect(
			screen.getByText(
				"Google didn't include the city and state for this spot — add them to finish your address.",
			),
		).toBeTruthy();
		expect(screen.getByLabelText(/^City/i)).toBeTruthy();
		expect(screen.getByLabelText(/^State/i)).toBeTruthy();
		// What Google did give stays read-only — no second postcode box.
		expect(screen.queryByLabelText(/Postcode/i)).toBeNull();
		expect(screen.queryByLabelText(/Address line 1/i)).toBeNull();
		expect(screen.getByText("50200")).toBeTruthy();
	});

	it("a restored pinned address missing its postcode asks for it too", () => {
		render(
			<Harness
				initial={{ ...PINNED_ADDRESS, postcode: "" }}
				onState={() => {}}
			/>,
		);
		expect(screen.getByText("Location confirmed")).toBeTruthy();
		expect(screen.getByLabelText(/Postcode/i)).toBeTruthy();
	});

	it("'Search again' then a complete pick measures its own gaps — none", () => {
		pick.components = [
			component("route", "Jalan Ceylon"),
			component("locality", "Kuala Lumpur"),
			component("administrative_area_level_1", "Selangor"),
		];
		render(<Harness onState={() => {}} />);
		fireEvent.click(screen.getByText("mock-pick"));
		expect(screen.getByLabelText(/Postcode/i)).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: /Search again/i }));
		pick.components = FULL_MY_COMPONENTS;
		fireEvent.click(screen.getByText("mock-pick"));
		expect(screen.getByText("Location confirmed")).toBeTruthy();
		expect(screen.queryByLabelText(/Postcode/i)).toBeNull();
	});
});
