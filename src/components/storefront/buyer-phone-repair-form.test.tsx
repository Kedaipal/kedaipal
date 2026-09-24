// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Country } from "../../../convex/lib/country";
import { BuyerPhoneRepairForm } from "./buyer-phone-repair-form";

// No reads — only the mutation half of the Convex pair needs stubbing
// (send-claim.test.tsx harness). `update` stands in for updateBuyerPhone.
const state = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("convex/react", () => ({ useMutation: () => state.update }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

/**
 * The track page's number repair (86eyf1rck), any-country since z8r3fdh274.
 * Its budget is tight — `buyerPhoneUpdate` allows 2 tries per 10 minutes per
 * token — so the guard worth pinning is that a number the parser refuses
 * never reaches the server, and says why where the buyer is typing.
 */
function renderForm({
	failedWaPhone = "60123456780",
	storeCountry = "MY",
	locale = "en",
	onSaved = () => {},
}: {
	failedWaPhone?: string;
	storeCountry?: Country;
	locale?: string;
	onSaved?: () => void;
} = {}) {
	render(
		<BuyerPhoneRepairForm
			token="tok_abc"
			failedWaPhone={failedWaPhone}
			storeCountry={storeCountry}
			locale={locale}
			onSaved={onSaved}
			onCancel={() => {}}
		/>,
	);
}

const picker = () =>
	screen.getByRole("combobox", {
		name: "Country of your WhatsApp number",
	}) as HTMLSelectElement;
const phoneInput = () =>
	screen.getByRole("textbox", {
		name: "Your WhatsApp number",
	}) as HTMLInputElement;

function typePhone(value: string) {
	fireEvent.change(phoneInput(), { target: { value } });
}

function save() {
	fireEvent.click(screen.getByRole("button", { name: "Save & resend" }));
}

describe("BuyerPhoneRepairForm — the picker's default", () => {
	it("opens on the country of the number that failed", () => {
		// A buyer who typo'd a Japanese number most likely retypes a Japanese one.
		renderForm({ failedWaPhone: "819012345670", storeCountry: "MY" });
		expect(picker().value).toBe("JP");
	});

	it("an SG buyer at an MY store gets +65 back", () => {
		renderForm({ failedWaPhone: "6591234560", storeCountry: "MY" });
		expect(picker().value).toBe("SG");
	});

	it("falls back to the store's country when no number is held", () => {
		render(
			<BuyerPhoneRepairForm
				token="tok_abc"
				failedWaPhone={undefined}
				storeCountry="SG"
				locale="en"
				onSaved={() => {}}
				onCancel={() => {}}
			/>,
		);
		expect(picker().value).toBe("SG");
	});

	it("focuses the field — the buyer just tapped 'Update my number'", () => {
		renderForm();
		expect(document.activeElement).toBe(phoneInput());
	});
});

describe("BuyerPhoneRepairForm — saving", () => {
	it("a number the parser refuses can't be sent, and says why — disabled, not a dead click", () => {
		// Same rule as the counter's bind: the button is out while the number
		// can't be sent, and a line says what's missing. Nothing reaches the
		// server, so a typo never spends one of the 2-per-10-min tries.
		renderForm();
		typePhone("123");
		const button = screen.getByRole("button", {
			name: "Save & resend",
		}) as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		expect(
			screen.getByText("Finish your WhatsApp number to resend."),
		).toBeTruthy();
		save();
		expect(state.update).not.toHaveBeenCalled();

		// Enter asks to send, so it earns the precise reason — the disabled
		// button would otherwise swallow the key and answer nothing.
		fireEvent.keyDown(phoneInput(), { key: "Enter" });
		expect(
			screen.getByText(
				"Enter a Malaysian mobile number (e.g. 012-345 6789), or tap +60 to change the country",
			),
		).toBeTruthy();
		expect(phoneInput().getAttribute("aria-invalid")).toBe("true");
		// Inline, not a toast: the reason sits under the field it's about.
		expect(toast.error).not.toHaveBeenCalled();
	});

	it("an empty field asks for the number rather than complaining about it", () => {
		renderForm();
		expect(
			screen.getByText("Enter your WhatsApp number to resend."),
		).toBeTruthy();
		expect(
			(
				screen.getByRole("button", {
					name: "Save & resend",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});

	it("sends the picked country with the number", async () => {
		state.update.mockResolvedValue(null);
		const onSaved = vi.fn();
		renderForm({ failedWaPhone: "819012345670", onSaved });
		typePhone("90-1234-5678");
		save();
		await waitFor(() => expect(onSaved).toHaveBeenCalled());
		expect(state.update).toHaveBeenCalledWith({
			token: "tok_abc",
			waPhone: "90-1234-5678",
			waDialCountry: "JP",
		});
		expect(toast.success).toHaveBeenCalledWith(
			"Number updated — sending your confirmation now",
		);
	});

	it("the one-tap switch fixes an SG-shaped number at an MY store", async () => {
		state.update.mockResolvedValue(null);
		renderForm({ failedWaPhone: "60123456780", storeCountry: "MY" });
		typePhone("9123 4567");
		expect(
			screen.getByText(
				"That looks like a Singapore mobile number — switch the country to +65",
			),
		).toBeTruthy();
		const switchButton = screen.getByRole("button", {
			name: "Switch to Singapore (+65)",
		});
		switchButton.focus();
		fireEvent.click(switchButton);
		expect(picker().value).toBe("SG");
		// The button unmounts with the fix — focus lands back in the number,
		// not at the top of the page.
		expect(document.activeElement).toBe(phoneInput());
		save();
		await waitFor(() => expect(state.update).toHaveBeenCalled());
		expect(state.update.mock.calls[0]?.[0]).toMatchObject({
			waPhone: "9123 4567",
			waDialCountry: "SG",
		});
	});

	it("speaks the store's language on an ms store", () => {
		renderForm({ locale: "ms" });
		fireEvent.change(
			screen.getByRole("textbox", { name: "Nombor WhatsApp anda" }),
			{ target: { value: "9123 4567" } },
		);
		expect(
			screen.getByRole("button", { name: "Tukar ke Singapore (+65)" }),
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Simpan & hantar" }),
		).toBeTruthy();
	});

	it("what only the server knows stays a toast, and the form stays open", async () => {
		state.update.mockRejectedValue(
			new Error("That's the same number we already tried"),
		);
		const onSaved = vi.fn();
		renderForm({ onSaved });
		typePhone("12-345 6780");
		save();
		await waitFor(() => expect(toast.error).toHaveBeenCalled());
		expect(onSaved).not.toHaveBeenCalled();
		expect(phoneInput()).toBeTruthy();
	});
});
