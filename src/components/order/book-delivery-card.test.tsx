// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Doc } from "../../../convex/_generated/dataModel";
import { BookDeliveryCard } from "./book-delivery-card";

// The card reads its job via useQuery and books via useAction. Stub both so it
// renders without a ConvexProvider; `state.dispatch` is what getDeliveryJob
// returns for the test. Router Link is only rendered in the not-set-up hint
// branch (never in these cases) — stub it anyway so the import is inert.
const state = vi.hoisted(() => ({ dispatch: null as unknown }));
vi.mock("convex/react", () => ({
	useQuery: () => state.dispatch,
	useAction: () => vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
	Link: (props: Record<string, unknown>) => <a {...props} />,
}));

afterEach(cleanup);

const deliveredOrder = {
	shortId: "ORD-JXHF",
	deliveryMethod: "delivery",
	status: "delivered",
	currency: "MYR",
	paymentStatus: "received",
} as unknown as Doc<"orders">;

function completedDispatch(
	job: Partial<{
		driver: { name: string; phone: string; plateNumber: string } | undefined;
		shareLink: string | undefined;
		costActual: number;
	}> = {},
) {
	return {
		promptBookOnPacked: false,
		blockReason: null,
		job: {
			status: "completed",
			providerOrderId: "3545890794555130640",
			costActual: 1170,
			vehicleType: "MOTORCYCLE",
			driver: { name: "Rahim", phone: "+60111111111", plateNumber: "WXY 1234" },
			shareLink: "https://share.sandbox.lalamove.com/?MY123",
			failureReason: undefined,
			createdAt: 1_700_000_000_000,
			...job,
		},
	};
}

describe("BookDeliveryCard — completed job", () => {
	it("renders a settled record (delivered pill, cost, rider, trip link) — not an empty card", () => {
		state.dispatch = completedDispatch();
		render(<BookDeliveryCard order={deliveredOrder} />);

		expect(screen.getByText("Delivered")).toBeTruthy();
		// The seller's actual spend (1170 sen → RM 11.70), distinct from the
		// buyer-paid delivery fee shown in the order totals card.
		expect(screen.getByText(/Booking cost/)).toBeTruthy();
		expect(screen.getByText(/RM\s?11\.70/)).toBeTruthy();
		expect(screen.getByText("Rahim")).toBeTruthy();
		expect(screen.getByText("WXY 1234")).toBeTruthy();

		const trip = screen.getByText("Trip details").closest("a");
		expect(trip?.getAttribute("href")).toBe(
			"https://share.sandbox.lalamove.com/?MY123",
		);

		// Never the in-progress / bookable controls on a delivered order.
		expect(screen.queryByText("Cancel booking")).toBeNull();
		expect(screen.queryByText("Book delivery")).toBeNull();
	});

	it("shows the rider's proof-of-delivery photos when present", () => {
		state.dispatch = completedDispatch();
		(
			state.dispatch as { job: { podImageUrls?: string[] } }
		).job.podImageUrls = [
			"https://files.convex.dev/pod-1.jpg",
			"https://files.convex.dev/pod-2.jpg",
		];
		render(<BookDeliveryCard order={deliveredOrder} />);

		expect(screen.getByText("Delivery photo from the rider")).toBeTruthy();
		const shots = screen.getAllByAltText("Proof of delivery");
		expect(shots).toHaveLength(2);
		expect(shots[0].closest("a")?.getAttribute("href")).toBe(
			"https://files.convex.dev/pod-1.jpg",
		);
	});

	it("degrades gracefully when the completed job has no driver or share link", () => {
		state.dispatch = completedDispatch({ driver: undefined, shareLink: undefined });
		render(<BookDeliveryCard order={deliveredOrder} />);

		expect(screen.getByText("Delivered")).toBeTruthy();
		expect(screen.getByText(/Booking cost/)).toBeTruthy();
		expect(screen.queryByText("Trip details")).toBeNull();
		expect(screen.queryByText("Rahim")).toBeNull();
	});
});
