import type { VoucherStatus } from "../../convex/lib/vouchers";

/**
 * Grouping a store's vouchers for the list (`z8r3fdr617`).
 *
 * A "create 20" run arrives as twenty near-identical rows — same value, same
 * label, codes that differ only in eight random characters. Listed flat, the
 * seller cannot tell which run a code belongs to, which run they just made,
 * or act on a run as a unit. So a BATCH collapses to one parent row carrying
 * the run's name, its size and what has happened to it, and the codes live
 * underneath.
 *
 * Pure, and separate from the component, because the interesting part is the
 * arithmetic: what a part-spent run's parent should SAY, and what a filter
 * does to a group whose children only partly match.
 */

/** The shape the list needs from a voucher row — a structural subset of the
 * server's `VoucherRow`, so this stays testable without Convex. */
export interface GroupableVoucher {
	id: string;
	status: VoucherStatus;
	batchId?: string;
	note?: string;
	createdAt: number;
}

export type VoucherGroup<T extends GroupableVoucher> =
	| { kind: "single"; key: string; voucher: T }
	| {
			kind: "batch";
			key: string;
			batchId: string;
			/** The seller's name for the run, or undefined — `batchFallbackName`
			 * turns that into something pointable-at. */
			note?: string;
			createdAt: number;
			/** The children that survived the current filter, newest first. */
			vouchers: T[];
			/** How many are in the run ALTOGETHER, filter or no filter. */
			totalCount: number;
			/** Status tally across the WHOLE run, not just the shown children —
			 * a parent that counted only what passed the filter would tell the
			 * seller their run was smaller than it is. */
			counts: Record<VoucherStatus, number>;
	  };

const emptyCounts = (): Record<VoucherStatus, number> => ({
	active: 0,
	redeemed: 0,
	voided: 0,
	expired: 0,
});

/**
 * Group `shown` (the filtered rows) into singles and batches, newest first.
 *
 * `all` is the store's UNFILTERED list and is what the tallies are computed
 * from. Both are needed: the children must honour the filter the seller
 * chose, while the parent must keep telling the truth about the run — "3
 * codes · 1 used" stays right on the Used tab, where only one child shows.
 */
export function groupVouchers<T extends GroupableVoucher>(
	shown: readonly T[],
	all: readonly T[],
): Array<VoucherGroup<T>> {
	const tallies = new Map<string, Record<VoucherStatus, number>>();
	const sizes = new Map<string, number>();
	for (const v of all) {
		if (!v.batchId) continue;
		const tally = tallies.get(v.batchId) ?? emptyCounts();
		tally[v.status]++;
		tallies.set(v.batchId, tally);
		sizes.set(v.batchId, (sizes.get(v.batchId) ?? 0) + 1);
	}

	const groups: Array<VoucherGroup<T>> = [];
	const byBatch = new Map<
		string,
		Extract<VoucherGroup<T>, { kind: "batch" }>
	>();
	for (const voucher of shown) {
		if (!voucher.batchId) {
			groups.push({ kind: "single", key: voucher.id, voucher });
			continue;
		}
		const existing = byBatch.get(voucher.batchId);
		if (existing) {
			existing.vouchers.push(voucher);
			// The run's date is its OLDEST code: a batch is one act, and its
			// position in a newest-first list should not drift as children are
			// spent or voided.
			existing.createdAt = Math.min(existing.createdAt, voucher.createdAt);
			continue;
		}
		const group: Extract<VoucherGroup<T>, { kind: "batch" }> = {
			kind: "batch",
			key: voucher.batchId,
			batchId: voucher.batchId,
			note: voucher.note,
			createdAt: voucher.createdAt,
			vouchers: [voucher],
			totalCount: sizes.get(voucher.batchId) ?? 1,
			counts: tallies.get(voucher.batchId) ?? emptyCounts(),
		};
		byBatch.set(voucher.batchId, group);
		groups.push(group);
	}
	// Newest first, matching the server's order; a batch sorts by its own
	// (oldest-child) date so the whole run holds one place in the list.
	return groups.sort((a, b) => dateOf(b) - dateOf(a));
}

function dateOf<T extends GroupableVoucher>(group: VoucherGroup<T>): number {
	return group.kind === "single" ? group.voucher.createdAt : group.createdAt;
}

/** What to call a run the seller never named. Its size and day are the two
 * things they'd actually use to find it again. */
export function batchFallbackName(count: number, createdAt: number): string {
	const day = new Date(createdAt).toLocaleDateString("en-MY", {
		day: "numeric",
		month: "short",
		timeZone: "Asia/Kuala_Lumpur",
	});
	return `${count} vouchers · ${day}`;
}

/**
 * The parent's one-line summary of what happened to the run — "3 codes · 1
 * used · 1 voided".
 *
 * Only NON-ZERO outcomes are named, and `active` leads because it is the only
 * count the seller can still act on. A run where nothing has happened reads
 * "3 codes · all active" rather than listing three zeros.
 */
export function batchSummary(
	counts: Record<VoucherStatus, number>,
	totalCount: number,
): string {
	const codes = `${totalCount} ${totalCount === 1 ? "code" : "codes"}`;
	if (counts.active === totalCount) return `${codes} · all active`;
	const parts: string[] = [];
	if (counts.active > 0) parts.push(`${counts.active} active`);
	if (counts.redeemed > 0) parts.push(`${counts.redeemed} used`);
	if (counts.expired > 0) parts.push(`${counts.expired} expired`);
	if (counts.voided > 0) parts.push(`${counts.voided} voided`);
	return parts.length ? `${codes} · ${parts.join(" · ")}` : codes;
}

/** How many of a run are still spendable — what "Void remaining (N)" counts,
 * and what makes that action disappear once there is nothing left to void. */
export function batchVoidableCount(
	counts: Record<VoucherStatus, number>,
): number {
	// `expired` rows are voidable too: the status is judged at read time, so
	// voiding one is what stops it coming back to life if its date is ever
	// reconsidered — and the server's voidBatch skips only REDEEMED rows.
	return counts.active + counts.expired;
}
