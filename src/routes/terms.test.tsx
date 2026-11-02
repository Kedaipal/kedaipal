// @vitest-environment jsdom
// The Terms' two new sections (Credits T5, z8r3fdfu31) — drafted for Arif's
// or a lawyer's sign-off. Pinned here: the anchors other surfaces link to
// (the top-up picker links /terms#credits; the data section links the Privacy
// Policy's processor list), the numbering, and that each credits clause
// states the mechanic the ledger actually enforces, from its constant.
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	PURCHASED_CREDIT_LIFETIME_MONTHS,
	SELLER_CANCEL_REFUNDS_PER_PERIOD,
} from "../../convex/lib/plans";
import { PRIVACY_ANCHOR, TERMS_ANCHOR, TERMS_VERSION } from "../lib/legal";

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (opts: Record<string, unknown>) => ({
		...opts,
		options: opts,
	}),
	Link: ({
		children,
		to,
		hash,
		className,
	}: {
		children: ReactNode;
		to: string;
		hash?: string;
		className?: string;
	}) => (
		<a href={`${to}${hash ? `#${hash}` : ""}`} className={className}>
			{children}
		</a>
	),
}));

const terms = await import("./terms");
const privacy = await import("./privacy");

afterEach(cleanup);

function renderRoute(route: typeof terms.Route | typeof privacy.Route) {
	const Page = route.options.component;
	if (!Page) throw new Error("route has no component");
	return render(<Page />);
}

describe("/terms — Kedaipal Credits + Data Processing", () => {
	it("is versioned at the bump that re-asks every owner to accept", () => {
		renderRoute(terms.Route);
		expect(screen.getByText(`Last updated: ${TERMS_VERSION}`)).toBeTruthy();
		expect(TERMS_VERSION).toBe("2026-09-30");
	});

	it("numbers every section once, in order — the new ones placed by meaning", () => {
		renderRoute(terms.Route);
		const headings = screen
			.getAllByRole("heading", { level: 2 })
			.map((h) => h.textContent ?? "");
		for (const [i, h] of headings.entries()) {
			expect(h.startsWith(`${i + 1}. `), h).toBe(true);
		}
		expect(headings[4]).toBe("5. Kedaipal Credits");
		expect(headings[6]).toBe("7. Data Processing");
	});

	it("anchors the credits section where the top-up picker links", () => {
		renderRoute(terms.Route);
		const section = document.getElementById(TERMS_ANCHOR.credits);
		expect(section).not.toBeNull();
		const text = section?.textContent ?? "";
		for (const clause of [
			"One credit covers one order",
			"Credits are not money, e-money or stored value",
			"cannot be transferred, sold or moved to another account",
			"never to pay for a third party's service",
			"reset at the start of each calendar month",
			`expire ${PURCHASED_CREDIT_LIFETIME_MONTHS} months after purchase`,
			`up to ${SELLER_CANCEL_REFUNDS_PER_PERIOD} such cancellations a month`,
			"An order you have accepted keeps its credit",
			"We never refuse an order because of your balance",
			"never rejects or blocks a buyer's order",
			"Viewing orders, cancelling and refunding them, topping up and upgrading your plan are never restricted",
			"lifts as soon as your balance is above zero",
			// Packs never auto-reload (T4 cancelled, 1 Oct 2026): the saved card
			// is never charged for credits, and the Terms say so.
			"We never charge your saved payment method for credits",
			"credits are never bought automatically",
			"30 days' notice",
		]) {
			expect(text, clause).toContain(clause);
		}
		expect(text).not.toMatch(/Automatic top-up|merchant-initiated/i);
		// No banned vocabulary in the clause the seller reads.
		expect(text).not.toMatch(/wallet|pay[- ]as[- ]you[- ]go|commission/i);
	});

	it("names the processor roles and links the Privacy Policy's list, never inventing vendors", () => {
		renderRoute(terms.Route);
		const section = document.getElementById(TERMS_ANCHOR.dataProcessing);
		expect(section).not.toBeNull();
		if (!section) return;
		expect(section.textContent).toContain("You are the controller");
		expect(section.textContent).toContain("data intermediary");
		expect(section.textContent).toContain("without undue delay");
		expect(section.textContent).toContain("Kedaipal Pte Ltd");
		const list = within(section)
			.getAllByRole("link")
			.map((a) => a.getAttribute("href"));
		expect(list).toContain(`/privacy#${PRIVACY_ANCHOR.processors}`);
	});
});

describe("/privacy — the processor list the Terms link to", () => {
	it("carries the anchor", () => {
		renderRoute(privacy.Route);
		const section = document.getElementById(PRIVACY_ANCHOR.processors);
		expect(section?.textContent).toContain(
			"How We Share Information (Data Processors)",
		);
	});
});
