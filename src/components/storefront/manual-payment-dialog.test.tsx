// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManualPaymentDialog } from "./manual-payment-dialog";

vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(cleanup);

const METHODS = [
	{
		type: "bank" as const,
		label: "Maybank",
		bankName: "Maybank",
		bankAccountName: "Kek Store",
		bankAccountNumber: "5140 1234 5678",
		sortOrder: 0,
	},
];

function open(
	overrides: Partial<React.ComponentProps<typeof ManualPaymentDialog>> = {},
) {
	return render(
		<ManualPaymentDialog
			open
			onClose={() => {}}
			token="tok"
			shortId="ORD-AB12"
			storeName="Kek Store"
			hasExistingClaim={false}
			hasExistingProof={false}
			locale="en"
			methods={METHODS}
			{...overrides}
		/>,
	);
}

describe("ManualPaymentDialog — payment method note (z8r3fdn2uj)", () => {
	it("makes a link in the seller's note tappable", () => {
		open({
			methods: [
				{
					...METHODS[0],
					note: "Prefer FPX? Pay at [our portal](https://pay.example/kek).",
				},
			],
		});
		const link = screen.getByRole("link", { name: "our portal" });
		expect(link.getAttribute("href")).toBe("https://pay.example/kek");
		expect(link.getAttribute("target")).toBe("_blank");
	});
});

describe("ManualPaymentDialog — the screenshot is mandatory (z8r3fdnpxf)", () => {
	it("puts the screenshot above the reference number", () => {
		open();
		const proof = screen.getByText("Payment screenshot");
		const reference = screen.getByText("Reference number");
		// DOCUMENT_POSITION_FOLLOWING (4): the reference comes after the proof.
		// The whole reason buyers skipped the attachment was that it sat last.
		expect(
			proof.compareDocumentPosition(reference) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it("marks the screenshot required and the reference optional", () => {
		open();
		expect(screen.getByText("(optional)")).toBeTruthy();
		// The requirement rides the LABEL the file input is bound to — a file
		// input takes no `aria-required` — so a screen reader announces
		// "Payment screenshot (required)" when it reaches the control.
		const marker = screen.getByText("(required)");
		expect(marker.closest("label")?.getAttribute("for")).toBe("payment-proof");
	});

	it("holds the submit and says why, before the tap", () => {
		open();
		const submit = screen.getByRole("button", { name: "I've paid" });
		expect(submit).toHaveProperty("disabled", true);
		// Disabled-with-reason: a buyer who can't submit must never have to guess
		// which field is the problem.
		expect(
			screen.getByText("Attach your payment screenshot to continue."),
		).toBeTruthy();
	});

	it("offers a way out when the buyer has no screenshot to attach", () => {
		open({ storeWaPhone: "+60123456789" });
		const wayOut = screen.getByRole("link", {
			name: /Can't attach one\? Message Kek Store on WhatsApp\./,
		});
		// A mandatory field with no alternative is a dead end — the seller can
		// always mark the payment received by hand.
		expect(wayOut.getAttribute("href")).toContain("wa.me/60123456789");
		expect(wayOut.getAttribute("href")).toContain("ORD-AB12");
	});

	it("still names the way out when the store has no number to open", () => {
		open();
		expect(screen.queryByRole("link", { name: /Can't attach one/ })).toBeNull();
		expect(screen.getByText(/Can't attach one\?/)).toBeTruthy();
	});
});

describe("ManualPaymentDialog — a resubmit on a verified order", () => {
	it("doesn't ask again for a screenshot the store already has", () => {
		open({ hasExistingClaim: true, hasExistingProof: true });
		expect(screen.queryByText("(required)")).toBeNull();
		expect(
			screen.getByText(/The store already has your screenshot/),
		).toBeTruthy();
		// No dead-end escape line either: nothing is being demanded.
		expect(screen.queryByText(/Can't attach one\?/)).toBeNull();
	});

	it("holds an empty resubmit, naming what would make it a change", () => {
		open({ hasExistingClaim: true, hasExistingProof: true });
		expect(screen.getByRole("button", { name: "Update" })).toHaveProperty(
			"disabled",
			true,
		);
		expect(
			screen.getByText(
				"Attach a new screenshot or add a reference number to update.",
			),
		).toBeTruthy();
	});
});

describe("ManualPaymentDialog — Malay store", () => {
	it("renders the whole sheet in Malay, not just the new strings", () => {
		open({ locale: "ms", storeWaPhone: "+60123456789" });
		// One from each region of the sheet: the title, the methods step, the
		// mandatory attachment, the reference, the submit and its held reason.
		expect(screen.getByText("Bayar Kek Store")).toBeTruthy();
		expect(screen.getByText("1 · Bayar guna mana-mana ini")).toBeTruthy();
		expect(screen.getByText("Nombor akaun")).toBeTruthy();
		expect(screen.getByText("Tangkapan skrin pembayaran")).toBeTruthy();
		expect(screen.getByText("(wajib)")).toBeTruthy();
		expect(screen.getByText("Nombor rujukan")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Saya sudah bayar" }),
		).toBeTruthy();
		expect(
			screen.getByText(
				"Lampirkan tangkapan skrin pembayaran anda untuk teruskan.",
			),
		).toBeTruthy();
		expect(screen.getByText(/Tak boleh lampirkan\?/)).toBeTruthy();
	});
});
