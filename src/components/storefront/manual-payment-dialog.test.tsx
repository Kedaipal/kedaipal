// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManualPaymentDialog } from "./manual-payment-dialog";

vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(cleanup);

describe("ManualPaymentDialog — payment method note (z8r3fdn2uj)", () => {
	it("makes a link in the seller's note tappable", () => {
		render(
			<ManualPaymentDialog
				open
				onClose={() => {}}
				token="tok"
				shortId="ORD-AB12"
				storeName="Kek Store"
				hasExistingClaim={false}
				methods={[
					{
						type: "bank",
						label: "Maybank",
						bankName: "Maybank",
						bankAccountName: "Kek Store",
						bankAccountNumber: "5140 1234 5678",
						note: "Prefer FPX? Pay at [our portal](https://pay.example/kek).",
						sortOrder: 0,
					},
				]}
			/>,
		);
		const link = screen.getByRole("link", { name: "our portal" });
		expect(link.getAttribute("href")).toBe("https://pay.example/kek");
		expect(link.getAttribute("target")).toBe("_blank");
	});
});
