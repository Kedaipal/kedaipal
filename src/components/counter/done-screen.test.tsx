// @vitest-environment jsdom
import { useQuery } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DoneScreen, type DoneScreenProps } from "./done-screen";

// Reads go via `useQuery(convexQuery(api.x, args)).data` — mock the adapter
// pair (billing-tab.test.tsx harness). `order` is what the seller read returns.
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn() }));
const state = vi.hoisted(() => ({
	updateStatus: vi.fn(async () => undefined),
	shareLink: vi.fn(async () => undefined),
}));
vi.mock("convex/react", () => ({
	useMutation: () => state.updateStatus,
	// OrderDocumentActions fetches the PDF via useAction.
	useAction: () => vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: React.ReactNode }) => (
		<a href="#order">{children}</a>
	),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../lib/share", () => ({ shareLink: state.shareLink }));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

type Order = {
	status: string;
	paymentStatus?: string;
	total: number;
	currency: string;
	trackingToken?: string;
	confirmationPushStatus?: string;
	confirmationPushFailureKind?: string;
	fulfilmentDate?: number;
};

function order(overrides: Partial<Order> = {}): Order {
	return {
		status: "delivered",
		paymentStatus: "received",
		total: 3000,
		currency: "MYR",
		trackingToken: "tok_ABC123",
		confirmationPushStatus: "sent",
		...overrides,
	};
}

function renderDone(
	data: Order | null | undefined,
	props: Partial<DoneScreenProps> = {},
) {
	vi.mocked(useQuery).mockReturnValue({ data } as never);
	return render(
		<DoneScreen
			shortId="ORD-AB12"
			orderId={"o1" as never}
			paidInPerson
			completed
			buyerName="Aiman"
			onBackToList={() => {}}
			{...props}
		/>,
	);
}

/**
 * The Done screen's two jobs: say the sale is COMPLETE (not "created" — the
 * buyer already left with the goods), and say what really happened to their
 * WhatsApp, with the link in hand when it didn't arrive.
 */
describe("DoneScreen — a handed-over sale reads complete", () => {
	it("paid + sent: 'Sale complete', 'complete and paid', the buyer has their link, no close button", () => {
		renderDone(order());
		expect(screen.getByRole("heading", { name: "Sale complete" })).toBeTruthy();
		expect(screen.getByText(/is complete and paid\./)).toBeTruthy();
		expect(screen.getByText(/has their order link on WhatsApp/)).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: /Mark as completed/ }),
		).toBeNull();
		// Paid → it's a receipt, not an invoice.
		expect(screen.getByText("Receipt")).toBeTruthy();
	});

	it("pay-later + sent: complete with the amount still to pay, and the message said how", () => {
		renderDone(order({ paymentStatus: "unpaid" }), { paidInPerson: false });
		expect(
			screen.getByText(/is complete — RM ?30\.00 still to pay\./),
		).toBeTruthy();
		expect(screen.getByText(/with how to pay\./)).toBeTruthy();
		expect(screen.getByText("Invoice")).toBeTruthy();
	});

	it("the heading is right before the order query resolves (the mutation's answer), and no outcome is claimed yet", () => {
		renderDone(undefined, { completed: true });
		expect(screen.getByRole("heading", { name: "Sale complete" })).toBeTruthy();
		expect(screen.getByText(/Sending/)).toBeTruthy();
		expect(screen.queryByText(/has their order link/)).toBeNull();
	});
});

describe("DoneScreen — the buyer's WhatsApp outcome is read, never assumed", () => {
	it("sending: a live status, not a claim", () => {
		renderDone(order({ confirmationPushStatus: "sending" }));
		const row = screen.getByText(/their order link on WhatsApp…/).closest("p");
		expect(row?.getAttribute("aria-live")).toBe("polite");
		expect(screen.getByText(/^Sending/)).toBeTruthy();
	});

	it("failed on our side: says the number is fine, and hands the cashier the link to share or copy", () => {
		renderDone(
			order({
				paymentStatus: "unpaid",
				confirmationPushStatus: "failed",
				confirmationPushFailureKind: "system",
			}),
			{ paidInPerson: false },
		);
		expect(screen.getByText(/WhatsApp couldn.t reach Aiman/)).toBeTruthy();
		expect(screen.getByText(/their number looks fine/)).toBeTruthy();
		// Unpaid → the link is how they pay, and the screen says so.
		expect(screen.getByText(/it's how they pay/)).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: /Share link/ }));
		expect(state.shareLink).toHaveBeenCalledWith(
			expect.stringMatching(/\/track\/tok_ABC123$/),
		);
		expect(
			screen.getByRole("button", { name: "Copy the buyer's order link" }),
		).toBeTruthy();
	});

	it("failed on the number: asks the cashier to check it, never blames us", () => {
		renderDone(
			order({
				confirmationPushStatus: "failed",
				confirmationPushFailureKind: "unreachable",
			}),
		);
		expect(screen.getByText(/typo or no WhatsApp/)).toBeTruthy();
		expect(screen.queryByText(/our side/)).toBeNull();
	});

	it("anonymous cash sale: nothing was sent, and the document is their only copy", () => {
		renderDone(order({ confirmationPushStatus: undefined }), {
			anonymous: true,
			buyerName: undefined,
		});
		expect(screen.getByText(/nothing was sent/)).toBeTruthy();
		expect(screen.getByText(/receipt below is their only copy/)).toBeTruthy();
		expect(screen.queryByText(/Sending/)).toBeNull();
	});

	it("a reopened session whose order can't be read claims nothing it can't know — not even the close button", () => {
		renderDone(undefined, { shortId: undefined, completed: false });
		expect(
			screen.getByRole("heading", { name: "Checkout saved" }),
		).toBeTruthy();
		expect(screen.getByText(/open it for its status/)).toBeTruthy();
		expect(screen.queryByText(/has their order link/)).toBeNull();
		expect(screen.queryByText(/^Sending/)).toBeNull();
		expect(screen.queryByText("Receipt")).toBeNull();
		expect(
			screen.queryByRole("button", { name: /Mark as completed/ }),
		).toBeNull();
	});
});

describe("DoneScreen — a sale that is NOT handed over yet stays open", () => {
	const later = Date.UTC(2026, 9, 20) - 8 * 3600_000; // 20 Oct 2026, MYT midnight

	it("a collection dated for later: 'Order created', says when, keeps the one-tap close with its reason", async () => {
		renderDone(order({ status: "confirmed", fulfilmentDate: later }), {
			completed: false,
		});
		expect(screen.getByRole("heading", { name: "Order created" })).toBeTruthy();
		expect(screen.getByText(/collecting .*20 Oct/)).toBeTruthy();
		expect(screen.getByText(/stays open until it's handed over/)).toBeTruthy();
		expect(
			screen.getByText(/Collecting later — mark it completed/),
		).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: /Mark as completed/ }));
		expect(state.updateStatus).toHaveBeenCalledWith({
			orderId: "o1",
			status: "delivered",
		});
	});

	it("an RSVP rung up at the counter: completes at the event, so no close button here", () => {
		renderDone(order({ status: "confirmed" }), {
			completed: false,
			eventRsvp: true,
		});
		expect(screen.getByRole("heading", { name: "RSVP saved" })).toBeTruthy();
		expect(screen.getByText(/checks in at the event/)).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: /Mark as completed/ }),
		).toBeNull();
	});
});
