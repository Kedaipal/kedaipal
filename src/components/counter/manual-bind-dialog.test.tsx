// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Country } from "../../../convex/lib/country";
import { ManualBindDialog } from "./manual-bind-dialog";

// The dialog reads nothing — the store country arrives as a prop — so only the
// mutation half of the Convex pair needs stubbing (send-claim.test.tsx
// harness). `bind` stands in for bindSessionManualPhone.
const state = vi.hoisted(() => ({ bind: vi.fn() }));
vi.mock("convex/react", () => ({ useMutation: () => state.bind }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

/**
 * The counter's manual buyer bind (86ey8vqp6), any-country since z8r3fdh274.
 * The cashier is keying a walk-in's number — often a visitor's — so these pin
 * that the picker reaches the server, that a bad number says why where the
 * cashier is looking (and the button can't fire around it), and that one
 * buyer's country can't leak into the next bind.
 */

/** The dropdown opens the dialog; the host owns `open`, like app.checkout.tsx. */
function Host({
	storeCountry = "MY",
	onStarted = () => {},
}: {
	storeCountry?: Country;
	onStarted?: (sessionId: string) => void;
}) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button type="button" onClick={() => setOpen(true)}>
				Enter phone number
			</button>
			<ManualBindDialog
				open={open}
				onOpenChange={setOpen}
				retailerId={undefined}
				storeCountry={storeCountry}
				onStarted={onStarted}
			/>
		</>
	);
}

function openDialog(props: Parameters<typeof Host>[0] = {}) {
	const view = render(<Host {...props} />);
	fireEvent.click(screen.getByRole("button", { name: "Enter phone number" }));
	return view;
}

const MY_REJECTION =
	"Enter a Malaysian mobile number (e.g. 012-345 6789), or tap +60 to change the country";
const MY_HINT = "Serving a visitor? Tap +60 to pick their country.";

const picker = () =>
	screen.getByRole("combobox", {
		name: "Country of the buyer's WhatsApp number",
	}) as HTMLSelectElement;
const phoneInput = () =>
	screen.getByRole("textbox", { name: "WhatsApp number" }) as HTMLInputElement;
const startButton = () =>
	screen.getByRole("button", { name: "Start checkout" }) as HTMLButtonElement;

function typeName(name: string) {
	fireEvent.change(screen.getByPlaceholderText("e.g. Aiman"), {
		target: { value: name },
	});
}

function typePhone(value: string) {
	fireEvent.change(phoneInput(), { target: { value } });
}

