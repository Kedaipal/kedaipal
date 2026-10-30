// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	DeliveriesOverview,
	DeliveryJobRow,
	ParcelRow,
} from "../../../convex/deliveries";

/**
 * The Deliveries page body (86eye9xd4, 6A): it adapts to how the store ships,
 * every booking row carries the one action its state needs, and a store with
 * nothing to show is told how deliveries get here.
 */

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		params: _p,
		search: _s,
		...props
	}: Record<string, unknown> & { to?: string }) => <a href={to} {...props} />,
}));
vi.mock("../order/add-tip-dialog", () => ({
	canTipMore: (_c: string, tipped: number) => tipped < 2000,
	AddTipDialog: ({ open, shortId }: { open: boolean; shortId: string }) =>
		open ? <div role="dialog">tip {shortId}</div> : null,
}));
vi.mock("convex/react", () => ({
	useAction: () => vi.fn(),
	useMutation: () => vi.fn(),
}));
vi.mock("../../hooks/useStoreLock", () => ({
	useAreaLock: () => ({ readOnly: false, reason: "", cause: null }),
}));
vi.mock("../../hooks/usePermission", () => ({
	usePermission: () => ({ canRead: true, canWrite: true, role: "owner" }),
}));
vi.mock("../../hooks/useActAs", () => ({
	useActAsRetailerId: () => undefined,
}));
vi.mock("../dashboard/print-labels-dialog", () => ({
	PrintLabelsDialog: ({ open }: { open: boolean }) =>
		open ? <div role="dialog">print queue</div> : null,
}));

import { deliveriesHomeRows } from "../home/deliveries-card";
import { DeliveriesView, monthGlance } from "./deliveries-view";

afterEach(cleanup);

function job(over: Partial<DeliveryJobRow>): DeliveryJobRow {
	return {
		jobId: `j${Math.random()}` as never,
		orderId: "o1" as never,
		shortId: "ORD-1041",
		provider: "lalamove",
		status: "ongoing",
		group: "active",
		direction: "standard",
		carrier: "Azman",
		vehicle: "Bike",
		cost: 1160,
		createdAt: 1,
		orderSettled: false,
		rebookable: false,
		tippable: false,
		hasProof: false,
		gated: false,
		...over,
	};
}

function parcel(over: Partial<ParcelRow>): ParcelRow {
	return {
		orderId: `p${Math.random()}` as never,
		shortId: "ORD-1044",
		destination: "Kuching, Sarawak",
		deliveryFee: 3000,
		labelReady: true,
		gated: false,
		...over,
	};
}

function overview(over: Partial<DeliveriesOverview> = {}): DeliveriesOverview {
	return {
		currency: "MYR",
		wallets: [],
		booksCouriers: false,
		bookingArmed: false,
		shipsParcels: false,
		jobs: [],
		counts: {
			active: 0,
			needsAttention: 0,
			toShip: 0,
			inTransit: 0,
			labelsReady: 0,
		},
		month: {
			start: Date.UTC(2026, 9, 1),
			bookings: 0,
			cost: 0,
			partial: false,
		},
		toShip: [],
		inTransit: [],
		...over,
	};
}

const renderView = (o: DeliveriesOverview, canPrint = true) =>
	render(
		<DeliveriesView
			overview={o}
			retailerId={"r1" as never}
			country="MY"
			paperLabel="A6"
			canPrintLabels={canPrint}
		/>,
	);

