// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import type { CreditGateView } from "../../hooks/useCreditGate";
import { GatedOrderPage } from "./gated-order-page";

// Reads go via the adapter pair (docs/frontend-caching.md) — mocked by shape,
// since the only read on this page is the cancel dialog's credit outlook and
// the dialog is closed in every case below.
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: null }) }));
vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		children,
		...props
	}: Record<string, unknown> & { children?: React.ReactNode }) => (
		<a href={String(to)} {...props}>
			{children}
		</a>
	),
}));

const gate = { ordersWaiting: 1, canAct: true };
vi.mock("../../hooks/useCreditGate", () => ({
	useCreditGate: (): CreditGateView =>
		({
			anyWaiting: gate.ordersWaiting > 0,
			ordersWaiting: gate.ordersWaiting,
			canAct: gate.canAct,
			route: "topup",
			isMember: false,
			fundedThrough: 0,
			reason: "",
			gatesOrder: () => true,
			creditsToUnlock: () => 1,
		}) as unknown as CreditGateView,
}));

afterEach(() => {
	gate.ordersWaiting = 1;
	gate.canAct = true;
	cleanup();
});

// 8 Oct 2026, MYT midnight — a WHOLE-DAY fulfilment date, which is how every
// dateless-time order is stored (`fulfilmentTimeMinutes` stays undefined).
const OCT_8 = Date.parse("2026-10-08T00:00:00+08:00");

function order(over: Record<string, unknown> = {}) {
	return {
		_id: "ord1" as Id<"orders">,
		shortId: "ORD-94BV",
		createdAt: Date.parse("2026-10-07T10:30:00+08:00"),
		total: 12000,
		currency: "MYR",
		creditsToUnlock: 1,
		status: "pending",
		deliveryMethod: "self_collect",
		fulfilmentDate: OCT_8,
		...over,
	};
}

function fact(label: string): string {
	// <dl> of <dt>/<dd> pairs — the value is the dt's next sibling.
	const dt = screen.getByText(label);
	return dt.nextElementSibling?.textContent ?? "";
}

describe("GatedOrderPage — fulfilment", () => {
	// THE regression. `formatOrderTimestamp` on a whole-day fulfilment date
	// rendered "8 Oct, 12:00 am": a midnight pickup the buyer never asked for,
	// on the one screen whose entire job is to be honest about what it can
	// show. The date is stored at MYT midnight with the time (when there is
	// one) in a separate field, so only `formatFulfilmentDateTime` can read it.
	test("a whole-day date shows no time", () => {
		render(<GatedOrderPage order={order()} />);
		expect(fact("Fulfilment")).toBe("8 Oct 2026");
		expect(fact("Fulfilment")).not.toMatch(/12:00|am|pm/i);
	});

	test("a date WITH a time shows it", () => {
		// 14:30 → the buyer picked a slot, so the slot is the fact.
		render(
			<GatedOrderPage order={order({ fulfilmentTimeMinutes: 14 * 60 + 30 })} />,
		);
		expect(fact("Fulfilment")).toBe("8 Oct 2026 · 2:30 PM");
	});

	test("no date at all is a dash, and a booking says so", () => {
		render(<GatedOrderPage order={order({ fulfilmentDate: undefined })} />);
		expect(fact("Fulfilment")).toBe("—");
		cleanup();
		render(
			<GatedOrderPage
				order={order({ fulfilmentDate: undefined, deliveryMethod: "booking" })}
			/>,
		);
		expect(fact("Fulfilment")).toBe("Booking");
	});
});

describe("GatedOrderPage — what survives the redaction", () => {
	test("the reference, the money and when it arrived", () => {
		render(<GatedOrderPage order={order()} />);
		expect(fact("Order")).toBe("#ORD-94BV");
		// `formatPrice` joins with a non-breaking space.
		expect(fact("Total").replace(/\u00a0/g, " ")).toBe("RM 120.00");
		expect(fact("Arrived")).not.toBe("");
	});

	test("status is only a fact when it carries something new", () => {
		// A gated order the seller can't move is always "new", so a Status fact
		// would never vary — except for a request, which is a decision they can
		// still make (declining is never gated).
		render(<GatedOrderPage order={order()} />);
		expect(screen.queryByText("Status")).toBeNull();
		cleanup();
		render(<GatedOrderPage order={order({ status: "booking_requested" })} />);
		expect(fact("Status")).toBe("Awaiting your answer");
	});
});

describe("GatedOrderPage — cancelled", () => {
	// A cancelled gated order kept the live headline and both buttons: it read
	// "Waiting on 1 credit" and offered "Cancel and tell the buyer" on an order
	// already cancelled. The redaction is seq-based and survives the cancel by
	// design, so `creditGated` stays true — the PAGE has to know better.
	const cancelled = () => order({ status: "cancelled" });

	test("says it is cancelled, not that it is waiting", () => {
		render(<GatedOrderPage order={cancelled()} />);
		expect(screen.getByRole("heading").textContent).toBe("Cancelled");
		expect(screen.queryByText(/Waiting on 1 credit/)).toBeNull();
	});

	test("offers neither spent control", () => {
		render(<GatedOrderPage order={cancelled()} />);
		expect(screen.queryByText("Cancel and tell the buyer")).toBeNull();
		expect(screen.queryByText("Top up credits")).toBeNull();
	});

	test("a LIVE order offers both", () => {
		render(<GatedOrderPage order={order()} />);
		expect(screen.getByText("Cancel and tell the buyer")).toBeTruthy();
		expect(screen.getByText("Top up credits")).toBeTruthy();
	});

	test("the buyer is named as told, so the seller knows to stop chasing", () => {
		render(<GatedOrderPage order={cancelled()} />);
		expect(document.body.textContent).toMatch(/buyer has been told/);
	});
});

describe("GatedOrderPage — the way on", () => {
	// `countOrdersAwaitingCredit` excludes cancelled orders, so the count the
	// gate reports already leaves a cancelled order out. The threshold has to
	// account for that or the link vanishes exactly when it is the only exit.
	const COUNTED = /^\d+ orders? waiting on credits$/;

	test("a live order counts ITSELF, so one waiting offers no link", () => {
		gate.ordersWaiting = 1;
		render(<GatedOrderPage order={order()} />);
		expect(screen.queryByText(COUNTED)).toBeNull();
	});

	test("a live order with others waiting links to them", () => {
		gate.ordersWaiting = 3;
		render(<GatedOrderPage order={order()} />);
		expect(screen.getByText("3 orders waiting on credits")).toBeTruthy();
	});

	test("a CANCELLED order is not in the count, so one waiting still links", () => {
		gate.ordersWaiting = 1;
		render(<GatedOrderPage order={order({ status: "cancelled" })} />);
		expect(screen.getByText("1 order waiting on credits")).toBeTruthy();
	});

	test("nothing waiting at all leaves no stale link", () => {
		gate.ordersWaiting = 0;
		render(<GatedOrderPage order={order({ status: "cancelled" })} />);
		expect(screen.queryByText(COUNTED)).toBeNull();
	});
});

describe("GatedOrderPage — a teammate who cannot buy", () => {
	test("is told who can, and still gets cancel", () => {
		gate.canAct = false;
		render(<GatedOrderPage order={order()} />);
		expect(screen.queryByText("Top up credits")).toBeNull();
		expect(screen.getByText("Cancel and tell the buyer")).toBeTruthy();
		expect(document.body.textContent).toMatch(/owner adds credits/);
	});
});