describe("ManualBindDialog — the picker", () => {
	it.each([
		["MY", "+60"],
		["SG", "+65"],
	] as const)("opens on the store's country (%s)", (storeCountry, code) => {
		openDialog({ storeCountry });
		expect(picker().value).toBe(storeCountry);
		// The capability is named where the cashier types, not left to the
		// chevron alone.
		expect(
			screen.getByText(`Serving a visitor? Tap ${code} to pick their country.`),
		).toBeTruthy();
	});

	it("follows a store country that arrives late — the default is derived, never seeded", () => {
		// The dashboard retailer reads "MY" until it loads. An SG store's cashier
		// who opens the dialog in that window must still land on +65.
		const { rerender } = openDialog({ storeCountry: "MY" });
		expect(picker().value).toBe("MY");
		rerender(<Host storeCountry="SG" />);
		expect(picker().value).toBe("SG");
		expect(
			screen.getByText("Serving a visitor? Tap +65 to pick their country."),
		).toBeTruthy();
	});

	it("a cashier's pick survives the store country re-rendering under it", () => {
		const { rerender } = openDialog({ storeCountry: "MY" });
		fireEvent.change(picker(), { target: { value: "JP" } });
		rerender(<Host storeCountry="SG" />);
		expect(picker().value).toBe("JP");
		expect(
			screen.getByText("Number from Japan — tap +81 to change it."),
		).toBeTruthy();
	});

	it("a foreign pick reaches the server as waDialCountry", async () => {
		state.bind.mockResolvedValue({ sessionId: "sess_1", reclaimed: false });
		const onStarted = vi.fn();
		openDialog({ onStarted });
		typeName("Kenji Sato");
		fireEvent.change(picker(), { target: { value: "JP" } });
		expect(
			screen.getByText("Number from Japan — tap +81 to change it."),
		).toBeTruthy();
		typePhone("90-1234-5678");
		fireEvent.click(startButton());
		await waitFor(() => expect(onStarted).toHaveBeenCalledWith("sess_1"));
		expect(state.bind).toHaveBeenCalledWith({
			retailerId: undefined,
			waPhone: "90-1234-5678",
			waDialCountry: "JP",
			name: "Kenji Sato",
		});
		// Success closes the dialog.
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("a typed +CC switches the picker and sends that country", async () => {
		state.bind.mockResolvedValue({ sessionId: "sess_2", reclaimed: false });
		openDialog();
		typeName("Kenji Sato");
		typePhone("+81 90-1234-5678");
		expect(picker().value).toBe("JP");
		expect(phoneInput().value).toBe("90-1234-5678");
		fireEvent.click(startButton());
		await waitFor(() => expect(state.bind).toHaveBeenCalled());
		expect(state.bind.mock.calls[0]?.[0]).toMatchObject({
			waPhone: "90-1234-5678",
			waDialCountry: "JP",
		});
	});

	it("takes a 7-digit national number (Brunei) — no blanket digit-count gate", () => {
		openDialog();
		typeName("Hajah Noor");
		fireEvent.change(picker(), { target: { value: "BN" } });
		typePhone("712 3456");
		expect(startButton().disabled).toBe(false);
	});

	it("never offers the browser's autofill — it would be the seller's own number", () => {
		openDialog();
		expect(phoneInput().getAttribute("autocomplete")).toBe("off");
	});
});

describe("ManualBindDialog — rejection", () => {
	it("an invalid number says why under the field, and Start checkout can't fire", () => {
		openDialog();
		typeName("Aiman Hakim");
		typePhone("123");
		// Quiet while typing…
		expect(screen.queryByText(MY_REJECTION)).toBeNull();
		expect(
			screen.getByText("Finish their WhatsApp number to start."),
		).toBeTruthy();
		// …then the reason, once the cashier leaves the field.
		fireEvent.blur(phoneInput());
		expect(screen.getByText(MY_REJECTION)).toBeTruthy();
		expect(phoneInput().getAttribute("aria-invalid")).toBe("true");
		expect(startButton().disabled).toBe(true);
		// Enter doesn't route around the disabled button.
		fireEvent.keyDown(phoneInput(), { key: "Enter" });
		expect(state.bind).not.toHaveBeenCalled();
	});

	it("a rejection takes the hint's place — and still names the way out", () => {
		// A visitor's UK number keyed without its code, the store's +60 still
		// on: the likeliest rejection at this counter. The reason replaces the
		// hint and itself points at the plate, so the fix isn't said twice.
		openDialog();
		typeName("Oliver Smith");
		typePhone("7911 123456");
		fireEvent.blur(phoneInput());
		const reason = screen.getByText(MY_REJECTION);
		expect(reason.textContent).toMatch(/tap \+60 to change the country/);
		expect(screen.queryByText(MY_HINT)).toBeNull();
		expect(phoneInput().getAttribute("aria-describedby")).toBe(reason.id);
		// Once the number is valid the reason goes and the hint is back.
		typePhone("12-345 6789");
		expect(screen.queryByText(MY_REJECTION)).toBeNull();
		const hint = screen.getByText(MY_HINT);
		expect(phoneInput().getAttribute("aria-describedby")).toBe(hint.id);
	});

	it("Enter on an unfinished number shows the reason instead of waiting for a blur", () => {
		openDialog();
		typeName("Aiman Hakim");
		typePhone("123");
		fireEvent.keyDown(phoneInput(), { key: "Enter" });
		expect(screen.getByText(MY_REJECTION)).toBeTruthy();
		expect(state.bind).not.toHaveBeenCalled();
	});

	it("says what's missing while Start checkout is disabled", () => {
		openDialog();
		expect(startButton().disabled).toBe(true);
		expect(
			screen.getByText("Enter the buyer's name (at least 3 letters) to start."),
		).toBeTruthy();
		typeName("Aiman Hakim");
		expect(
			screen.getByText("Enter their WhatsApp number to start."),
		).toBeTruthy();
	});

	it("the one-tap switch fixes an SG-shaped number at an MY store", async () => {
		state.bind.mockResolvedValue({ sessionId: "sess_3", reclaimed: false });
		openDialog({ storeCountry: "MY" });
		typeName("Wei Ling");
		typePhone("9123 4567");
		// Shown at once — the digits already fit Singapore, so the fix is ready.
		expect(
			screen.getByText(
				"That looks like a Singapore mobile number — switch the country to +65",
			),
		).toBeTruthy();
		expect(startButton().disabled).toBe(true);
		const switchButton = screen.getByRole("button", {
			name: "Switch to Singapore (+65)",
		});
		switchButton.focus();
		fireEvent.click(switchButton);
		expect(picker().value).toBe("SG");
		expect(
			screen.queryByRole("button", { name: "Switch to Singapore (+65)" }),
		).toBeNull();
		// The button unmounts with the fix — focus lands back in the number,
		// not on the dialog's frame.
		expect(document.activeElement).toBe(phoneInput());
		expect(startButton().disabled).toBe(false);
		fireEvent.click(startButton());
		await waitFor(() => expect(state.bind).toHaveBeenCalled());
		expect(state.bind.mock.calls[0]?.[0]).toMatchObject({
			waPhone: "9123 4567",
			waDialCountry: "SG",
		});
	});

	it("a server refusal is a toast, and the dialog stays open to fix it", async () => {
		state.bind.mockRejectedValue(new Error("Store is on a seasonal break"));
		openDialog();
		typeName("Aiman Hakim");
		typePhone("12-345 6789");
		fireEvent.click(startButton());
		await waitFor(() => expect(toast.error).toHaveBeenCalled());
		expect(screen.getByRole("dialog")).toBeTruthy();
		expect(startButton().disabled).toBe(false);
	});
});

describe("ManualBindDialog — every open starts clean", () => {
	it("closing drops the last buyer's pick, number and name", () => {
		openDialog();
		typeName("Kenji Sato");
		fireEvent.change(picker(), { target: { value: "JP" } });
		typePhone("123");
		fireEvent.blur(phoneInput());
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(screen.queryByRole("dialog")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Enter phone number" }));
		expect(picker().value).toBe("MY");
		expect(phoneInput().value).toBe("");
		expect(
			(screen.getByPlaceholderText("e.g. Aiman") as HTMLInputElement).value,
		).toBe("");
		expect(screen.queryByText(/Enter a valid Japan mobile number/)).toBeNull();
	});
});
