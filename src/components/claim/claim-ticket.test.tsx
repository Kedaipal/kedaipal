// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ClaimTicket } from "./claim-ticket";

afterEach(cleanup);

const LONG_NAME =
	"World Salsita Festival KL Meals - 2026 Edition Hari Raya Special";

function renderTicket(
	lines: Array<{
		name: string;
		variantLabel?: string;
		quantity: number;
		price: number;
	}>,
) {
	return render(
		<ClaimTicket
			storeName="Sue Chef Kitchen"
			currency="MYR"
			lines={lines.map((l, i) => ({ variantId: `v${i}`, ...l }))}
			fulfilmentLabel="Delivery"
			fulfilmentAmount="after address"
			feeSettled={false}
			displayTotal={lines.reduce((n, l) => n + l.price * l.quantity, 0)}
		/>,
	);
}

/**
 * The claim ticket is the SECOND buyer Order Ticket. It shipped the same
 * truncated-label bug as the storefront one and the first fix's sweep missed
 * it (`z8r3fdhpaj`, PR review) — and here it was worse, because the quantity
 * sat LAST in the joined string, so truncation reached it first.
 */
describe("claim ticket — a long name keeps its variant AND its quantity", () => {
	it("leads with the quantity, prints the name in full, variant on its own line", () => {
		const { container } = renderTicket([
			{
				name: LONG_NAME,
				variantLabel: "Set B - Mee Goreng Mamak Special",
				quantity: 4,
				price: 1100,
			},
		]);
		expect(screen.getByText(`4× ${LONG_NAME}`)).toBeTruthy();
		expect(screen.getByText("Set B - Mee Goreng Mamak Special")).toBeTruthy();
		expect(screen.getByText("44.00")).toBeTruthy();
		// The shape that shipped the bug: `Name (Variant) ×4`, one truncated run.
		expect(container.textContent).not.toContain("(Set B");
		expect(container.textContent).not.toContain("×4 ");
	});

	it("does not truncate the item label", () => {
		const { container } = renderTicket([
			{ name: LONG_NAME, variantLabel: "Set A", quantity: 1, price: 1100 },
		]);
		const label = [...container.querySelectorAll("li span")].find((s) =>
			(s.textContent ?? "").startsWith("1× "),
		);
		expect(label).toBeTruthy();
		expect(label?.className).not.toContain("truncate");
		expect(label?.className).toContain("wrap-anywhere");
	});

	it("prints 1× on a single-quantity line, like the storefront ticket", () => {
		renderTicket([{ name: "Kek Batik", quantity: 1, price: 4500 }]);
		expect(screen.getByText("1× Kek Batik")).toBeTruthy();
	});

	it("still prints a variantless line without a stray sub-line", () => {
		const { container } = renderTicket([
			{ name: "Kek Batik", quantity: 2, price: 4500 },
		]);
		expect(screen.getByText("2× Kek Batik")).toBeTruthy();
		expect(container.querySelectorAll("li span.block").length).toBe(0);
	});
});
