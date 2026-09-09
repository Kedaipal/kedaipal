// @vitest-environment jsdom
// The button's label must follow the document's face (z8r3fdcrzj): a settled
// order offers a receipt, an unpaid one an INVOICE — the whole bug this fixes
// is three call sites hardcoding "receipt" while the PDF titled itself
// "Invoice", leaving the invoice feature undiscoverable.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isOrderDocPaid } from "../../../convex/lib/orderDocument";
import { ReceiptDownloadButton } from "./receipt-download-button";

// The PDF fetch goes through useAction — stub it so the button renders without
// a ConvexProvider (the label logic under test is purely client-side).
vi.mock("convex/react", () => ({ useAction: () => vi.fn() }));

afterEach(cleanup);

describe("ReceiptDownloadButton", () => {
	it("offers a RECEIPT for a settled order", () => {
		render(<ReceiptDownloadButton shortId="ORD-1" paid={true} />);
		expect(
			screen.getByRole("button", { name: /download receipt/i }),
		).toBeTruthy();
	});

	it("offers an INVOICE for an unpaid order", () => {
		render(<ReceiptDownloadButton shortId="ORD-1" paid={false} />);
		expect(
			screen.getByRole("button", { name: /download invoice/i }),
		).toBeTruthy();
		expect(screen.queryByText(/receipt/i)).toBeNull();
	});

	it("appends the PDF hint for the buyer tracking page", () => {
		render(<ReceiptDownloadButton token="tok" paid={false} pdfHint />);
		expect(
			screen.getByRole("button", { name: /download invoice \(PDF\)/i }),
		).toBeTruthy();
	});

	it("derives paid from the SAME predicate the PDF titles itself with", () => {
		// Guards the seam: if isOrderDocPaid ever drifts, this pins the button to
		// it rather than to a re-derived local check.
		render(
			<ReceiptDownloadButton
				shortId="ORD-1"
				paid={isOrderDocPaid("claimed")}
			/>,
		);
		// "claimed" is not settled — still a bill.
		expect(
			screen.getByRole("button", { name: /download invoice/i }),
		).toBeTruthy();
	});
});
