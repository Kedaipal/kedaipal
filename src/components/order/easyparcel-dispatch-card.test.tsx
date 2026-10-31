// @vitest-environment jsdom
// The EasyParcel rate picker as the seller meets it (z8r3fdcje2 /test-code
// F9–F14): a real Singapore quote runs to 20+ services, the cheapest can
// leave a delivery at a locker, and a service name hides the facts that
// matter until they're chips.
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc } from "../../../convex/_generated/dataModel";
import {
	describeEasyparcelService,
	type EasyparcelRate,
} from "../../../convex/lib/easyparcel";
import { DAY_MS, todayMytMidnight } from "../../../convex/lib/fulfilmentDate";

const state = vi.hoisted(() => ({
	dispatch: undefined as unknown,
	prepare: undefined as ReturnType<typeof vi.fn> | undefined,
	confirm: undefined as ReturnType<typeof vi.fn> | undefined,
}));

vi.mock("convex/react", async () => {
	const { getFunctionName } = await import("convex/server");
	return {
		// A stable wrapper read at CALL time — the card captures the action at
		// render, and each test sets its quote after rendering.
		useAction: (fn: never) =>
			getFunctionName(fn) === "easyparcel:prepareBooking"
				? (...args: unknown[]) => state.prepare?.(...args)
				: getFunctionName(fn) === "easyparcel:confirmBooking"
					? (...args: unknown[]) => state.confirm?.(...args)
					: vi.fn(),
	};
});
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", async () => {
	const { getFunctionName } = await import("convex/server");
	return {
		// The courier-wallet line (z8r3fdx34j) reads its own query; everything
		// else answers with this card's own state.
		useQuery: (q: { fn: unknown }) => ({
			data:
				getFunctionName(q.fn as never) === "courierWallets:list"
					? walletState.wallets
					: getFunctionName(q.fn as never) === "courierWallets:topUpSuggestion"
						? undefined
						: state.dispatch,
		}),
	};
});
const walletState = vi.hoisted(() => ({
	wallets: [] as unknown[],
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ to, search: _s, hash: _h, ...props }: Record<string, unknown>) => (
		<a href={String(to)} {...props} />
	),
}));
vi.mock("../../hooks/usePermission", () => ({
	// The top-up sheet inside `DispatchWalletLine` gates its re-check on the
	// integrations grant; these tests are about the card, so the reader has it.
	usePermission: () => ({ canRead: true, canWrite: true, role: "owner" }),
	useStoreRole: () => "owner",
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { EasyparcelDispatchCard } from "./easyparcel-dispatch-card";

function rate(
	id: string,
	serviceName: string,
	priceMinor: number,
): EasyparcelRate {
	return {
		serviceId: id,
		serviceName,
		courierName: "Courier Pte Ltd",
		isPickup: /\(Pick Up\)/i.test(serviceName),
		isDropoff: /\(Drop[-\s]?Off\)/i.test(serviceName),
		priceMinor,
		currency: "SGD",
		...describeEasyparcelService(serviceName),
	};
}

// The shape of the 28 Oct live quote, trimmed: cheapest is point-to-point.
const QUOTE: EasyparcelRate[] = [
	rate(
		"pnp-p2p",
		"Park N Parcel - Paperless [1-3 Days] (Drop Off) (From Point to Point)",
		324,
	),
	rate(
		"sp-esaver",
		"Speedpost - E-Saver [1-3 Days] (Drop Off) (From Point to Door OR to Point)",
		339,
	),
	rate(
		"jt-pudo",
		"J&T Express - PUDO [1-3 Days] (Drop Off) (From Point to Door)",
		374,
	),
	rate(
		"sp-econ",
		"Speedpost - Economy [1-3 Days] (Pick Up) (From Door to Door)",
		379,
	),
	rate("spx", "SPX Express [1-3 Days] (Pick Up) (From Door to Door)", 384),
	rate(
		"jt-dom",
		"J&T Express - DOM [1-3 Days] (Pick Up) (From Door to Door)",
		394,
	),
	rate(
		"ninja-std",
		"Ninja - Standard [1-3 Days] (Pick Up) (From Door to Door | 5 MOQ)",
		424,
	),
	rate("aramex", "Aramex [1-3 Days] (Pick Up) (From Door to Door)", 469),
];

const ORDER = {
	_id: "o1",
	shortId: "ORD-WUGD",
	status: "confirmed",
	deliveryMethod: "delivery",
	currency: "SGD",
	deliveryFee: 0,
	customer: { name: "Buyer", waPhone: "601159399791" },
	// Far enough out that no service is late — date chips get their own test.
	fulfilmentDate: todayMytMidnight() + 10 * DAY_MS,
} as unknown as Doc<"orders">;

function card(order: Doc<"orders"> = ORDER) {
	return render(<EasyparcelDispatchCard order={order} />);
}

async function quote(balanceMinor = 10_000, rates: EasyparcelRate[] = QUOTE) {
	state.prepare = vi.fn().mockResolvedValue({
		ok: true,
		rates,
		balanceMinor,
		balanceCurrency: "SGD",
	});
	fireEvent.click(screen.getByRole("button", { name: /get courier prices/i }));
	await waitFor(() =>
		expect(screen.getByText("Choose a courier")).toBeTruthy(),
	);
}

const bookButton = () => screen.getByRole("button", { name: /^Book / });

beforeEach(() => {
	state.dispatch = {
		job: null,
		blockReason: null,
		bookingEnabled: true,
		country: "SG",
		receiverCountry: "SG",
		buyerContactFallback: false,
		pickupSummary: "#12-01 10 Anson Road, 079903",
		computedWeightKg: 0.5,
	};
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("the courier-contact notice names where the parcel goes (z8r3fdr5yy)", () => {
	it("an SG store's parcel to Malaysia speaks of a Malaysian number", () => {
		state.dispatch = {
			...(state.dispatch as Record<string, unknown>),
			receiverCountry: "MY",
			buyerContactFallback: true,
		};
		card();
		expect(
			screen.getByText(/isn't a Malaysian number, so the courier gets/),
		).toBeTruthy();
		expect(screen.queryByText(/Singapore number/)).toBeNull();
	});
});

describe("pre-selection keeps the order's promise (F9)", () => {
	it("a delivery order never pre-selects the cheaper point-to-point service", async () => {
		card();
		await quote();
		expect(bookButton().textContent).toContain("Speedpost - E-Saver");
		expect(bookButton().textContent).not.toContain("Park N Parcel");
	});
});

describe("door vs point, the cheap end first (F10)", () => {
	it("splits the quote by where the buyer gets it, with counts", async () => {
		card();
		await quote();
		const group = screen.getByRole("group", {
			name: /where the buyer gets the parcel/i,
		});
		const door = within(group).getByRole("button", {
			name: /to the buyer's door/i,
		});
		const point = within(group).getByRole("button", {
			name: /buyer collects/i,
		});
		expect(door.getAttribute("aria-pressed")).toBe("true");
		expect(door.textContent).toContain("7");
		expect(point.textContent).toContain("1");
		expect(screen.queryByText(/Park N Parcel/)).toBeNull();

		fireEvent.click(point);
		expect(screen.getByText("Buyer collects at a point")).toBeTruthy();
		expect(
			screen.getByText(/they chose delivery, so tell them before you book/i),
		).toBeTruthy();
		// The pick follows the group, so "Book X" always names a visible row.
		expect(bookButton().textContent).toContain("Park N Parcel");
	});

	it("opens on six rows and says how many more sit behind Show all", async () => {
		card();
		await quote();
		const showAll = screen.getByRole("button", { name: /show all 7/i });
		expect(showAll.textContent).toContain("1 more");
		expect(screen.queryByText("Aramex")).toBeNull();
		fireEvent.click(showAll);
		expect(screen.getByText("Aramex")).toBeTruthy();
	});
});

describe("the facts a name hides are chips (F11, F13)", () => {
	it("flags a minimum-parcel service", async () => {
		card();
		await quote();
		fireEvent.click(screen.getByRole("button", { name: /show all/i }));
		expect(screen.getByText("Pickup needs 5+ parcels")).toBeTruthy();
	});

	it("warns when a service may miss the buyer's date", async () => {
		card({
			...ORDER,
			fulfilmentDate: todayMytMidnight() + 2 * DAY_MS,
		} as Doc<"orders">);
		await quote();
		expect(screen.getAllByText(/^May miss /).length).toBeGreaterThan(0);
	});
});

describe("a pick that isn't the cheapest says why (F19)", () => {
	it("names the buyer's date when cheaper services may miss it", async () => {
		// The live 28 Oct case: buyer wants it tomorrow, 1–3 day services may
		// miss it, J&T Next-Day makes it at S$5.69.
		const nextDay = rate(
			"jt-next",
			"J&T Express - Next-Day Guaranteed [1 Day] (Pick Up) (From Door to Door)",
			569,
		);
		const tomorrow = todayMytMidnight() + DAY_MS;
		card({ ...ORDER, fulfilmentDate: tomorrow } as Doc<"orders">);
		await quote(
			10_000,
			[...QUOTE, nextDay].sort((a, b) => a.priceMinor - b.priceMinor),
		);
		expect(bookButton().textContent).toContain("Next-Day Guaranteed");
		const why = screen.getByText(/Cheaper ones are above/);
		expect(why.textContent).toMatch(
			/cheapest that reaches the buyer's door by /,
		);
	});

	it("is silent when the pick is simply the cheapest door service", async () => {
		card();
		await quote();
		expect(screen.queryByText(/Cheaper ones are above/)).toBeNull();
	});
});

describe("copy follows the picked service (F12) and the reason is attached (F14)", () => {
	it("a drop-off pick says to drop it, not that EasyParcel arranges pickup", async () => {
		card();
		await quote();
		// Speedpost E-Saver is a drop-off service.
		expect(
			screen.getByText(/Then drop the parcel at one of the courier's points/),
		).toBeTruthy();
		expect(screen.queryByText(/for collection today/)).toBeNull();
		fireEvent.click(screen.getByText("Speedpost - Economy"));
		expect(screen.getByText(/for collection today/)).toBeTruthy();
	});

	it("an unaffordable pick is disabled and DESCRIBED by the wallet line", async () => {
		card();
		await quote(100);
		const book = bookButton();
		expect(book.hasAttribute("disabled")).toBe(true);
		const id = book.getAttribute("aria-describedby");
		expect(id).toBeTruthy();
		// The shared wallet line (z8r3fdx34j) — present before the stored
		// wallet catches up, because Book names it as its reason.
		expect(document.getElementById(id ?? "")?.textContent).toMatch(
			/this booking costs .* Top up first/,
		);
	});
});

describe("a refused booking is said where the seller pressed (z8r3fdr5yy)", () => {
	// Found on the /test-code pass: the refusal rendered a screen above Book,
	// so it read as "nothing happened" and the seller pressed four times.
	it("the reason sits directly above the Book button", async () => {
		card();
		await quote();
		state.confirm = vi.fn().mockResolvedValue({
			ok: false,
			reason: "submit_failed",
			message:
				"EasyParcel couldn't do this: The sender phone number field is required ",
		});
		fireEvent.click(bookButton());
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toMatch(/sender phone number field is required/);
		expect(alert.nextElementSibling).toBe(bookButton());
		// Said once — not again under Box size.
		expect(screen.getAllByText(/sender phone number/)).toHaveLength(1);
	});

	it("a store without a WhatsApp number is told before the click, with the way to fix it", () => {
		state.dispatch = {
			...(state.dispatch as object),
			blockReason: "no_sender_phone",
		};
		card();
		expect(screen.getByText(/Add your store's WhatsApp number/)).toBeTruthy();
		expect(
			screen
				.getByText("Add your WhatsApp number")
				.closest("a")
				?.getAttribute("href"),
		).toBe("/app/settings");
	});
});

describe("after booking (test-code F20–F25)", () => {
	const job = (over: Record<string, unknown>) => ({
		_id: "j1",
		provider: "easyparcel",
		status: "assigning",
		costActual: 1375,
		shipmentNumber: "ES-2610-4SMXE",
		serviceName:
			"Speedpost - E-Saver [1-3 Days] (Drop Off) (From Point to Door OR to Point)",
		...over,
	});

	it("a drop-off booking says the seller's next job, under the clean name", () => {
		state.dispatch = { ...(state.dispatch as object), job: job({}) };
		card({ ...ORDER, courierName: "Singapore Post Limited" } as Doc<"orders">);
		expect(screen.getByText("Speedpost - E-Saver")).toBeTruthy();
		expect(screen.getByText(/Next: drop the parcel off\./)).toBeTruthy();
		expect(
			screen.getByText(/Shipped once the courier scans the parcel in/),
		).toBeTruthy();
		expect(screen.queryByText(/Shipped at collection/)).toBeNull();
	});

	it("a pickup booking has nothing to drop off", () => {
		state.dispatch = {
			...(state.dispatch as object),
			job: job({
				serviceName:
					"J&T Express - Next-Day Guaranteed [1 Day] (Pick Up) (From Door to Door)",
			}),
		};
		card();
		expect(screen.queryByText(/Next: drop the parcel off/)).toBeNull();
		expect(screen.getByText(/Shipped at collection/)).toBeTruthy();
	});

	it("delivered never claims a message nobody sent", () => {
		state.dispatch = {
			...(state.dispatch as object),
			job: job({ status: "completed" }),
		};
		card({ ...ORDER, status: "delivered" } as Doc<"orders">);
		expect(screen.queryByText(/notified automatically/)).toBeNull();
		expect(screen.getByText(/your buyer's order page shows it/)).toBeTruthy();
		// No proof-of-delivery photo on a parcel courier — said, not left to
		// look like a bug next to Lalamove's (z8r3fdytmq).
		expect(
			screen.getByText(
				/tracking scan, not a photo: the courier's tracking page/,
			),
		).toBeTruthy();
	});

	it("after the seller cancels, the way back reads Book again — not Try again", () => {
		state.dispatch = {
			...(state.dispatch as object),
			job: job({ status: "canceled", failureReason: "Cancelled by you" }),
		};
		card();
		expect(screen.getByRole("button", { name: /book again/i })).toBeTruthy();
		expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
	});

	it("a submit EasyParcel refused never existed — it didn't go through, not 'cancelled'", () => {
		state.dispatch = {
			...(state.dispatch as object),
			job: job({
				status: "canceled",
				shipmentNumber: undefined,
				failureReason:
					"EasyParcel couldn't do this: The sender phone number field is required ",
			}),
		};
		card();
		expect(screen.getByText("Booking didn't go through")).toBeTruthy();
		expect(screen.queryByText("Booking cancelled")).toBeNull();
		expect(
			screen.getByText(/field is required\. Your buyer was not notified/),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
	});

	it("the cancel dialog's way out says Keep booking", () => {
		state.dispatch = { ...(state.dispatch as object), job: job({}) };
		card();
		fireEvent.click(screen.getByRole("button", { name: /cancel booking/i }));
		const dialog =
			screen.queryByRole("alertdialog") ?? screen.getByRole("dialog");
		expect(
			within(dialog).getByRole("button", { name: "Keep booking" }),
		).toBeTruthy();
	});
});
