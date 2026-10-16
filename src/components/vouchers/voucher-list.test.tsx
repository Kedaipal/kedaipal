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
