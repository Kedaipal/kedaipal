// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";

/**
 * The seller's Store status card and the dashboard banner (`z8r3fdudf7`).
 * The rule both keep: a switch that can't do anything is DISABLED WITH ITS
 * REASON — never enabled-but-ineffective, never silently greyed.
 */

let status: unknown;
let areaLock = { readOnly: false, reason: "", cause: null as string | null };
const setAccepting = vi.fn(async (_args: unknown) => undefined);

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: status }),
}));
vi.mock("convex/react", () => ({ useMutation: () => setAccepting }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../hooks/useSupportWaNumber", () => ({
	useSupportWaNumber: () => "60123456789",
}));
vi.mock("../../hooks/useStoreLock", () => ({ useAreaLock: () => areaLock }));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));

const { StoreStatusCard } = await import("./store-status-card");
const { StoreAvailabilityBanner } = await import(
	"../app/store-availability-banner"
);

const RID = "r1" as Id<"retailers">;
const open = { availability: { state: "open" }, sellerPaused: false };

beforeEach(() => {
	areaLock = { readOnly: false, reason: "", cause: null };
	setAccepting.mockClear();
});
afterEach(cleanup);

const toggle = () => screen.getByRole("switch", { name: "Accepting orders" });

describe("StoreStatusCard", () => {
	test("open: on, and flipping it off pauses with whatever note is typed", () => {
		status = open;
		render(<StoreStatusCard retailerId={RID} storeName="Corks Out" />);
		expect(toggle().getAttribute("aria-checked")).toBe("true");
		expect(screen.getByText(/billing continues/)).toBeTruthy();
		fireEvent.click(toggle());
		expect(setAccepting).toHaveBeenCalledWith({
			retailerId: RID,
			accepting: false,
			note: "",
		});
	});

	test("paused by the seller: off, with the buyer note to edit and save", () => {
		status = {
			availability: { state: "paused", by: "seller", note: "Back on 1 Nov" },
			sellerPaused: true,
			sellerPauseNote: "Back on 1 Nov",
		};
		render(<StoreStatusCard retailerId={RID} storeName="Corks Out" />);
		expect(toggle().getAttribute("aria-checked")).toBe("false");
		const note = screen.getByLabelText(/Note for buyers/) as HTMLInputElement;
		expect(note.value).toBe("Back on 1 Nov");
		fireEvent.change(note, { target: { value: "Back Monday" } });
		fireEvent.click(screen.getByRole("button", { name: "Save note" }));
		expect(setAccepting).toHaveBeenCalledWith({
			retailerId: RID,
			accepting: false,
			note: "Back Monday",
		});
	});

	test("paused by Kedaipal: disabled, says so with our note and a way to ask", () => {
		status = {
			availability: {
				state: "paused",
				by: "admin",
				note: "Pulled out of Campfest",
			},
			sellerPaused: false,
		};
		render(<StoreStatusCard retailerId={RID} storeName="Corks Out" />);
		expect((toggle() as HTMLButtonElement).disabled).toBe(true);
		expect(
			screen.getByText(
				/Kedaipal paused ordering at this store: Pulled out of Campfest/,
			),
		).toBeTruthy();
		expect(screen.getByText("Message us")).toBeTruthy();
		// "Your counter keeps working" is the SELLER's switch's promise — under
		// Kedaipal's switch the counter is closed, so it must not be said.
		expect(screen.queryByText(/counter keeps working/)).toBeNull();
	});

	test("on a hold: disabled, pointing at Billing — not a dead switch", () => {
		status = {
			availability: { state: "paused", by: "hold" },
			sellerPaused: false,
		};
		render(<StoreStatusCard retailerId={RID} storeName="Corks Out" />);
		expect((toggle() as HTMLButtonElement).disabled).toBe(true);
		expect(
			screen.getByText(/Off-Season Hold, so ordering is already paused/),
		).toBeTruthy();
	});

	test("a teammate without the grant sees the switch, disabled with the lock's reason", () => {
		status = open;
		areaLock = {
			readOnly: true,
			reason: "Ask the owner for Store settings access.",
			cause: "permission",
		};
		render(<StoreStatusCard retailerId={RID} storeName="Corks Out" />);
		expect((toggle() as HTMLButtonElement).disabled).toBe(true);
		expect(
			screen.getByText("Ask the owner for Store settings access."),
		).toBeTruthy();
	});
});

describe("StoreAvailabilityBanner", () => {
	test("nothing while open, and nothing for a hold (the subscription banner owns it)", () => {
		status = open;
		const { container, rerender } = render(
			<StoreAvailabilityBanner retailerId={RID} storeName="Corks Out" />,
		);
		expect(container.innerHTML).toBe("");
		status = {
			availability: { state: "paused", by: "hold" },
			sellerPaused: false,
		};
		rerender(
			<StoreAvailabilityBanner retailerId={RID} storeName="Corks Out" />,
		);
		expect(container.innerHTML).toBe("");
	});

	test("the seller's pause: one tap resumes", () => {
		status = {
			availability: { state: "paused", by: "seller", note: "Back on 1 Nov" },
			sellerPaused: true,
		};
		render(<StoreAvailabilityBanner retailerId={RID} storeName="Corks Out" />);
		expect(screen.getByText(/Buyers see: “Back on 1 Nov”/)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Resume orders" }));
		expect(setAccepting).toHaveBeenCalledWith({
			retailerId: RID,
			accepting: true,
		});
	});

	test("Kedaipal's switch: no resume button — a message-us link instead", () => {
		status = {
			availability: { state: "offline", by: "admin" },
			sellerPaused: false,
		};
		render(<StoreAvailabilityBanner retailerId={RID} storeName="Corks Out" />);
		expect(
			screen.getByText("Kedaipal has taken your store offline."),
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Resume orders" })).toBeNull();
		expect(screen.getByText("Message us")).toBeTruthy();
	});
});
