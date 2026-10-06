// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type PaymentProofEntry, PaymentProofList } from "./payment-proof-list";

afterEach(cleanup);

function entry(overrides: Partial<PaymentProofEntry> = {}): PaymentProofEntry {
	return {
		key: "k1",
		reference: "MBB2391",
		hasProof: true,
		url: "https://files.example/proof-1.png",
		submittedAt: Date.UTC(2026, 9, 3, 6, 14),
		isCurrent: true,
		borrowedReference: null,
		...overrides,
	};
}

/**
 * The regression this file exists to hold after z8r3fdnpxf: the amber card used
 * to read the ORDER's `paymentReference` — the LATEST value — while the green
 * card read the SUBMISSION the screenshot belongs to. A buyer who resubmitted a
 * corrected reference left the seller looking at one number while deciding and a
 * different one after the payment was in, with nothing saying which went with
 * the receipt on screen. Both cards now resolve it the same way.
 */
describe("PaymentProofList — the two cards agree on the reference", () => {
	it("states the same reference whichever card the seller is on", () => {
		const lead = entry({ reference: "MBB-998877" });
		const { unmount } = render(
			<PaymentProofList proofs={[lead]} tone="claimed" />,
		);
		expect(screen.getByText("MBB-998877")).toBeTruthy();
		unmount();

		render(<PaymentProofList proofs={[lead]} tone="received" />);
		expect(screen.getByText("MBB-998877")).toBeTruthy();
	});

	// The typo fix, end to end on the component: a correction the buyer sent
	// after the screenshot outranks the reference the screenshot came with, and
	// says where it came from — identically on both cards.
	it("shows a later correction over the lead's own, on both cards", () => {
		const lead = entry({
			reference: "DN-TYPO-001",
			borrowedReference: {
				reference: "DN-CORRECTED-999",
				submittedAt: Date.UTC(2026, 9, 3, 7, 0),
			},
		});
		for (const tone of ["claimed", "received"] as const) {
			const { unmount } = render(
				<PaymentProofList proofs={[lead]} tone={tone} />,
			);
			expect(screen.getByText("DN-CORRECTED-999")).toBeTruthy();
			expect(screen.queryByText("DN-TYPO-001")).toBeNull();
			expect(screen.getByText(/From their submission on/)).toBeTruthy();
			unmount();
		}
	});

	it("borrows the same earlier reference on both cards", () => {
		const lead = entry({
			reference: null,
			borrowedReference: {
				reference: "MBB-EARLIER",
				submittedAt: Date.UTC(2026, 9, 2, 6, 0),
			},
		});
		const { unmount } = render(
			<PaymentProofList proofs={[lead]} tone="claimed" />,
		);
		expect(screen.getByText("MBB-EARLIER")).toBeTruthy();
		expect(screen.getByText(/From their submission on/)).toBeTruthy();
		unmount();

		render(<PaymentProofList proofs={[lead]} tone="received" />);
		expect(screen.getByText("MBB-EARLIER")).toBeTruthy();
		expect(screen.getByText(/From their submission on/)).toBeTruthy();
	});
});

describe("PaymentProofList — claimed card", () => {
	it("states the submission's own reference and when it was sent", () => {
		render(<PaymentProofList proofs={[entry()]} tone="claimed" />);
		expect(screen.getByText("MBB2391")).toBeTruthy();
		expect(screen.getByText("Reference")).toBeTruthy();
		expect(screen.getByText("Submitted")).toBeTruthy();
		// Copyable here too — the seller pastes it into their bank app while
		// deciding, which is the moment they most need it.
		expect(
			screen.getByRole("button", { name: "Copy customer's payment reference" }),
		).toBeTruthy();
	});

	it("keeps the reference visible when no screenshot came with the claim", () => {
		render(
			<PaymentProofList
				proofs={[entry({ hasProof: false, url: null })]}
				tone="claimed"
			/>,
		);
		// Both halves: what they DID send, and what to do about the half they
		// didn't. Losing the reference here would leave nothing to reconcile by.
		expect(screen.getByText("MBB2391")).toBeTruthy();
		expect(
			screen.getByText(/No screenshot attached\. Cross-check the amount/),
		).toBeTruthy();
	});

	it("reads 'Not provided' when the buyer sent a screenshot and no reference", () => {
		render(
			<PaymentProofList proofs={[entry({ reference: null })]} tone="claimed" />,
		);
		expect(screen.getByText("Not provided")).toBeTruthy();
		expect(
			screen.queryByRole("button", {
				name: "Copy customer's payment reference",
			}),
		).toBeNull();
	});
});

