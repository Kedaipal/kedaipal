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
import {
	mytMidnightFromYmd,
	todayMytMidnight,
	ymdFromEpoch,
} from "../../../convex/lib/fulfilmentDate";
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
	mutation: undefined as unknown,
}));
vi.mock("convex/react", () => ({
	useAction: () => state.action ?? vi.fn(),
	// Backs rescheduleFulfilment (the order-sync half of the rebook fix).
	useMutation: () => state.mutation ?? vi.fn(),
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
	state.mutation = undefined;
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

		expect(screen.getByText("Delivery photo from the rider")).toBeTruthy();
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

describe("BookDeliveryCard — rebook date/time + order sync (86eyp63xn)", () => {
	const DAY_MS = 24 * 60 * 60 * 1000;
	const bookableOrder = {
		_id: "order-rebook-1",
		shortId: "ORD-WAGYU",
		deliveryMethod: "delivery",
		status: "confirmed",
		currency: "MYR",
		paymentStatus: "received",
		source: undefined,
	} as unknown as Doc<"orders">;

	function quoteResult(overrides: Record<string, unknown> = {}) {
		return {
			ok: true,
			quotationId: "q-1",
			senderStopId: "s-1",
			recipientStopId: "r-1",
			fee: 1200,
			buyerPaidFee: 1200,
			vehicleType: "MOTORCYCLE",
			buyerContactFallback: false,
			scheduledFor: undefined,
			buyerRequestedMoment: undefined,
			...overrides,
		};
	}

	/** Amber failed-booking dispatch — the Wagyu Walid rebook entry state. */
	function failedDispatch() {
		return {
			promptBookOnPacked: false,
			blockReason: null,
			deliveryDirection: "standard",
			job: {
				status: "canceled",
				providerOrderId: "3545890794555130640",
				costActual: 1170,
				vehicleType: "MOTORCYCLE",
				driver: undefined,
				shareLink: undefined,
				failureReason: "driver not found",
				createdAt: 1_700_000_000_000,
			},
		};
	}

	it("Rebook opens the dialog with the time editor ALREADY showing — the stale schedule is never a hidden default", async () => {
		state.dispatch = failedDispatch();
		// Stale promise: the failed trip's moment is already past.
		state.action = vi
			.fn()
			.mockResolvedValue(
				quoteResult({ buyerRequestedMoment: Date.now() - 3 * 60 * 60 * 1000 }),
			);
		render(<BookDeliveryCard order={bookableOrder} />);

		fireEvent.click(screen.getByText("Rebook delivery"));
		await waitFor(() =>
			expect(screen.getByLabelText("Pickup date")).toBeTruthy(),
		);
		expect(screen.getByLabelText("Pickup time")).toBeTruthy();
	});

	it("applying a picked time surfaces the order-sync checkbox, pre-checked on the rebook path", async () => {
		state.dispatch = failedDispatch();
		state.action = vi
			.fn()
			.mockResolvedValue(
				quoteResult({ buyerRequestedMoment: Date.now() - 3 * 60 * 60 * 1000 }),
			);
		render(<BookDeliveryCard order={bookableOrder} />);

		fireEvent.click(screen.getByText("Rebook delivery"));
		await waitFor(() =>
			expect(screen.getByLabelText("Pickup date")).toBeTruthy(),
		);
		const ymd = ymdFromEpoch(todayMytMidnight() + DAY_MS);
		fireEvent.change(screen.getByLabelText("Pickup date"), {
			target: { value: ymd },
		});
		fireEvent.change(screen.getByLabelText("Pickup time"), {
			target: { value: "09:00" },
		});
		fireEvent.click(screen.getByText("Use this time"));

		const checkbox = (await screen.findByRole(
			"checkbox",
		)) as HTMLInputElement;
		expect(checkbox.checked).toBe(true);
	});

	it("a still-future buyer moment defaults the sync OFF and warns instead", async () => {
		state.dispatch = {
			promptBookOnPacked: false,
			blockReason: null,
			deliveryDirection: "standard",
			job: null,
		};
		const future = Date.now() + 5 * 60 * 60 * 1000;
		// First call = the open-dialog prepare (buyer's own moment); later
		// calls = the re-quote at the picked moment, which the real server
		// returns as a DIFFERENT scheduledFor.
		state.action = vi
			.fn()
			.mockResolvedValueOnce(
				quoteResult({ buyerRequestedMoment: future, scheduledFor: future }),
			)
			.mockResolvedValue(
				quoteResult({
					buyerRequestedMoment: future,
					scheduledFor: future + 2 * 60 * 60 * 1000,
				}),
			);
		render(<BookDeliveryCard order={bookableOrder} />);

		fireEvent.click(screen.getByText("Book delivery"));
		await waitFor(() => expect(screen.getByText("Change time")).toBeTruthy());
		fireEvent.click(screen.getByText("Change time"));
		const ymd = ymdFromEpoch(todayMytMidnight() + DAY_MS);
		fireEvent.change(screen.getByLabelText("Pickup date"), {
			target: { value: ymd },
		});
		fireEvent.change(screen.getByLabelText("Pickup time"), {
			target: { value: "09:00" },
		});
		fireEvent.click(screen.getByText("Use this time"));

		const checkbox = (await screen.findByRole(
			"checkbox",
		)) as HTMLInputElement;
		expect(checkbox.checked).toBe(false);
		// The promise-mismatch warning points at the box, not at a detour.
		expect(screen.getByText(/Tick the box above/)).toBeTruthy();
	});

	it("confirming with sync ON reschedules the ORDER to the picked moment before dispatching", async () => {
		state.dispatch = failedDispatch();
		const mutate = vi.fn().mockResolvedValue(undefined);
		state.mutation = mutate;
		state.action = vi
			.fn()
			.mockResolvedValue(
				quoteResult({ buyerRequestedMoment: Date.now() - 3 * 60 * 60 * 1000 }),
			);
		render(<BookDeliveryCard order={bookableOrder} />);

		fireEvent.click(screen.getByText("Rebook delivery"));
		await waitFor(() =>
			expect(screen.getByLabelText("Pickup date")).toBeTruthy(),
		);
		const ymd = ymdFromEpoch(todayMytMidnight() + DAY_MS);
		fireEvent.change(screen.getByLabelText("Pickup date"), {
			target: { value: ymd },
		});
		fireEvent.change(screen.getByLabelText("Pickup time"), {
			target: { value: "09:00" },
		});
		fireEvent.click(screen.getByText("Use this time"));
		await screen.findByRole("checkbox");

		// Spend guard (86eypjfuf) — dispatch arms a beat after the price lands.
		const dispatchBtn = screen
			.getByText("Confirm & dispatch")
			.closest("button") as HTMLButtonElement;
		await waitFor(() => expect(dispatchBtn.disabled).toBe(false));
		fireEvent.click(dispatchBtn);
		await waitFor(() =>
			expect(mutate).toHaveBeenCalledWith({
				orderId: bookableOrder._id,
				fulfilmentDate: mytMidnightFromYmd(ymd),
				fulfilmentTimeMinutes: 9 * 60,
			}),
		);
		// Dispatch still went through after the sync (3rd action call: prepare,
		// re-quote, confirm).
		await waitFor(() =>
			expect((state.action as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3),
		);
	});
});

describe("BookDeliveryCard — past pickup moments are refused (86eyp63xn follow-up)", () => {
	const DAY_MS = 24 * 60 * 60 * 1000;
	const order = {
		_id: "order-past-1",
		shortId: "ORD-PAST",
		deliveryMethod: "delivery",
		status: "confirmed",
		currency: "MYR",
		paymentStatus: "received",
		source: undefined,
	} as unknown as Doc<"orders">;
	const bookableDispatch = {
		promptBookOnPacked: false,
		blockReason: null,
		deliveryDirection: "standard",
		job: null,
	};
	function quoteResult(overrides: Record<string, unknown> = {}) {
		return {
			ok: true,
			quotationId: "q-1",
			senderStopId: "s-1",
			recipientStopId: "r-1",
			fee: 1200,
			buyerPaidFee: 1200,
			vehicleType: "MOTORCYCLE",
			buyerContactFallback: false,
			scheduledFor: undefined,
			buyerRequestedMoment: undefined,
			...overrides,
		};
	}

	it("a past date/time shows an inline reason and never re-quotes", async () => {
		state.dispatch = bookableDispatch;
		const prepare = vi.fn().mockResolvedValue(quoteResult());
		state.action = prepare;
		render(<BookDeliveryCard order={order} />);

		fireEvent.click(screen.getByText("Book delivery"));
		await waitFor(() => expect(screen.getByText("Change time")).toBeTruthy());
		fireEvent.click(screen.getByText("Change time"));

		// The native min only greys the picker — a typed/stepped value below it
		// still lands in state, so the guard has to be ours.
		fireEvent.change(screen.getByLabelText("Pickup date"), {
			target: { value: ymdFromEpoch(todayMytMidnight() - DAY_MS) },
		});
		fireEvent.change(screen.getByLabelText("Pickup time"), {
			target: { value: "09:00" },
		});
		const callsBefore = prepare.mock.calls.length;
		fireEvent.click(screen.getByText("Use this time"));

		expect(
			await screen.findByText(/That time has already passed/),
		).toBeTruthy();
		expect(prepare.mock.calls.length).toBe(callsBefore); // no quote fired
		// Correcting the input clears the reason.
		fireEvent.change(screen.getByLabelText("Pickup date"), {
			target: { value: ymdFromEpoch(todayMytMidnight() + DAY_MS) },
		});
		expect(screen.queryByText(/That time has already passed/)).toBeNull();
	});

	it("a stale scheduledFor never prefills a past day into the editor", async () => {
		state.dispatch = bookableDispatch;
		state.action = vi.fn().mockResolvedValue(
			quoteResult({ scheduledFor: Date.now() - 3 * 60 * 60 * 1000 }),
		);
		render(<BookDeliveryCard order={order} />);

		fireEvent.click(screen.getByText("Book delivery"));
		await waitFor(() => expect(screen.getByText("Change time")).toBeTruthy());
		fireEvent.click(screen.getByText("Change time"));

		const dateInput = screen.getByLabelText("Pickup date") as HTMLInputElement;
		expect(dateInput.value >= ymdFromEpoch(todayMytMidnight())).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Sandbox keys + the dead-quote trap (86eypncfy)
// ---------------------------------------------------------------------------

const bookableOrder = {
	shortId: "ORD-W4AH",
	deliveryMethod: "delivery",
	status: "confirmed",
	currency: "MYR",
	paymentStatus: "received",
} as unknown as Doc<"orders">;

function bookableDispatch(over: Record<string, unknown> = {}) {
	return {
		promptBookOnPacked: false,
		blockReason: null,
		bookingEnabled: true,
		deliveryDirection: "standard",
		job: null,
		...over,
	};
}

describe("BookDeliveryCard — sandbox keys", () => {
	it("says test keys mean no real rider, on the card and in the confirm dialog", async () => {
		state.dispatch = bookableDispatch({ env: "sandbox" });
		state.action = vi.fn().mockResolvedValue({
			ok: true,
			quotationId: "q1",
			senderStopId: "s1",
			recipientStopId: "s2",
			fee: 2740,
			buyerPaidFee: 2740,
			vehicleType: "MOTORCYCLE",
			buyerContactFallback: false,
		});
		render(<BookDeliveryCard order={bookableOrder} />);

		// On the card: the consequence, not just a neutral "test mode" label.
		expect(screen.getByText(/no real rider/i)).toBeTruthy();
		expect(screen.getAllByText(/pk_test_/).length).toBeGreaterThan(0);

		// And again at the point of spend — a seller who scrolled past the card
		// banner still gets told before they commit money.
		fireEvent.click(screen.getByRole("button", { name: /Book delivery/i }));
		await waitFor(() =>
			expect(screen.getByText(/simulated trip/i)).toBeTruthy(),
		);
	});

	it("stays silent when the store is on live keys", () => {
		state.dispatch = bookableDispatch({ env: "production" });
		render(<BookDeliveryCard order={bookableOrder} />);
		expect(screen.queryByText(/no real rider/i)).toBeNull();
	});

	it("stays silent when the environment isn't stamped yet, rather than implying live", () => {
		state.dispatch = bookableDispatch({ env: undefined });
		render(<BookDeliveryCard order={bookableOrder} />);
		expect(screen.queryByText(/no real rider/i)).toBeNull();
		expect(screen.queryByText(/Test mode/i)).toBeNull();
	});
});

describe("BookDeliveryCard — a failed confirm never traps the seller", () => {
	/** prepareBooking succeeds, confirmBooking fails. Both hooks share one mock
	 * in this harness, so branch on the args shape. */
	function quoteThenFail(message: string) {
		return vi.fn().mockImplementation((args: Record<string, unknown>) => {
			if (args.quotationId) {
				return Promise.resolve({
					ok: false,
					reason: "booking_failed",
					message,
				});
			}
			return Promise.resolve({
				ok: true,
				quotationId: "q1",
				senderStopId: "s1",
				recipientStopId: "s2",
				fee: 2740,
				buyerPaidFee: 2740,
				vehicleType: "MOTORCYCLE",
				buyerContactFallback: false,
			});
		});
	}

	it("keeps the reason in the dialog and swaps Confirm for a re-quote", async () => {
		// The exact trap: Wagyu Walid pressed Confirm five times in 5m23s against
		// ONE quotationId, because the failure was a toast and the button never
		// changed. Fixing a wallet takes longer than the 5 minutes Lalamove holds
		// a price, so the recovery has to be reachable from inside the dialog.
		state.dispatch = bookableDispatch({ env: "sandbox" });
		state.action = quoteThenFail("Your Lalamove wallet doesn't have enough.");
		render(<BookDeliveryCard order={bookableOrder} />);

		fireEvent.click(screen.getByRole("button", { name: /Book delivery/i }));
		const confirm = await screen.findByRole("button", {
			name: /Confirm & dispatch/i,
		});
		// Spend guard (86eypjfuf) — dispatch is inert for a beat after it appears.
		await waitFor(() => expect(confirm.hasAttribute("disabled")).toBe(false));
		fireEvent.click(confirm);

		// The reason survives where the seller can act on it...
		await waitFor(() =>
			expect(screen.getByText(/didn't go through/i)).toBeTruthy(),
		);
		expect(screen.getByText(/wallet doesn't have enough/i)).toBeTruthy();
		// ...and the only primary action left is the one that can succeed.
		expect(
			screen.getByRole("button", { name: /Get a fresh price/i }),
		).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: /Confirm & dispatch/i }),
		).toBeNull();
	});

	it("re-quotes on demand and re-arms Confirm", async () => {
		state.dispatch = bookableDispatch();
		state.action = quoteThenFail("Nope.");
		render(<BookDeliveryCard order={bookableOrder} />);

		fireEvent.click(screen.getByRole("button", { name: /Book delivery/i }));
		const confirm = await screen.findByRole("button", {
			name: /Confirm & dispatch/i,
		});
		await waitFor(() => expect(confirm.hasAttribute("disabled")).toBe(false));
		fireEvent.click(confirm);
		const fresh = await screen.findByRole("button", {
			name: /Get a fresh price/i,
		});

		// A fresh quote clears the failure and puts dispatch back in reach —
		// without the seller having to dismiss the dialog to find the button the
		// old copy pointed at (which sat behind the overlay).
		state.action = vi.fn().mockResolvedValue({
			ok: true,
			quotationId: "q2",
			senderStopId: "s1",
			recipientStopId: "s2",
			fee: 2740,
			buyerPaidFee: 2740,
			vehicleType: "MOTORCYCLE",
			buyerContactFallback: false,
		});
		fireEvent.click(fresh);
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: /Confirm & dispatch/i }),
			).toBeTruthy(),
		);
		expect(screen.queryByText(/didn't go through/i)).toBeNull();
	});
});


describe("BookDeliveryCard — dispatch can't be tapped by accident (86eypjfuf)", () => {
	/** The reported incident was a seller on a tablet reaching a live money
	 * dialog mid-scroll. "Confirm & dispatch" spends from his Lalamove wallet on
	 * one tap, and the dialog can auto-open under a finger (promptBookOnPacked,
	 * or the stepper's manual-advance path) — so the gesture that opens it must
	 * not be able to carry through into a booking. */
	it("is disabled the instant the price lands, then arms on its own", async () => {
		state.dispatch = bookableDispatch();
		const action = vi.fn().mockResolvedValue({
			ok: true,
			quotationId: "q1",
			senderStopId: "s1",
			recipientStopId: "s2",
			fee: 2740,
			buyerPaidFee: 2740,
			vehicleType: "MOTORCYCLE",
			buyerContactFallback: false,
		});
		state.action = action;
		render(<BookDeliveryCard order={bookableOrder} />);

		fireEvent.click(screen.getByRole("button", { name: /Book delivery/i }));
		const confirm = await screen.findByRole("button", {
			name: /Confirm & dispatch/i,
		});

		// The window that matters: the button exists but must refuse a tap.
		expect(confirm.hasAttribute("disabled")).toBe(true);
		fireEvent.click(confirm);
		// One call — the quote. No confirmBooking (which would carry quotationId).
		expect(action).toHaveBeenCalledTimes(1);
		expect(action.mock.calls[0][0]).not.toHaveProperty("quotationId");

		// ...and it lets a deliberate seller through a beat later.
		await waitFor(() => expect(confirm.hasAttribute("disabled")).toBe(false));
		fireEvent.click(confirm);
		await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
		expect(action.mock.calls[1][0]).toHaveProperty("quotationId", "q1");
	});
});
