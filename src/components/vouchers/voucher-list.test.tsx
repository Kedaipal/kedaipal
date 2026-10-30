// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { VoucherList, type VoucherRowView } from "./voucher-list";

// The row links a redeemed voucher to its order, so the list needs a router.
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		params,
	}: {
		children: React.ReactNode;
		params?: { shortId?: string };
	}) => <a href={`/app/orders/${params?.shortId ?? ""}`}>{children}</a>,
}));

afterEach(cleanup);

const base: VoucherRowView = {
	id: "v1" as Id<"vouchers">,
	code: "KP-7F3K-Q2WM",
	kind: "fixed",
	value: 1000,
	currency: "MYR",
	status: "active",
	createdAt: 0,
};

function renderList(rows: VoucherRowView[], canWrite = true) {
	const onShare = vi.fn();
	const onVoid = vi.fn();
	const view = render(
		<VoucherList
			vouchers={rows}
			onShare={onShare}
			onVoid={onVoid}
			canWrite={canWrite}
		/>,
	);
	return { ...view, onShare, onVoid };
}

/**
 * Every row has to answer two questions at a glance — what it is worth, and
 * what HAPPENED to it. A grey "redeemed" pill answers neither, which is why
 * the outcome line carries the useful part.
 */
describe("the outcome line says what happened", () => {
	it("an active voucher with no expiry says so, rather than leaving a blank", () => {
		renderList([base]);
		expect(screen.getByText(/No expiry · one use/)).toBeTruthy();
	});

	it("an active voucher with an expiry names the last day", () => {
		renderList([
			{ ...base, expiresAt: Date.parse("2026-10-20T00:00:00+08:00") },
		]);
		expect(screen.getByText(/Works until 20 Oct 2026/)).toBeTruthy();
	});

	it("a spent voucher names and LINKS the order it paid for", () => {
		renderList([
			{
				...base,
				status: "redeemed",
				redeemedOrder: { shortId: "ORD-7F3K", total: 4000 },
			},
		]);
		const link = screen.getByRole("link", { name: "ORD-7F3K" });
		expect(link.getAttribute("href")).toBe("/app/orders/ORD-7F3K");
		expect(screen.getByText(/paid/)).toBeTruthy();
	});

	it("a spent voucher whose order was deleted still says it was used", () => {
		// Hard delete is admin-only, but a blank here would read as a bug.
		renderList([{ ...base, status: "redeemed" }]);
		expect(screen.getByText(/since been deleted/)).toBeTruthy();
	});

	it("a voided voucher carries the seller's own reason", () => {
		renderList([
			{ ...base, status: "voided", voidReason: "Sent to the wrong buyer" },
		]);
		expect(screen.getByText(/Voided — Sent to the wrong buyer/)).toBeTruthy();
	});

	it("a voided voucher with no reason still explains itself", () => {
		renderList([{ ...base, status: "voided" }]);
		expect(screen.getByText(/no longer works/)).toBeTruthy();
	});

	it("an expired voucher names the day it lapsed", () => {
		renderList([
			{
				...base,
				status: "expired",
				expiresAt: Date.parse("2026-09-01T00:00:00+08:00"),
			},
		]);
		expect(screen.getByText(/Expired on 1 Sept 2026/)).toBeTruthy();
	});
});

describe("the value reads in words", () => {
	it("a fixed voucher prints money", () => {
		renderList([base]);
		expect(screen.getByText(/RM.?10\.00 off/)).toBeTruthy();
	});

	it("a percentage prints a percentage", () => {
		renderList([{ ...base, kind: "percent", value: 15 }]);
		expect(screen.getByText("15% off")).toBeTruthy();
	});
});

/**
 * Actions are per-status, not a uniform row of buttons that sometimes do
 * nothing: sharing a spent code would send a dead one, and voiding one would
 * imply a placed order could be clawed back.
 */
