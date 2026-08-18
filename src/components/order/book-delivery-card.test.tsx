// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Doc } from "../../../convex/_generated/dataModel";
import { BookDeliveryCard } from "./book-delivery-card";

// The card reads its job via `useQuery(convexQuery(...)).data` and books via
// useAction. Stub the adapter (convexQuery passthrough + a TanStack useQuery that
// returns `{ data: state.dispatch }`) so it renders without a QueryClientProvider;
// `state.dispatch` is what getDeliveryJob returns for the test, `state.action`
// backs all three useAction hooks (only prepareBooking is exercised here). Router
// Link is only rendered in the not-set-up hint branch (never in these cases) —
// stub it anyway so the import is inert.
const state = vi.hoisted(() => ({
	dispatch: null as unknown,
	action: undefined as unknown,
}));
vi.mock("convex/react", () => ({
	useAction: () => state.action ?? vi.fn(),
}));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: state.dispatch }),
}));
vi.mock("@tanstack/react-router", () => ({
	Link: (props: Record<string, unknown>) => <a {...props} />,
}));

afterEach(() => {
	cleanup();
	state.action = undefined;
});

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
		(state.dispatch as { job: { podImageUrls?: string[] } }).job.podImageUrls =
			[
				"https://files.convex.dev/pod-1.jpg",
				"https://files.convex.dev/pod-2.jpg",
			];
		render(<BookDeliveryCard order={deliveredOrder} />);

		expect(
			screen.getByText(/Delivery photo from the rider/),
		).toBeTruthy();
		const shots = screen.getAllByAltText("Proof of delivery");
		expect(shots).toHaveLength(2);
		expect(shots[0].closest("a")?.getAttribute("href")).toBe(
			"https://files.convex.dev/pod-1.jpg",
		);
	});

	it("degrades gracefully when the completed job has no driver or share link", () => {
		state.dispatch = completedDispatch({
			driver: undefined,
			shareLink: undefined,
		});
		render(<BookDeliveryCard order={deliveredOrder} />);

		expect(screen.getByText("Delivered")).toBeTruthy();
		expect(screen.getByText(/Booking cost/)).toBeTruthy();
		expect(screen.queryByText("Trip details")).toBeNull();
		expect(screen.queryByText("Rahim")).toBeNull();
	});
});

describe("BookDeliveryCard — dispatch dialog vehicle choice", () => {
	it("offers Motorcycle/Car in the dialog and re-quotes on switch", async () => {
		const prepare = vi.fn().mockResolvedValue({
			ok: true,
			quotationId: "q1",
			senderStopId: "s1",
			recipientStopId: "s2",
			fee: 1110,
			buyerPaidFee: 1110,
			vehicleType: "MOTORCYCLE",
			buyerContactFallback: false,
		});
		state.action = prepare;
		state.dispatch = {
			promptBookOnPacked: false,
			blockReason: null,
			job: null,
		};
		const confirmedOrder = {
			...deliveredOrder,
			status: "confirmed",
		} as unknown as Doc<"orders">;
		render(<BookDeliveryCard order={confirmedOrder} />);

		fireEvent.click(screen.getByText("Book delivery"));
		// Dialog opens with the quote — both vehicle options present, settings
		// default (Motorcycle) selected.
		const car = await screen.findByRole("button", { name: /Car/ });
		const moto = screen.getByRole("button", { name: /Motorcycle/ });
		expect(moto.getAttribute("aria-pressed")).toBe("true");

		// Switching re-quotes for the chosen vehicle (prices are per-vehicle).
		fireEvent.click(car);
		await waitFor(() =>
			expect(prepare).toHaveBeenLastCalledWith({
				shortId: "ORD-JXHF",
				vehicleType: "CAR",
			}),
		);
	});
});

