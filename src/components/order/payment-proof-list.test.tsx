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
