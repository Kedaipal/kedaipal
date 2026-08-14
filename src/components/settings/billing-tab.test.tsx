// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { useQuery } from "convex/react";
import { type FunctionReference, getFunctionName } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../convex/_generated/api";
import { DEFAULT_SUPPORT_WA_NUMBER } from "../../lib/contact";
import { BillingTab } from "./billing-tab";

// Auto-mock convex/react so we can drive each useQuery by its function reference.
vi.mock("convex/react");

afterEach(cleanup);

type Retailer = Parameters<typeof BillingTab>[0]["retailer"];

/** Minimal retailer payload for the billing tab — a real (non-comped) Pro store
 * that's past due, matching the screenshot the fix targets. */
function retailer(overrides: Partial<Retailer> = {}): Retailer {
	return {
		slug: "openmarket",
		isFoundingMember: false,
		ordersThisMonth: 0,
		subscription: {
			plan: "pro",
			status: "past_due",
			comped: false,
			caps: { orderCap: 500, userCap: 3, broadcastQuota: 0 },
			features: { crm: true, orderInbox: true, chargeablePickup: true },
			active: false,
			frozen: true,
		},
		...overrides,
	} as unknown as Retailer;
}

/** A number that is deliberately NOT the built-in default, so an assertion
 * against it proves the link followed the configured value. */
const CONFIGURED_WA = "60111111111";

/** Wire the four useQuery calls the tab makes, keyed by function name (the
 * generated `api` proxy hands back a fresh reference per access, so `===` on the
 * reference itself is unreliable — match on the stable name instead). */
function mockQueries({
	isAdmin,
	// `null` = the query hasn't resolved (SSR / first paint), which reaches the
	// component as `undefined`. Passing `undefined` here can't express that —
	// the destructuring default would swallow it.
	supportWa = CONFIGURED_WA,
}: {
	isAdmin: boolean;
	supportWa?: string | null;
}) {
	const NAME = {
		amIAdmin: getFunctionName(api.billing.amIAdmin),
		invoices: getFunctionName(api.invoices.myInvoices),
		instructions: getFunctionName(api.billing.paymentInstructions),
		supportWa: getFunctionName(api.contact.supportWhatsapp),
	};
	vi.mocked(useQuery).mockImplementation(((ref: FunctionReference<"query">) => {
		const name = getFunctionName(ref);
		if (name === NAME.amIAdmin) return isAdmin;
		if (name === NAME.invoices) return [];
		// Bank/DuitNow details only — the support number has its own query.
		if (name === NAME.instructions) return { bankName: "Maybank" };
		if (name === NAME.supportWa) return supportWa ?? undefined;
		return undefined;
	}) as unknown as typeof useQuery);
}

/** Every wa.me href the tab renders. */
function waLinks(): string[] {
	return screen
		.getAllByRole("link")
		.map((a) => a.getAttribute("href") ?? "")
		.filter((href) => href.startsWith("https://wa.me/"));
}

describe("BillingTab admin plan suppression", () => {
	it("shows the tier + past-due status to a normal seller", () => {
		mockQueries({ isAdmin: false });
		render(<BillingTab retailer={retailer()} />);
		expect(screen.getByText("Current plan")).toBeTruthy();
		expect(screen.getByText("Pro")).toBeTruthy();
		expect(screen.getByText("Past due")).toBeTruthy();
		expect(screen.queryByText("Admin account")).toBeNull();
	});

	it("hides the plan/tier card for an admin on their own store", () => {
		mockQueries({ isAdmin: true });
		render(<BillingTab retailer={retailer()} />);
		expect(screen.getByText("Admin account")).toBeTruthy();
		// No tier, status badge or renew nudge — admins aren't on a plan.
		expect(screen.queryByText("Current plan")).toBeNull();
		expect(screen.queryByText("Past due")).toBeNull();
		expect(screen.queryByText("Renew your subscription")).toBeNull();
	});

	it("keeps the seller's real plan visible while an admin acts-as", () => {
		mockQueries({ isAdmin: true });
		render(<BillingTab retailer={retailer({ actingAsAdmin: true })} />);
		// White-glove support must see + manage the seller's actual billing.
		expect(screen.getByText("Current plan")).toBeTruthy();
		expect(screen.getByText("Past due")).toBeTruthy();
		expect(screen.queryByText("Admin account")).toBeNull();
	});
});

describe("BillingTab support WhatsApp number", () => {
	/** ClickUp 86eyjuvyu: every seller→Kedaipal CTA must reach the number an
	 * operator configured (`SUPPORT_WA_PHONE`), never the buyer-facing WABA
	 * checkout sender (`WHATSAPP_CHECKOUT_PHONE`) and never a hardcoded value. */
	it("points every WhatsApp CTA at the configured support number", () => {
		mockQueries({ isAdmin: false });
		render(<BillingTab retailer={retailer()} />);
		const links = waLinks();
		expect(links.length).toBeGreaterThan(0);
		for (const href of links) {
			expect(href.startsWith(`https://wa.me/${CONFIGURED_WA}?`)).toBe(true);
		}
	});

	it("falls back to the default number before the query resolves", () => {
		// SSR and first paint have no answer yet; the CTA must still be live.
		mockQueries({ isAdmin: false, supportWa: null });
		render(<BillingTab retailer={retailer()} />);
		const links = waLinks();
		expect(links.length).toBeGreaterThan(0);
		for (const href of links) {
			expect(
				href.startsWith(`https://wa.me/${DEFAULT_SUPPORT_WA_NUMBER}?`),
			).toBe(true);
		}
	});

	it("renders the support card even with no billing config", () => {
		// The CTA used to hang off a server-provided phone, so an unset env var
		// silently removed the seller's only way to reach us.
		vi.mocked(useQuery).mockImplementation(((
			ref: FunctionReference<"query">,
		) => {
			const name = getFunctionName(ref);
			if (name === getFunctionName(api.invoices.myInvoices)) return [];
			if (name === getFunctionName(api.billing.paymentInstructions))
				return null;
			return false;
		}) as unknown as typeof useQuery);
		render(<BillingTab retailer={retailer()} />);
		expect(screen.getByText("Contact support on WhatsApp")).toBeTruthy();
	});
});