describe("PaymentProofList — received card", () => {
	it("keeps the customer's screenshot and reference reachable", () => {
		render(<PaymentProofList proofs={[entry()]} tone="received" />);
		expect(screen.getByText("Customer's proof")).toBeTruthy();
		expect(screen.getByText("MBB2391")).toBeTruthy();
		const open = screen.getByRole("link", { name: /open full size/i });
		expect(open.getAttribute("href")).toBe("https://files.example/proof-1.png");
		expect(open.getAttribute("target")).toBe("_blank");
		expect(
			screen.getByRole("button", { name: "Copy customer's payment reference" }),
		).toBeTruthy();
		// One submission: no history row to click into.
		expect(
			screen.queryByRole("button", { name: /other submissions/i }),
		).toBeNull();
	});

	it("renders nothing when the buyer never sent anything", () => {
		const { container } = render(
			<PaymentProofList proofs={[]} tone="received" />,
		);
		expect(container.innerHTML).toBe("");
	});

	it("says so when the screenshot file is gone, instead of a broken image", () => {
		render(
			<PaymentProofList proofs={[entry({ url: null })]} tone="received" />,
		);
		expect(screen.getByText("Screenshot no longer available.")).toBeTruthy();
		expect(screen.queryByRole("link", { name: /open full size/i })).toBeNull();
	});

	it("a reference-only submission says there's no screenshot", () => {
		render(
			<PaymentProofList
				proofs={[entry({ hasProof: false, url: null })]}
				tone="received"
			/>,
		);
		expect(screen.getByText("No screenshot attached.")).toBeTruthy();
	});

	it("a screenshot-only lead shows the reference the buyer sent earlier, labelled", () => {
		render(
			<PaymentProofList
				proofs={[
					entry({
						reference: null,
						borrowedReference: {
							reference: "MBB-123",
							submittedAt: Date.UTC(2026, 9, 2, 6, 0),
						},
					}),
				]}
				tone="received"
			/>,
		);
		expect(screen.getByText("MBB-123")).toBeTruthy();
		expect(screen.getByText(/From their submission on/)).toBeTruthy();
		expect(screen.queryByText("Not provided")).toBeNull();
	});

	it("an empty reference reads 'Not provided' and offers no copy", () => {
		render(
			<PaymentProofList
				proofs={[entry({ reference: null })]}
				tone="received"
			/>,
		);
		expect(screen.getByText("Not provided")).toBeTruthy();
		expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
	});
});

describe("PaymentProofList — other submissions", () => {
	const proofs = [
		entry({
			key: "new",
			reference: "REF-NEW",
			hasProof: false,
			url: null,
			isCurrent: false,
		}),
		entry({ key: "lead", reference: "REF-LEAD" }),
		entry({
			key: "old",
			reference: "REF-OLD",
			url: "https://files.example/proof-0.png",
			isCurrent: false,
		}),
	];

	it("collapses everything but the lead behind one counted toggle", () => {
		render(<PaymentProofList proofs={proofs} tone="received" />);
		const toggle = screen.getByRole("button", {
			name: "Other submissions (2)",
		});
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		expect(screen.queryByText("REF-OLD")).toBeNull();

		fireEvent.click(toggle);
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByText("REF-NEW")).toBeTruthy();
		expect(screen.getByText("REF-OLD")).toBeTruthy();
		// The earlier screenshot is still one tap away.
		const oldLink = screen
			.getAllByRole("link")
			.find(
				(a) => a.getAttribute("href") === "https://files.example/proof-0.png",
			);
		expect(oldLink).toBeTruthy();
	});

	it("the claimed card gets the same history under its large preview", () => {
		render(<PaymentProofList proofs={proofs} tone="claimed" />);
		expect(screen.getByRole("img", { name: "Payment receipt" })).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Other submissions (2)" }),
		).toBeTruthy();
	});
});

describe("PaymentProofList — claimed card", () => {
	it("asks the seller to cross-check when no screenshot came with the claim", () => {
		render(<PaymentProofList proofs={[]} tone="claimed" />);
		expect(screen.getByText(/No screenshot attached/)).toBeTruthy();
	});

	it("opens the lead screenshot full size", () => {
		render(<PaymentProofList proofs={[entry()]} tone="claimed" />);
		const link = screen.getByRole("link", {
			name: "Open payment screenshot full size",
		});
		expect(link.getAttribute("href")).toBe("https://files.example/proof-1.png");
	});
});