describe("only a spendable voucher offers Share and Void", () => {
	it("an active row offers both", () => {
		const { onShare, onVoid } = renderList([base]);
		fireEvent.click(screen.getByRole("button", { name: "Share" }));
		fireEvent.click(screen.getByRole("button", { name: "Void" }));
		expect(onShare).toHaveBeenCalledWith(base);
		expect(onVoid).toHaveBeenCalledWith(base);
	});

	it.each([
		"redeemed",
		"voided",
		"expired",
	] as const)("a %s row offers neither", (status) => {
		renderList([{ ...base, status }]);
		expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Void" })).toBeNull();
	});

	it("a read-only teammate sees the book and no actions", () => {
		renderList([base], false);
		expect(screen.getByText("KP-7F3K-Q2WM")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
	});
});

describe("a dead code is struck through, so the list scans", () => {
	it("active is not struck, spent is", () => {
		const { container, unmount } = renderList([base]);
		expect(container.querySelector("code")?.className).not.toContain(
			"line-through",
		);
		unmount();
		const second = renderList([{ ...base, status: "redeemed" }]);
		expect(second.container.querySelector("code")?.className).toContain(
			"line-through",
		);
	});
});

/**
 * A SHARED code (`z8r3fducfm`) reads differently on every line: it says it is
 * shared, its outcome is a tally rather than one order, and "who used it" is
 * a read that stays available after the code has stopped working.
 */
describe("a shared code", () => {
	const shared: VoucherRowView = {
		...base,
		code: "SALE345",
		usage: "shared",
		maxRedemptions: 50,
		redeemedCount: 12,
		endsAt: Date.parse("2026-10-31T18:00:00+08:00"),
	};

	it("says it is shared, and leads with the tally and the end", () => {
		renderList([shared]);
		expect(screen.getByText("Shared")).toBeTruthy();
		expect(
			screen.getByText("12 of 50 used · ends 31 Oct 2026, 6:00 PM"),
		).toBeTruthy();
	});

	it("with no end time says so, rather than leaving a blank", () => {
		renderList([{ ...shared, endsAt: undefined }]);
		expect(screen.getByText("12 of 50 used · no end time")).toBeTruthy();
	});

	it("a full code says the CAP stopped it, not the clock", () => {
		renderList([{ ...shared, status: "redeemed", redeemedCount: 50 }]);
		// "Had until", not "was running until": the cap filled while the end
		// was still ahead, and the past tense read as a lie.
		expect(
			screen.getByText(/All 50 uses taken · had until 31 Oct 2026, 6:00 PM/),
		).toBeTruthy();
		expect(screen.getByText("Used")).toBeTruthy();
	});

	it("an ended code names when, and how many got in", () => {
		renderList([{ ...shared, status: "expired" }]);
		expect(
			screen.getByText("Ended 31 Oct 2026, 6:00 PM · 12 of 50 used"),
		).toBeTruthy();
	});

	it("offers 'who used it' once anyone has — to readers too, and after it is dead", () => {
		const onShowUses = vi.fn();
		render(
			<VoucherList
				vouchers={[{ ...shared, status: "expired" }]}
				onShare={vi.fn()}
				onVoid={vi.fn()}
				onShowUses={onShowUses}
				canWrite={false}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: /12 orders/ }));
		expect(onShowUses).toHaveBeenCalledWith(
			expect.objectContaining({ code: "SALE345" }),
		);
	});

	it("does not offer it before anyone has used the code", () => {
		render(
			<VoucherList
				vouchers={[{ ...shared, redeemedCount: 0 }]}
				onShare={vi.fn()}
				onVoid={vi.fn()}
				onShowUses={vi.fn()}
				canWrite
			/>,
		);
		expect(screen.queryByRole("button", { name: /orders?$/ })).toBeNull();
		// Share and Void are still there — the code is live.
		expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
	});
});

/**
 * Shared codes v2 (`z8r3fdz0pw`): a scheduled row is live-in-waiting, the
 * conditions a buyer meets are printed on the row, and a shared code can be
 * extended — including one that has run out, which is when it is wanted.
 */
describe("v2 — scheduled, fine print, extend", () => {
	const shared: VoucherRowView = {
		...base,
		code: "SALE345",
		usage: "shared",
		maxRedemptions: 50,
		redeemedCount: 0,
	};
	const startsAt = Date.parse("2026-11-01T09:00:00+08:00");

	function renderWithExtend(rows: VoucherRowView[], canWrite = true) {
		const onExtend = vi.fn();
		render(
			<VoucherList
				vouchers={rows}
				onShare={vi.fn()}
				onVoid={vi.fn()}
				onExtend={onExtend}
				canWrite={canWrite}
			/>,
		);
		return { onExtend };
	}

	it("a scheduled code says Scheduled, leads with its start, and is not struck through", () => {
		renderWithExtend([{ ...shared, status: "scheduled", startsAt }]);
		expect(screen.getByText("Scheduled")).toBeTruthy();
		expect(
			screen.getByText("Starts 1 Nov 2026, 9:00 AM · 50 uses"),
		).toBeTruthy();
		expect(screen.getByText("SALE345").className).not.toMatch(/line-through/);
		// Can be shared early and called off before it starts.
		expect(screen.getByRole("button", { name: /share/i })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Void" })).toBeTruthy();
	});

	it("prints the conditions a buyer meets", () => {
		renderWithExtend([
			{
				...shared,
				kind: "percent",
				value: 20,
				maxDiscount: 2000,
				minSpend: 5000,
				perBuyerLimit: 1,
			},
		]);
		expect(
			screen.getByText(
				/up to RM\s20\.00 off · min\. spend RM\s50\.00 · 1 per buyer/,
			),
		).toBeTruthy();
	});

	it("offers Extend on a live shared code and on one that ran out, never on a voided one", () => {
		const { onExtend } = renderWithExtend([shared]);
		fireEvent.click(screen.getByRole("button", { name: /extend/i }));
		expect(onExtend).toHaveBeenCalledWith(shared);
		cleanup();
		renderWithExtend([{ ...shared, status: "redeemed", redeemedCount: 50 }]);
		expect(screen.getByRole("button", { name: /extend/i })).toBeTruthy();
		cleanup();
		renderWithExtend([{ ...shared, status: "voided" }]);
		expect(screen.queryByRole("button", { name: /extend/i })).toBeNull();
	});

	it("a single-use voucher and a read-only teammate get no Extend", () => {
		renderWithExtend([base]);
		expect(screen.queryByRole("button", { name: /extend/i })).toBeNull();
		cleanup();
		renderWithExtend([shared], false);
		expect(screen.queryByRole("button", { name: /extend/i })).toBeNull();
	});
});
