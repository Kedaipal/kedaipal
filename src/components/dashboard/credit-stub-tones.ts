/**
 * The credits stub's colours per tone, shared by the profile menu's stub and
 * the always-on `CreditTicket` torn from it (z8r3fdx34j), so the two can
 * never drift apart. Every raw palette colour carries its `dark:` pair.
 */

import type { CreditStub } from "../../lib/credit-stub";

/** The headline's ink. */
export const STUB_INK: Record<CreditStub["tone"], string> = {
	ok: "text-foreground",
	onus: "text-foreground",
	low: "text-amber-700 dark:text-amber-300",
	out: "text-red-600 dark:text-red-400",
};
/** A filled perforation dot. */
export const STUB_DOT: Record<CreditStub["tone"], string> = {
	ok: "bg-accent",
	onus: "bg-accent",
	low: "bg-amber-500",
	out: "bg-red-500",
};
