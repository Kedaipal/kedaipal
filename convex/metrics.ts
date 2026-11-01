// Acquisition attribution + the CAC ledger (ClickUp 86eye3eyp,
// docs/acquisition-attribution.md). Admin-only: a store's channel is
// Kedaipal's own classification and a seller never reads it back. The pure
// rules (channel list, founder rate, CAC maths) live in lib/metrics.ts; this
// file is the reads and writes.

import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type QueryCtx, query } from "./_generated/server";
import { logGlobalAdminAction, requireAdmin } from "./lib/auth";
import {
	ACQUISITION_CHANNELS,
	type AcquisitionChannel,
	CHANNEL_COPY,
	cacSen,
	channelCostSen,
	isAcquisitionChannel,
	normalizeAcquisitionNote,
	spendEntryProblem,
} from "./lib/metrics";
import {
	addMonthsMyt,
	monthStartMyt,
	nextMonthStartMyt,
} from "./lib/usagePeriod";

/** How many paid invoices the month view scans to find each store's FIRST
 * payment. Far above today's book; the view says so if it's ever reached. */
const PAID_INVOICE_SCAN_CAP = 5000;

function noteOrRefuse(note: string | undefined): string | undefined {
	try {
		return normalizeAcquisitionNote(note);
	} catch (err) {
		throw new ConvexError(err instanceof Error ? err.message : String(err));
	}
}

function assertChannel(channel: string): AcquisitionChannel {
	if (!isAcquisitionChannel(channel))
		throw new ConvexError(
			`"${channel}" isn't an acquisition channel. Use one of: ${ACQUISITION_CHANNELS.join(", ")}.`,
		);
	return channel;
}

/** A month key must be MYT midnight on the 1st, and not in the future —
 * spend is recorded after it happens. */
function assertPeriod(periodStart: number, now: number): void {
	if (monthStartMyt(periodStart) !== periodStart)
		throw new ConvexError("That isn't the start of a month.");
	if (periodStart > monthStartMyt(now))
		throw new ConvexError("You can't record spend for a month that hasn't started.");
}

/**
 * Tag the channel that won a store — or confirm the seller's own answer by
 * tagging the same one. Always lands as an admin tag, which a later seller
 * answer can never overwrite. Audited.
 */
export const setAcquisitionSource = mutation({
	args: {
		retailerId: v.id("retailers"),
		source: v.string(),
		note: v.optional(v.string()),
	},
	handler: async (ctx, { retailerId, source, note }): Promise<void> => {
		const adminUserId = await requireAdmin(ctx);
		const channel = assertChannel(source);
		const cleanNote = noteOrRefuse(note);
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) throw new ConvexError("Store not found");
		const now = Date.now();
		await ctx.db.patch(retailerId, {
			acquisitionSource: channel,
			acquisitionNote: cleanNote,
			acquisitionSetBy: "admin",
			acquisitionSetAt: now,
		});
		await ctx.db.insert("adminAuditLog", {
			adminUserId,
			retailerId,
			action: "metrics.setAcquisitionSource",
			targetId: channel,
			ts: now,
		});
	},
});

const spendEntry = v.object({
	channel: v.string(),
	cashSpend: v.number(), // MYR sen
	founderHours: v.optional(v.number()),
	note: v.optional(v.string()),
});

/**
 * Save one month's spend, one entry per channel. Upserts on
 * (periodStart, channel); an entry with no cash, no hours and no note
 * deletes that channel's row, because "blank" and "spent nothing" are the
 * same fact. Channels not named are left as they are. Audited once per save.
 */
export const recordSpend = mutation({
	args: { periodStart: v.number(), entries: v.array(spendEntry) },
	handler: async (ctx, { periodStart, entries }): Promise<void> => {
		const adminUserId = await requireAdmin(ctx);
		const now = Date.now();
		assertPeriod(periodStart, now);
		const seen = new Set<string>();
		const clean = entries.map((entry) => {
			const channel = assertChannel(entry.channel);
			if (seen.has(channel))
				throw new ConvexError(`${CHANNEL_COPY[channel].label} is listed twice.`);
			seen.add(channel);
			const problem = spendEntryProblem(entry);
			if (problem)
				throw new ConvexError(`${CHANNEL_COPY[channel].label}: ${problem}`);
			const hours =
				entry.founderHours !== undefined && entry.founderHours > 0
					? entry.founderHours
					: undefined;
			return {
				channel,
				cashSpend: entry.cashSpend,
				founderHours: hours,
				note: noteOrRefuse(entry.note),
			};
		});

		for (const entry of clean) {
			const existing = await ctx.db
				.query("acquisitionCosts")
				.withIndex("by_period_channel", (q) =>
					q.eq("periodStart", periodStart).eq("channel", entry.channel),
				)
				.unique();
			const blank =
				entry.cashSpend === 0 &&
				entry.founderHours === undefined &&
				entry.note === undefined;
			if (blank) {
				if (existing) await ctx.db.delete(existing._id);
				continue;
			}
			if (existing) {
				await ctx.db.patch(existing._id, {
					cashSpend: entry.cashSpend,
					founderHours: entry.founderHours,
					note: entry.note,
					updatedAt: now,
					updatedBy: adminUserId,
				});
			} else {
				await ctx.db.insert("acquisitionCosts", {
					periodStart,
					channel: entry.channel,
					cashSpend: entry.cashSpend,
					founderHours: entry.founderHours,
					note: entry.note,
					createdAt: now,
					updatedAt: now,
					updatedBy: adminUserId,
				});
			}
		}
		await logGlobalAdminAction(
			ctx,
			adminUserId,
			"metrics.recordSpend",
			String(periodStart),
		);
	},
});

