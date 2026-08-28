/**
 * Log-table retention windows (ClickUp 86eyetzt7) — the single source of truth
 * for how long each append-only table keeps raw rows. Every number the purge
 * crons (convex/crons.ts) enforce lives HERE, and docs/data-retention.md cites
 * this file — change a window in one place only.
 *
 * The full table-by-table policy (including the tables that are deliberately
 * NOT purged, and why) is documented per-constant below and in
 * docs/data-retention.md.
 */

import { MYT_OFFSET_MS } from "./fulfilmentDate";
import { DAY_MS } from "./wabaLimits";

/**
 * `outboundMessageLog` — raw per-send audit rows are kept for **90 days**.
 * Long enough to investigate any abuse/deliverability incident or dispute a
 * Meta bill (Meta bills per-send from Oct 2026), short enough that the
 * fastest-growing table in the schema stays bounded. The cost ledger is NOT
 * lost at purge: each expiring row is folded into its `messageLogRollups`
 * (retailer × MYT month × category × status) bucket in the same transaction
 * that deletes it, so aggregate cost/volume accounting survives forever.
 * Note the rollup deliberately drops `templateName` + `toWaPhone` — per-template
 * and per-recipient detail is a 90-day view; the monthly category ledger is the
 * permanent one.
 */
export const OUTBOUND_MESSAGE_LOG_RETENTION_MS = 90 * DAY_MS;

/**
 * `wabaHealth` — quality-rating history is kept for **90 days**, EXCEPT the
 * newest row, which is retained regardless of age: `canSend` reads the latest
 * row as the live quality state, and Meta health webhooks can be months apart,
 * so purging the newest row would silently fail the gateway open to HIGH.
 */
export const WABA_HEALTH_RETENTION_MS = 90 * DAY_MS;

/**
 * `adminAuditLog` — admin-on-behalf write trail kept for **24 months** (stated
 * decision: a compliance-friendly window — long enough to answer "who at
 * Kedaipal touched my store?" for any plausible dispute or PDPA access request,
 * bounded so the trail doesn't outlive its usefulness). 24 months ≈ 730 days;
 * MY has no DST so day math is exact.
 */
export const ADMIN_AUDIT_LOG_RETENTION_MS = 730 * DAY_MS;

// ---------------------------------------------------------------------------
// Deliberately NOT purged (documented decisions, not oversights):
//
// `orderEvents` — no retention window in this ticket. An order's event timeline
// is part of the order record; its lifetime is tied to ORDER retention, which
// is ticket 86eydwct5 (PDPA Q2 — the order/customer retention numbers are
// pending a business decision; proposal on 86ey5m3hx: proofs/images 6mo
// post-completion, orders anonymised at 24mo — not yet decided). Purging events
// on a different clock than their orders would leave half-erased histories, so
// they wait for that ticket. Hard-delete already cascades them
// (deleteOrderCascade), so the table only grows with LIVE orders.
//
// `optOuts` — NEVER purged. An opt-out row is the buyer's standing legal
// instruction ("do not message me") across the whole shared WABA number;
// deleting it re-consents the buyer on our behalf. The table grows with
// distinct humans who said STOP, not with traffic, so it stays small — and
// reads of it must be indexed/bounded (see adminListVendors), never
// "small enough to .collect()".
// ---------------------------------------------------------------------------

/**
 * Rows deleted per purge transaction before the cron self-chains
 * (ctx.scheduler.runAfter(0, ...)) — the counterCheckout.purgeStaleSessions /
 * migrations.ts house pattern, keeping each transaction well inside Convex
 * limits no matter how large the backlog.
 */
export const LOG_PURGE_PAGE_SIZE = 100;

/**
 * MYT calendar-month key ("YYYY-MM") for a timestamp — the `messageLogRollups`
 * bucket key. Same convention as lib/usagePeriod.ts `monthStartMyt`: Malaysia
 * is UTC+8 with no DST, so the month boundary is a fixed offset — drift-free,
 * no timezone library.
 */
export function mytMonthKey(epochMs: number): string {
	return new Date(epochMs + MYT_OFFSET_MS).toISOString().slice(0, 7);
}