describe("BookDeliveryCard — collection service (86eyg0n8e)", () => {
	const confirmedOrder = {
		shortId: "ORD-COLL",
		deliveryMethod: "delivery",
		status: "confirmed",
		currency: "MYR",
		paymentStatus: "received",
	} as unknown as Doc<"orders">;

	it("bookable collection order: header + button read 'collect', never 'Book delivery'", () => {
		state.dispatch = {
			promptBookOnPacked: false,
			bookingEnabled: true,
			deliveryDirection: "collection",
			blockReason: null,
			job: null,
		};
		render(<BookDeliveryCard order={confirmedOrder} />);

		expect(screen.getByText("Lalamove Collection")).toBeTruthy();
		expect(screen.getByText("Send rider to collect")).toBeTruthy();
		expect(screen.queryByText("Book delivery")).toBeNull();
	});

	it("completed collection job: 'Arrived' pill, collected-from-customer record, seller-only photo label", () => {
		state.dispatch = {
			...completedDispatch(),
			deliveryDirection: "collection",
			job: {
				...completedDispatch().job,
				deliveryDirection: "collection",
				podImageUrls: ["https://example.com/pod.jpg"],
			},
		};
		render(<BookDeliveryCard order={deliveredOrder} />);

		// The trip ended at the SELLER's outlet — "Delivered" would misread.
		expect(screen.getByText("Arrived")).toBeTruthy();
		expect(screen.queryByText("Delivered")).toBeNull();
		expect(
			screen.getByText(/collected this order from your customer/),
		).toBeTruthy();
		expect(screen.getByText(/not sent to the buyer/)).toBeTruthy();
	});

	it("standard dispatch payload keeps every existing label (regression pin)", () => {
		state.dispatch = {
			...completedDispatch(),
			deliveryDirection: "standard",
			job: { ...completedDispatch().job, deliveryDirection: "standard" },
		};
		render(<BookDeliveryCard order={deliveredOrder} />);
		expect(screen.getByText("Lalamove Delivery")).toBeTruthy();
		expect(screen.getByText("Delivered")).toBeTruthy();
		expect(
			screen.getByText("This order was delivered by a Lalamove rider."),
		).toBeTruthy();
	});
});