export type SpendRow = {
	channel: AcquisitionChannel;
	label: string;
	hint: string;
	cashSpend: number;
	founderHours?: number;
	note?: string;
	/** Stores tagged to this channel whose FIRST invoice was paid this month. */
	newPayers: number;
	costSen: number;
	/** Null with no paying store — never read as free. */
	cacSen: number | null;
};

export type AcquisitionMonth = {
	periodStart: number;
	isCurrentMonth: boolean;
	rows: SpendRow[];
	totals: {
		cashSpend: number;
		founderHours: number;
		costSen: number;
		newPayers: number;
		cacSen: number | null;
	};
	/** Stores whose first invoice was paid this month but which have no
	 * admin-confirmed channel — the gap the totals can't see. */
	untaggedNewPayers: number;
	/** Whether the month has any recorded row (drives the empty state). */
	recorded: boolean;
	/** The month before's entries, to start this one from — null when it
	 * recorded nothing. */
	previous: Array<{
		channel: AcquisitionChannel;
		cashSpend: number;
		founderHours?: number;
		note?: string;
	}> | null;
	/** The paid-invoice scan hit its cap, so payer counts may be short. */
	scanCapped: boolean;
};

/** Each store whose FIRST paid invoice falls in [start, end), by store. One
 * index scan of paid invoices, not a query per store. */
async function firstPayersBetween(
	ctx: QueryCtx,
	start: number,
	end: number,
): Promise<{ retailerIds: Id<"retailers">[]; capped: boolean }> {
	const paid = await ctx.db
		.query("invoices")
		.withIndex("by_status", (q) => q.eq("status", "paid"))
		.take(PAID_INVOICE_SCAN_CAP + 1);
	const capped = paid.length > PAID_INVOICE_SCAN_CAP;
	const firstPaid = new Map<Id<"retailers">, number>();
	for (const inv of paid.slice(0, PAID_INVOICE_SCAN_CAP)) {
		const at = inv.markedPaidAt;
		if (at === undefined) continue;
		const prior = firstPaid.get(inv.retailerId);
		if (prior === undefined || at < prior) firstPaid.set(inv.retailerId, at);
	}
	const retailerIds = [...firstPaid.entries()]
		.filter(([, at]) => at >= start && at < end)
		.map(([id]) => id);
	return { retailerIds, capped };
}

/** One month of the ledger with every channel present (blank = no spend),
 * new paying stores per channel and CAC. Admin-only. */
export const getMonth = query({
	args: { periodStart: v.number() },
	handler: async (ctx, { periodStart }): Promise<AcquisitionMonth> => {
		await requireAdmin(ctx);
		const now = Date.now();
		assertPeriod(periodStart, now);
		const end = nextMonthStartMyt(periodStart);

		const recordedRows = await ctx.db
			.query("acquisitionCosts")
			.withIndex("by_period", (q) => q.eq("periodStart", periodStart))
			.collect();
		const byChannel = new Map<string, Doc<"acquisitionCosts">>(
			recordedRows.map((r) => [r.channel, r]),
		);

		const { retailerIds, capped } = await firstPayersBetween(ctx, periodStart, end);
		const payers = new Map<string, number>();
		let untaggedNewPayers = 0;
		for (const id of retailerIds) {
			const retailer = await ctx.db.get(id);
			if (!retailer) continue;
			const tagged =
				retailer.acquisitionSetBy === "admin" &&
				isAcquisitionChannel(retailer.acquisitionSource);
			if (!tagged || !retailer.acquisitionSource) {
				untaggedNewPayers += 1;
				continue;
			}
			payers.set(
				retailer.acquisitionSource,
				(payers.get(retailer.acquisitionSource) ?? 0) + 1,
			);
		}

		const rows: SpendRow[] = ACQUISITION_CHANNELS.map((channel) => {
			const row = byChannel.get(channel);
			const cashSpend = row?.cashSpend ?? 0;
			const founderHours = row?.founderHours;
			const costSen = channelCostSen({ cashSpend, founderHours });
			const newPayers = payers.get(channel) ?? 0;
			return {
				channel,
				label: CHANNEL_COPY[channel].label,
				hint: CHANNEL_COPY[channel].hint,
				cashSpend,
				...(founderHours !== undefined ? { founderHours } : {}),
				...(row?.note !== undefined ? { note: row.note } : {}),
				newPayers,
				costSen,
				cacSen: cacSen(costSen, newPayers),
			};
		});

		const totalCash = rows.reduce((s, r) => s + r.cashSpend, 0);
		const totalHours = rows.reduce((s, r) => s + (r.founderHours ?? 0), 0);
		const totalCost = rows.reduce((s, r) => s + r.costSen, 0);
		const totalPayers = rows.reduce((s, r) => s + r.newPayers, 0);

		const previousStart = addMonthsMyt(periodStart, -1);
		const previousRows = await ctx.db
			.query("acquisitionCosts")
			.withIndex("by_period", (q) => q.eq("periodStart", previousStart))
			.collect();
		const previous = previousRows
			.filter((r) => isAcquisitionChannel(r.channel))
			.map((r) => ({
				channel: r.channel as AcquisitionChannel,
				cashSpend: r.cashSpend,
				...(r.founderHours !== undefined ? { founderHours: r.founderHours } : {}),
				...(r.note !== undefined ? { note: r.note } : {}),
			}));

		return {
			periodStart,
			isCurrentMonth: periodStart === monthStartMyt(now),
			rows,
			totals: {
				cashSpend: totalCash,
				founderHours: totalHours,
				costSen: totalCost,
				newPayers: totalPayers,
				cacSen: cacSen(totalCost, totalPayers),
			},
			untaggedNewPayers,
			recorded: recordedRows.length > 0,
			previous: previous.length > 0 ? previous : null,
			scanCapped: capped,
		};
	},
});
