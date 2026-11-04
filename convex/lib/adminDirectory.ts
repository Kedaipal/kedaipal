// How much of the store book an admin console surface pulls as FULL rows
// (ClickUp z8r3fdpm2p). Born shared because two surfaces listed the SAME
// stores and must not disagree about which ones exist: the sellers directory
// (`admin.listSellersForAdmin`, retired 4 Nov 2026 — the directory is
// cursor-paginated and reaches every store) and the billing picker
// (`invoices.listRetailersForAdmin`), which still takes it.
//
// They did disagree — 500 against a bare `200` — and the billing picker is
// ordered NEWEST FIRST, so past 200 stores the oldest simply vanished from
// it. With the Enterprise contract now reachable from that picker, an older
// store could be put on a contract from the seller sheet and not from
// billing: two doors to one act, one of which couldn't see the store. Found
// in review of PR #344 by the session on #346, whose batch pre-building makes
// it bite much sooner than the raw number suggests — a batch of placeholder
// stores is the NEWEST rows, so it pushes exactly that many real paying
// customers off the end of the list.
//
// One constant, so the next surface that lists stores inherits the answer
// instead of typing its own.
export const ADMIN_STORE_LIST_LIMIT = 500;

// How many stores a SLIM whole-book scan reads: the paginated directory's
// counts (`adminSellers.countSellerBuckets`) and the showcase store picker's
// country list (`adminSellers.listPickerStores`). The directory list itself is
// cursor-paginated and reaches every store; only the numbers on the Status
// menu and "every store in this region" need the whole book in one read, at
// one retailer + one subscription read per store. Against
// Convex's 16,384-documents-per-query limit that is a ~3,000-store ceiling, so
// the scan stops here and says so (`capped`) rather than under-counting
// silently. Past it the honest fix is the Aggregate component with per-bucket
// counters, not a bigger number.
export const ADMIN_COUNT_SCAN_LIMIT = 2000;

/**
 * The key the "Name A–Z" sort indexes on (`retailers.by_storeNameKey`). A
 * Convex index orders strings by UTF-8 bytes, so sorting on `storeName` itself
 * files "iKuih" after "Zed"; the key is the name lowercased, trimmed and with
 * inner whitespace collapsed. Written wherever `storeName` is written
 * (`retailers.createRetailer`, the pre-built insert, `updateSettings`, seed)
 * and backfilled once by `migrations:backfillStoreNameKey`.
 */
export function storeNameKeyOf(storeName: string): string {
	return storeName.trim().replace(/\s+/g, " ").toLowerCase();
}
