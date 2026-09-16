// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { OrderTotal } from "./order-total";

afterEach(cleanup);

// formatPrice joins symbol and amount with a non-breaking space, so match on a
// permissive \\s — the idiom revenue-trend.test.tsx already uses.
const money = (s: string) => new RegExp(s.replace(/ /g, "\\s?"));

describe("OrderTotal", () => {
	test("an order with no deposit renders the total alone, exactly as before", () => {
		const { container } = render(<OrderTotal total={11_000} currency="MYR" />);
		expect(screen.getByText(money("RM 110\\.00"))).toBeTruthy();
		expect(container.textContent).not.toContain("deposit");
	});

	test("a zero deposit is the same as none — no empty note", () => {
		const { container } = render(
			<OrderTotal total={11_000} securityDeposit={0} currency="MYR" />,
		);
		expect(container.textContent).not.toContain("deposit");
	});

	test("a booking deposit is NAMED, and the headline stays what the buyer paid", () => {
		render(<OrderTotal total={11_000} securityDeposit={2_000} currency="MYR" />);
		// The bold figure must remain the transacted amount: it has to match the
		// receipt, the CSV Total column and the money that actually moved.
		expect(screen.getByText(money("RM 110\\.00"))).toBeTruthy();
		expect(
			screen.getByText(money("incl\\. RM 20\\.00 refundable deposit")),
		).toBeTruthy();
	});

	test("the net figure is NOT substituted for the total", () => {
		// Guards the design decision: showing RM90 here would put the card at odds
		// with the receipt and the bank transfer — the by-source leak in reverse.
		const { container } = render(
			<OrderTotal total={11_000} securityDeposit={2_000} currency="MYR" />,
		);
		expect(container.textContent).not.toMatch(money("RM 90\\.00"));
	});

	test("an SG store states both figures in its own currency", () => {
		render(<OrderTotal total={11_000} securityDeposit={2_000} currency="SGD" />);
		expect(screen.getByText(money("S\\$ 110\\.00"))).toBeTruthy();
		expect(
			screen.getByText(money("incl\\. S\\$ 20\\.00 refundable deposit")),
		).toBeTruthy();
	});

	test("the amount is exact, never compacted — a card total is reconciled against a bank line", () => {
		render(
			<OrderTotal total={1_240_050} securityDeposit={20_000} currency="MYR" />,
		);
		expect(screen.getByText(money("RM 12,400\\.50"))).toBeTruthy();
	});
});
