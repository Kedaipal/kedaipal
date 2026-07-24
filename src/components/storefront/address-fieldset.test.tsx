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

/** Minimal parent harness — mirrors how the checkout sheet mounts the group,
 * and exposes live address values for assertions. */
function Harness({
	initial = { ...emptyAddress },
	onState,
}: {
	initial?: CheckoutAddressValues;
	onState: (values: CheckoutAddressValues) => void;
}) {
	const form = useAppForm({
		defaultValues: { address: initial },
	});
	return (
		<>
			<AddressFieldset form={form} fields="address" retailerId={undefined} />
			<form.Subscribe selector={(s) => s.values.address}>
				{(address) => {
					onState(address);
					return null;
				}}
			</form.Subscribe>
		</>
	);
}

describe("AddressFieldset — pin lifecycle (stale-coordinate guard)", () => {
	it("a Google pick stamps coordinates; hand-editing line1 clears them", () => {
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

		// Buyer types over the street line → the old pin no longer describes
		// the address, so it must clear (quote falls back to "pick again").
		fireEvent.change(screen.getByLabelText(/Address line 1/i), {
			target: { value: "99 Jalan Lain" },
		});
		expect(latest.latitude).toBe("");
		expect(latest.longitude).toBe("");
		expect(latest.placeId).toBe("");
	});

	it("line2 (unit numbers) and notes never touch the pin", () => {
		let latest = { ...emptyAddress };
		render(
			<Harness
				onState={(v) => {
					latest = v;
				}}
			/>,
		);
		fireEvent.click(screen.getByText("mock-pick"));
		fireEvent.change(screen.getByLabelText(/Address line 2/i), {
			target: { value: "Unit 12-3" },
		});
		fireEvent.change(screen.getByLabelText(/Delivery notes/i), {
			target: { value: "gate code 4321" },
		});
		expect(latest.latitude).toBe("3.1456");
		expect(latest.longitude).toBe("101.7021");
	});

	it("a RESTORED address (prefilled with old coords) loses its pin on edit", () => {
		let latest = { ...emptyAddress };
		render(
			<Harness
				initial={{
					...emptyAddress,
					line1: "Old Street 1",
					city: "Bangi",
					state: "Selangor",
					postcode: "43650",
					latitude: "2.9",
					longitude: "101.78",
					placeId: "old-place",
				}}
				onState={(v) => {
					latest = v;
				}}
			/>,
		);
		// Prefill intact on mount (returning-buyer convenience).
		expect(latest.latitude).toBe("2.9");
		// Typing a different postcode kills the stale pin.
		fireEvent.change(screen.getByLabelText(/Postcode/i), {
			target: { value: "50200" },
		});
		expect(latest.latitude).toBe("");
		expect(latest.longitude).toBe("");
	});

	it("re-picking after an edit restores a fresh pin (last write wins)", () => {
		let latest = { ...emptyAddress };
		render(
			<Harness
				onState={(v) => {
					latest = v;
				}}
			/>,
		);
		fireEvent.click(screen.getByText("mock-pick"));
		fireEvent.change(screen.getByLabelText(/City/i), {
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
