// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { useMutation } from "convex/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { MarkShippedDialog, ShipmentTrackingCard } from "./shipment-tracking";

// Manual parcel-courier entry belongs to sellers who ship parcels. A vendor
// whose delivery method IS Lalamove must never be offered it (86eyff02p) —
// these tests pin both shapes of the mark-shipped prompt plus the read-only
// card, including the escapes that keep either state from becoming a wall.
vi.mock("convex/react");

const ORDER_ID = "or_1" as Id<"orders">;

function renderDialog(props: {
	lalamoveVendor: boolean;
	riderBlockReason?: "plan_gated" | "no_coords" | null;
}) {
	const onConfirm = vi.fn().mockResolvedValue(undefined);
	const onBookRider = vi.fn();
	render(
		<MarkShippedDialog
			open
			onOpenChange={vi.fn()}
			advanceLabel="Mark as Shipped"
			onConfirm={onConfirm}
			lalamoveVendor={props.lalamoveVendor}
			riderBlockReason={props.riderBlockReason ?? null}
			onBookRider={onBookRider}
		/>,
	);
	return { onConfirm, onBookRider };
}

beforeEach(() => {
	vi.mocked(useMutation).mockReturnValue(
		vi.fn().mockResolvedValue(undefined) as never,
	);
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	localStorage.clear();
});

describe("MarkShippedDialog", () => {
	it("offers the courier form to a parcel seller", async () => {
		const { onConfirm } = renderDialog({ lalamoveVendor: false });

		fireEvent.change(screen.getByLabelText("Courier"), {
			target: { value: "J&T Express" },
		});
		fireEvent.change(screen.getByLabelText("Tracking number"), {
			target: { value: "630002864925" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Mark as Shipped" }));

		await waitFor(() =>
			expect(onConfirm).toHaveBeenCalledWith(
				expect.objectContaining({
					courierName: "J&T Express",
					trackingNo: "630002864925",
				}),
			),
		);
		// No rider framing for a seller who isn't on Lalamove.
		expect(screen.queryByRole("button", { name: "Book a rider" })).toBeNull();
	});

	it("shows a rider vendor the booking CTA and no courier form", () => {
		const { onBookRider } = renderDialog({ lalamoveVendor: true });

		expect(screen.queryByLabelText("Courier")).toBeNull();
		expect(screen.queryByLabelText("Tracking number")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Book a rider" }));
		expect(onBookRider).toHaveBeenCalledTimes(1);
	});

	it("keeps a plain advance reachable for a rider vendor not booking today", async () => {
		const { onConfirm, onBookRider } = renderDialog({ lalamoveVendor: true });

		fireEvent.click(
			screen.getByRole("button", { name: "Mark as Shipped without a rider" }),
		);

		// Advances with no shipment fields — there's no courier form to read.
		await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({}));
		expect(onBookRider).not.toHaveBeenCalled();
	});

	it("states why a rider can't be booked, and lets the seller ship anyway", async () => {
		const { onConfirm } = renderDialog({
			lalamoveVendor: true,
			riderBlockReason: "plan_gated",
		});

		expect(
			screen.getByText(/A rider can't be booked for this order right now/),
		).toBeTruthy();
		expect(screen.getByText(/Lalamove booking is a Pro feature/)).toBeTruthy();
		// Booking is impossible, so the CTA is gone rather than offered-then-failing.
		expect(screen.queryByRole("button", { name: "Book a rider" })).toBeNull();
		// And still no fallback to the manual courier form.
		expect(screen.queryByLabelText("Courier")).toBeNull();

		fireEvent.click(
			screen.getByRole("button", { name: "Mark as Shipped anyway" }),
		);
		await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({}));
	});
});

describe("ShipmentTrackingCard", () => {
	it("lets a parcel seller add and edit tracking", () => {
		render(<ShipmentTrackingCard order={{ _id: ORDER_ID }} />);
		expect(screen.getByRole("button", { name: "Add tracking" })).toBeTruthy();

		cleanup();
		render(
			<ShipmentTrackingCard
				order={{ _id: ORDER_ID, courierName: "J&T Express" }}
			/>,
		);
		expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
	});

	it("shows a rider vendor what the buyer sees, with no manual entry", () => {
		render(
			<ShipmentTrackingCard
				readOnly
				order={{
					_id: ORDER_ID,
					trackingNo: "630002864925",
					carrierTrackingUrl: "https://share.lalamove.com/abc",
				}}
			/>,
		);

		expect(screen.getByText("630002864925")).toBeTruthy();
		expect(
			screen.getByRole("link", { name: /Track with courier/ }),
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Add tracking" })).toBeNull();
	});

	it("disappears for a rider vendor with nothing attached", () => {
		const { container } = render(
			<ShipmentTrackingCard readOnly order={{ _id: ORDER_ID }} />,
		);
		expect(container.innerHTML).toBe("");
	});
});