describe("DeliveriesView", () => {
	it("a store that doesn't deliver is told how deliveries get here", () => {
		renderView(overview());
		expect(screen.getByText("No deliveries yet")).toBeTruthy();
		expect(screen.getByRole("link", { name: "Set up delivery" })).toBeTruthy();
	});

	it("a parcel seller sees the queue, oldest first, with labels one tap away", () => {
		renderView(
			overview({
				shipsParcels: true,
				counts: {
					active: 0,
					needsAttention: 0,
					toShip: 2,
					inTransit: 0,
					labelsReady: 2,
				},
				toShip: [
					parcel({ shortId: "ORD-1043" }),
					parcel({ shortId: "ORD-1044", gated: true, destination: undefined }),
				],
			}),
		);
		expect(screen.getByText("2 parcels")).toBeTruthy();
		expect(screen.getAllByRole("link", { name: "Add number" })).toHaveLength(2);
		// A gated order keeps its number and says why the rest is missing.
		expect(screen.getByText(/Waiting on credits/)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /Print labels/ }));
		expect(screen.getByRole("dialog")).toBeTruthy();
	});

	it("a store that books couriers is asked to Book, not to add a number", () => {
		renderView(
			overview({
				shipsParcels: true,
				bookingArmed: true,
				counts: {
					active: 0,
					needsAttention: 0,
					toShip: 1,
					inTransit: 0,
					labelsReady: 0,
				},
				toShip: [parcel({})],
			}),
		);
		expect(screen.getByRole("link", { name: "Book" })).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Add number" })).toBeNull();
		expect(
			screen.getByText(/Book a rider or courier from each order/),
		).toBeTruthy();
	});

	it("labels at zero are disabled with their reason, never a dead click", () => {
		renderView(overview({ shipsParcels: true }));
		const print = screen.getByRole("button", { name: /Print labels/ });
		expect((print as HTMLButtonElement).disabled).toBe(true);
		expect(print.getAttribute("title")).toMatch(/Nothing is packed and paid/);
		expect(screen.getByText("All out")).toBeTruthy();
	});

	it("Starter sees batch printing as Pro, with the reason — not a refusal", () => {
		renderView(
			overview({
				shipsParcels: true,
				counts: {
					active: 0,
					needsAttention: 0,
					toShip: 1,
					inTransit: 0,
					labelsReady: 1,
				},
				toShip: [parcel({})],
			}),
			false,
		);
		const print = screen.getByRole("button", { name: /Print labels/ });
		expect((print as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByText(/is a Pro feature/)).toBeTruthy();
	});

	it("each booking carries the one action its state needs", () => {
		renderView(
			overview({
				booksCouriers: true,
				counts: {
					active: 1,
					needsAttention: 1,
					toShip: 0,
					inTransit: 0,
					labelsReady: 0,
				},
				jobs: [
					job({ shortId: "ORD-1", shareLink: "https://share.lalamove.com/x" }),
					job({
						shortId: "ORD-2",
						status: "completed",
						group: "completed",
						hasProof: true,
					}),
					job({
						shortId: "ORD-3",
						status: "rejected",
						group: "failed",
						rebookable: true,
					}),
					// An older failure on the same order is history, not a task.
					job({ shortId: "ORD-3", status: "expired", group: "failed" }),
					job({
						shortId: "ORD-4",
						status: "expired",
						group: "failed",
						orderSettled: true,
					}),
				],
			}),
		);
		expect(screen.getByText("1 to rebook")).toBeTruthy();
		expect(
			screen.getByRole("link", { name: /Track/ }).getAttribute("href"),
		).toBe("https://share.lalamove.com/x");
		expect(screen.getByRole("link", { name: "Photo" })).toBeTruthy();
		// Only the failure that still matters asks for a rebook.
		expect(screen.getAllByRole("link", { name: "Rebook" })).toHaveLength(1);
		// Phone and desktop each carry the label; CSS shows one.
		expect(screen.getAllByText("Rider on the way").length).toBeGreaterThan(0);
	});

	it("a booking still finding a rider says how long, and offers a tip", () => {
		renderView(
			overview({
				booksCouriers: true,
				jobs: [
					job({
						shortId: "ORD-1042",
						status: "assigning",
						tippable: true,
						createdAt: Date.now() - 12 * 60_000,
					}),
				],
			}),
		);
		expect(
			screen.getAllByText(/Finding rider · 12 min/).length,
		).toBeGreaterThan(0);
		fireEvent.click(screen.getByRole("button", { name: "Add tip" }));
		expect(screen.getByRole("dialog").textContent).toBe("tip ORD-1042");
	});

	it("a booking at its tip limit falls back to its usual action", () => {
		renderView(
			overview({
				booksCouriers: true,
				jobs: [job({ status: "assigning", tippable: true, priorityFee: 2000 })],
			}),
		);
		expect(screen.queryByRole("button", { name: "Add tip" })).toBeNull();
	});

	it("filters bookings by state, and an empty filter says so", () => {
		renderView(
			overview({
				booksCouriers: true,
				jobs: [job({ shortId: "ORD-1" })],
			}),
		);
		fireEvent.click(screen.getByRole("button", { name: /Failed/ }));
		expect(screen.getByText("No failed bookings.")).toBeTruthy();
		expect(screen.queryByText("ORD-1")).toBeNull();
	});

	it("leads with the courier wallets — a low one says so and offers its top-up", () => {
		renderView(
			overview({
				booksCouriers: true,
				wallets: [
					{
						provider: "lalamove",
						armed: true,
						isTest: false,
						state: "low",
						balanceMinor: 1240,
						currency: "MYR",
						at: Date.now() - 60_000,
						lowAlertMinor: 3000,
						lowAlertCustom: false,
						source: "webhook",
						refusedAt: null,
						refusedPriceMinor: null,
					},
				],
			}),
		);
		const row = screen.getByTestId("courier-wallet-lalamove");
		expect(row.getAttribute("data-state")).toBe("low");
		expect(row.textContent).toMatch(/RM\s?12\.40/);
		expect(
			screen.getByRole("button", { name: "Top up Lalamove" }),
		).toBeTruthy();
		// The section sits above every other card on the page.
		const sections = Array.from(document.querySelectorAll("section"));
		expect(sections[0]?.textContent).toMatch(/Courier wallets/);
	});

	it("a store with no courier connected has no wallets section at all", () => {
		renderView(overview({ shipsParcels: true }));
		expect(screen.queryByText("Courier wallets")).toBeNull();
	});
});

describe("monthGlance + Home rows", () => {
	it("marks a month the scan couldn't finish as a floor", () => {
		expect(
			monthGlance(
				overview({
					month: {
						start: Date.UTC(2026, 9, 1),
						bookings: 23,
						cost: 41200,
						partial: true,
					},
				}),
			),
		).toMatch(/Oct · 23\+ · RM\s?412\.00/);
	});

	it("names the month in Malaysia time, whatever the device zone says", () => {
		// 1 Oct 00:00 MYT is still 30 Sep in UTC — the label must read Oct.
		const start = Date.UTC(2026, 9, 1) - 8 * 3_600_000;
		expect(
			monthGlance(
				overview({ month: { start, bookings: 0, cost: 0, partial: false } }),
			),
		).toMatch(/^Oct · 0/);
	});

	it("Home leads with what needs doing", () => {
		const rows = deliveriesHomeRows(
			overview({
				booksCouriers: true,
				shipsParcels: true,
				counts: {
					active: 2,
					needsAttention: 1,
					toShip: 4,
					inTransit: 6,
					labelsReady: 0,
				},
				month: { start: 0, bookings: 23, cost: 41200, partial: false },
			}),
		);
		expect(rows.map((r) => r.label)).toEqual([
			"Needs attention",
			"To ship",
			"On the road",
			"In transit",
			"This month",
		]);
	});
});