describe("BookDeliveryCard — a completed collection is terminal (86eyg0n8e)", () => {
	// Regression: a collection order NEVER auto-advances (the webhook only moves
	// the job), so it sits at confirmed/packed forever. `bookable` therefore
	// stays true after the trip finishes and the card re-offered "Send rider to
	// collect" — a second, pointless, PAID trip back to the buyer's address.
	// Standard orders never hit this: they're `delivered` by then.
	const collectedOrder = {
		shortId: "ORD-COLL",
		deliveryMethod: "delivery",
		status: "confirmed",
		currency: "MYR",
		paymentStatus: "received",
	} as unknown as Doc<"orders">;

	function completedCollection(promptBookOnPacked = false) {
		return {
			promptBookOnPacked,
			bookingEnabled: true,
			deliveryDirection: "collection",
			blockReason: null,
			job: {
				status: "completed",
				providerOrderId: "3545890794555130640",
				costActual: 1000,
				vehicleType: "MOTORCYCLE",
				deliveryDirection: "collection",
				driver: {
					name: "TestDriver 44111",
					phone: "+60111111111",
					plateNumber: "VP2381474",
				},
				shareLink: "https://share.sandbox.lalamove.com/?MY123",
				createdAt: 1_700_000_000_000,
			},
		};
	}

	it("hides the book button + the prompt hint once the goods have arrived", () => {
		state.dispatch = completedCollection(true);
		render(<BookDeliveryCard order={collectedOrder} />);

		// The settled record still renders…
		expect(screen.getByText("Arrived")).toBeTruthy();
		expect(
			screen.getByText(/collected this order from your customer/),
		).toBeTruthy();
		// …but nothing offers another trip to the buyer.
		expect(screen.queryByText("Send rider to collect")).toBeNull();
		expect(screen.queryByText("Rebook collection")).toBeNull();
		expect(screen.queryByText(/You'll be asked to book a rider/)).toBeNull();
		// And the seller isn't left wondering how to return the goods.
		expect(screen.getByText(/Sending it back after your work/)).toBeTruthy();
	});

	it("marking the collected order Packed never auto-opens a second booking", async () => {
		const prepare = vi.fn();
		state.action = prepare;
		state.dispatch = completedCollection(true);
		const { rerender } = render(<BookDeliveryCard order={collectedOrder} />);

		// The seller's natural next step after the goods land: mark it Packed.
		// With promptBookOnPacked on, this transition used to fire the booking
		// dialog — dispatching a rider back to the customer automatically.
		rerender(
			<BookDeliveryCard
				order={{ ...collectedOrder, status: "packed" } as Doc<"orders">}
			/>,
		);
		await waitFor(() => {
			expect(prepare).not.toHaveBeenCalled();
		});
	});

	it("a FAILED collection still offers a rebook — no rider ever came", () => {
		state.dispatch = {
			...completedCollection(),
			job: {
				...completedCollection().job,
				status: "expired",
				failureReason: "No driver accepted the order",
			},
		};
		render(<BookDeliveryCard order={collectedOrder} />);
		expect(screen.getByText("Rebook collection")).toBeTruthy();
	});

	it("a completed STANDARD job on a still-bookable order keeps today's behaviour", () => {
		// Guard against over-reach: the stop is collection-only.
		state.dispatch = {
			...completedCollection(),
			deliveryDirection: "standard",
			job: { ...completedCollection().job, deliveryDirection: "standard" },
		};
		render(<BookDeliveryCard order={collectedOrder} />);
		expect(screen.getByText("Book delivery")).toBeTruthy();
	});
});

describe("BookDeliveryCard — store-now vs trip-then (86eyg0n8e)", () => {
	// The card answers two different questions and must not conflate them:
	// what THIS trip was (frozen on the job) vs what booking NOW would do (the
	// store's live setting). They diverge after a seller switches modes — and
	// will diverge routinely once direction varies per order.
	it("describes a past standard trip as a delivery while offering today's collection", () => {
		state.dispatch = {
			promptBookOnPacked: false,
			bookingEnabled: true,
			deliveryDirection: "collection", // the store, today
			blockReason: null,
			job: {
				status: "expired",
				providerOrderId: "LLM-OLD",
				costActual: 0,
				vehicleType: "MOTORCYCLE",
				failureReason: "No driver accepted the order",
				createdAt: 1_700_000_000_000,
				deliveryDirection: "standard", // …but that trip was a delivery
			},
		};
		render(
			<BookDeliveryCard
				order={
					{
						shortId: "ORD-SWAP",
						deliveryMethod: "delivery",
						status: "confirmed",
						currency: "MYR",
						paymentStatus: "received",
					} as unknown as Doc<"orders">
				}
			/>,
		);
		// History is narrated truthfully…
		expect(screen.getByText("Lalamove Delivery")).toBeTruthy();
		// …and the button promises exactly what dispatch would book now.
		expect(screen.getByText("Rebook collection")).toBeTruthy();
	});
});

describe("BookDeliveryCard — collection never auto-prompts (86eyg0n8e)", () => {
	// The prompt means "you packed it, now send it out". On a collection order
	// the rider brings goods IN — packing happens AFTER they arrive — so
	// prompting before any booking offered a trip at the wrong moment, and the
	// ⚡ hint promised something that must never happen.
	const collectionOrder = {
		shortId: "ORD-COLL2",
		deliveryMethod: "delivery",
		status: "confirmed",
		currency: "MYR",
		paymentStatus: "received",
		deliveryDirection: "collection",
	} as unknown as Doc<"orders">;

	const noJobYet = {
		promptBookOnPacked: true,
		bookingEnabled: true,
		deliveryDirection: "collection",
		blockReason: null,
		job: null,
	};

	it("marking Packed with no booking yet does not open the booking dialog", async () => {
		const prepare = vi.fn();
		state.action = prepare;
		state.dispatch = noJobYet;
		const { rerender } = render(<BookDeliveryCard order={collectionOrder} />);
		rerender(
			<BookDeliveryCard
				order={{ ...collectionOrder, status: "packed" } as Doc<"orders">}
			/>,
		);
		await waitFor(() => {
			expect(prepare).not.toHaveBeenCalled();
		});
	});

	it("drops the ⚡ prompt hint, which would promise a prompt that never comes", () => {
		state.dispatch = noJobYet;
		render(<BookDeliveryCard order={collectionOrder} />);
		expect(screen.queryByText(/You'll be asked to book a rider/)).toBeNull();
		// The way to book is still right there.
		expect(screen.getByText("Send rider to collect")).toBeTruthy();
	});

	it("a STANDARD order keeps the prompt and its hint (regression pin)", async () => {
		const prepare = vi.fn().mockResolvedValue({ ok: false, reason: "x" });
		state.action = prepare;
		state.dispatch = { ...noJobYet, deliveryDirection: "standard" };
		// Genuinely standard — on the ORDER too, which is what the guard reads.
		const standard = {
			...collectionOrder,
			deliveryDirection: undefined,
		} as Doc<"orders">;
		const { rerender } = render(<BookDeliveryCard order={standard} />);
		expect(screen.getByText(/You'll be asked to book a rider/)).toBeTruthy();
		rerender(
			<BookDeliveryCard
				order={{ ...standard, status: "packed" } as Doc<"orders">}
			/>,
		);
		await waitFor(() => {
			expect(prepare).toHaveBeenCalled();
		});
	});
});

describe("BookDeliveryCard — collected by hand (86eyg0n8e)", () => {
	const collectedByHand = {
		shortId: "ORD-HAND",
		deliveryMethod: "delivery",
		status: "packed",
		currency: "MYR",
		paymentStatus: "received",
		deliveryDirection: "collection",
		collectedAt: 1_785_000_000_000,
	} as unknown as Doc<"orders">;

	it("stops offering to fetch goods the seller already has, even with no job", () => {
		// The escape stamps collectedAt with no rider involved. Without honouring
		// it, the card kept offering "Send rider to collect" — a second, paid,
		// pointless trip for items already on the bench.
		state.dispatch = {
			promptBookOnPacked: false,
			bookingEnabled: true,
			deliveryDirection: "collection",
			blockReason: null,
			job: null,
		};
		render(<BookDeliveryCard order={collectedByHand} />);
		expect(screen.queryByText("Send rider to collect")).toBeNull();
	});

	it("the prompt guard reads the ORDER's direction, not the store's live setting", () => {
		// A collection order on a store that has since switched to standard must
		// still never auto-prompt: three surfaces gating one order have to agree.
		state.dispatch = {
			promptBookOnPacked: true,
			bookingEnabled: true,
			deliveryDirection: "standard", // the store, today
			blockReason: null,
			job: null,
		};
		render(
			<BookDeliveryCard
				order={
					{
						...collectedByHand,
						status: "confirmed",
						collectedAt: undefined,
					} as unknown as Doc<"orders">
				}
			/>,
		);
		expect(screen.queryByText(/You'll be asked to book a rider/)).toBeNull();
	});
});

describe("BookDeliveryCard — scheduled pickups (86eyg0n8e follow-up)", () => {
	const order = {
		shortId: "ORD-SCHED",
		deliveryMethod: "delivery",
		status: "confirmed",
		currency: "MYR",
		paymentStatus: "received",
	} as unknown as Doc<"orders">;

	it("an active scheduled booking says WHEN, not a bare 'Finding rider…' for hours", () => {
		state.dispatch = {
			promptBookOnPacked: false,
			bookingEnabled: true,
			deliveryDirection: "standard",
			blockReason: null,
			job: {
				status: "assigning",
				providerOrderId: "LLM-S1",
				costActual: 1200,
				vehicleType: "MOTORCYCLE",
				createdAt: 1_700_000_000_000,
				deliveryDirection: "standard",
				scheduledAt: Date.now() + 4 * 3_600_000,
			},
		};
		render(<BookDeliveryCard order={order} />);
		expect(screen.getByText(/Scheduled pickup/)).toBeTruthy();
		expect(screen.queryByText(/Finding a rider/)).toBeNull();
	});

	it("an immediate booking keeps the exact pre-existing copy (regression pin)", () => {
		state.dispatch = {
			promptBookOnPacked: false,
			bookingEnabled: true,
			deliveryDirection: "standard",
			blockReason: null,
			job: {
				status: "assigning",
				providerOrderId: "LLM-S2",
				costActual: 1200,
				vehicleType: "MOTORCYCLE",
				createdAt: 1_700_000_000_000,
				deliveryDirection: "standard",
			},
		};
		render(<BookDeliveryCard order={order} />);
		expect(screen.getByText(/Finding a rider/)).toBeTruthy();
	});
});

// A seller who advances a bookable Lalamove order by hand lands in THIS modal
// — live price, vehicle switch, variance — not a separate "how is this going
// out?" prompt in front of it. `bookRequestToken` is how the order stepper
// asks, and `advanceWithoutRider` is the way out for the one they're
// delivering themselves.
describe("BookDeliveryCard — manual advance opens the booking modal", () => {
	const bookableQuote = {
		ok: true,
		quotationId: "q1",
		senderStopId: "s1",
		recipientStopId: "s2",
		fee: 1110,
		buyerPaidFee: 1110,
		vehicleType: "MOTORCYCLE",
		buyerContactFallback: false,
	};
	const packedOrder = {
		shortId: "ORD-JXHF",
		deliveryMethod: "delivery",
		status: "packed",
		currency: "MYR",
		paymentStatus: "received",
	} as unknown as Doc<"orders">;

	function bookable() {
		return { promptBookOnPacked: false, blockReason: null, job: null };
	}

	it("raising the token opens the real quote dialog, with the no-rider way out", async () => {
		state.action = vi.fn().mockResolvedValue(bookableQuote);
		state.dispatch = bookable();
		const onConfirm = vi.fn();
		const { rerender } = render(
			<BookDeliveryCard
				order={packedOrder}
				bookRequestToken={0}
				advanceWithoutRider={{
					label: "Mark as Ready for Pickup without a rider",
					onConfirm,
				}}
			/>,
		);
		// Nothing opens on mount — the token is baselined, so a remount can't
		// replay a stale request.
		expect(screen.queryByRole("dialog")).toBeNull();

		rerender(
			<BookDeliveryCard
				order={packedOrder}
				bookRequestToken={1}
				advanceWithoutRider={{
					label: "Mark as Ready for Pickup without a rider",
					onConfirm,
				}}
			/>,
		);

		// The same modal the packed prompt shows: vehicle choice and a confirm
		// that names the spend.
		expect(
			await screen.findByRole("button", { name: /Motorcycle/ }),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: /Car/ })).toBeTruthy();
		expect(screen.getByText("Confirm & dispatch")).toBeTruthy();

		// Dismissing would otherwise leave the order exactly where it was, so
		// this path — and only this path — offers the advance itself.
		fireEvent.click(
			screen.getByRole("button", {
				name: "Mark as Ready for Pickup without a rider",
			}),
		);
		expect(onConfirm).toHaveBeenCalledTimes(1);
	});

	it("opens on the tap and says it's waiting — the quote is a live provider call", async () => {
		let release: (v: unknown) => void = () => {};
		state.action = vi.fn(() => new Promise((resolve) => (release = resolve)));
		state.dispatch = bookable();
		const { rerender } = render(
			<BookDeliveryCard order={packedOrder} bookRequestToken={0} />,
		);
		rerender(<BookDeliveryCard order={packedOrder} bookRequestToken={1} />);

		// The modal is up BEFORE Lalamove answers — an unchanged page for the
		// length of a network round-trip reads as a dead button.
		expect(
			await screen.findByText(/Getting today's price from Lalamove/),
		).toBeTruthy();
		// …and it can't be confirmed until there's a price to confirm.
		expect(
			screen
				.getByRole("button", { name: /Confirm & dispatch/ })
				.hasAttribute("disabled"),
		).toBe(true);

		release(bookableQuote);
		expect(await screen.findByRole("button", { name: /Car/ })).toBeTruthy();
		expect(screen.queryByText(/Getting today's price/)).toBeNull();
	});

	it("the card's own button opens the same modal WITHOUT that escape", async () => {
		state.action = vi.fn().mockResolvedValue(bookableQuote);
		state.dispatch = bookable();
		render(
			<BookDeliveryCard
				order={packedOrder}
				advanceWithoutRider={{
					label: "Mark as Ready for Pickup without a rider",
					onConfirm: vi.fn(),
				}}
			/>,
		);

		fireEvent.click(screen.getByText("Book delivery"));
		await screen.findByText("Confirm & dispatch");
		// Booking here isn't blocking a status change, so advancing the order
		// would be an unrelated action smuggled into a spend confirmation.
		expect(
			screen.queryByRole("button", {
				name: "Mark as Ready for Pickup without a rider",
			}),
		).toBeNull();
	});

	it("a quote that fails on the advance path hands the seller back to the prompt", async () => {
		// Out of service area, provider down: no quote means no modal, and the
		// seller's tap would otherwise produce nothing but a toast.
		state.action = vi
			.fn()
			.mockResolvedValue({ ok: false, reason: "no_coords" });
		state.dispatch = bookable();
		const onAdvanceBookUnavailable = vi.fn();
		const { rerender } = render(
			<BookDeliveryCard
				order={packedOrder}
				bookRequestToken={0}
				onAdvanceBookUnavailable={onAdvanceBookUnavailable}
			/>,
		);
		rerender(
			<BookDeliveryCard
				order={packedOrder}
				bookRequestToken={1}
				onAdvanceBookUnavailable={onAdvanceBookUnavailable}
			/>,
		);

		await waitFor(() =>
			expect(onAdvanceBookUnavailable).toHaveBeenCalledTimes(1),
		);
		expect(screen.queryByText("Confirm & dispatch")).toBeNull();
	});
});
