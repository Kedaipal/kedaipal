// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { formatPrice, formatPriceCompact } from "../../lib/format";
import { DepositNote } from "./deposit-note";

afterEach(cleanup);

// formatPrice joins symbol and amount with a non-breaking space; testing-library
// normalises it to a plain space in the DOM text, so expected copy is normalised
// the same way.
const shown = (s: string) => s.replace(/ /g, " ");

describe("DepositNote", () => {
	test("renders nothing when the window excluded no deposit", () => {
		const { container } = render(
			<DepositNote depositsExcluded={0} currency="MYR" />,
		);
		// A store without booking deposits must see the page it always saw — not
		// an empty box, and not a zero.
		expect(container.innerHTML).toBe("");
	});

	test("a negative figure is treated as nothing to say, never rendered", () => {
		const { container } = render(
			<DepositNote depositsExcluded={-1} currency="MYR" />,
		);
		expect(container.innerHTML).toBe("");
	});

	test("states the amount, that it covers the whole page, and where a kept deposit lives", () => {
		render(<DepositNote depositsExcluded={10_000} currency="MYR" />);
		expect(screen.getByText(shown(formatPrice(10_000, "MYR")))).toBeTruthy();
		// The three things the note has to carry, each checked on its own so a
		// copy edit that drops one fails here rather than in front of a seller.
		const body = document.body.textContent ?? "";
		expect(body).toContain("every figure on this page");
		expect(body).toContain("held money, not sales");
		expect(body).toContain("recorded on the order");
	});

	test("a large total is exact, never compacted — this is the only copy of the figure", () => {
		// RM 12,400.50. The tiles would render this as "RM 12,401" and pair it with
		// a full-precision hover; the note has no hover to fall back on, so it must
		// print the exact amount.
		render(<DepositNote depositsExcluded={1_240_050} currency="MYR" />);
		expect(screen.getByText(shown(formatPrice(1_240_050, "MYR")))).toBeTruthy();
		expect(document.body.textContent).not.toContain(
			shown(formatPriceCompact(1_240_050, "MYR")),
		);
	});

	test("an SG store states the amount in its own currency", () => {
		render(<DepositNote depositsExcluded={5_000} currency="SGD" />);
		expect(screen.getByText(shown(formatPrice(5_000, "SGD")))).toBeTruthy();
	});

	test("carries no hover-only copy — the explanation must be on screen", () => {
		// The ticket asked for a `title` tooltip. On a phone that is mute, and this
		// page's own trend chart is a scrubber for exactly that reason. Pinned so
		// nobody reintroduces a hover as the carrier of the reason.
		const { container } = render(
			<DepositNote depositsExcluded={10_000} currency="MYR" />,
		);
		expect(container.querySelectorAll("[title]")).toHaveLength(0);
	});
});
