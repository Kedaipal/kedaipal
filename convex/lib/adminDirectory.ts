// How much of the store book an admin console surface pulls (ClickUp
// z8r3fdpm2p). Shared because two surfaces list the SAME stores and must not
// disagree about which ones exist: the sellers directory
// (`admin.listSellersForAdmin`) and the billing picker
// (`invoices.listRetailersForAdmin`).
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
