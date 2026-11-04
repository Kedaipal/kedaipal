// The admin seller directory's row — every fact the table, the phone cards,
// the detail sheet and the CSV render for one store. Pure types only, so the
// client can `import type` it and `convex/lib` stays free of function modules.
// ONE author builds it: `buildAdminSellerRow` in `convex/adminSellers.ts`.

import type { Doc, Id } from "../_generated/dataModel";
import type { Country } from "./country";
import type { AcquisitionChannel, AcquisitionSetBy } from "./metrics";
import type { BillingCurrency } from "./plans";
import type { StoreAvailability } from "./storeAvailability";

export type AdminSellerRow = {
	/** Store availability (`z8r3fdudf7`) — the resolved state, from the one
	 * resolver the order doors use, plus Kedaipal's own switch and note so the
	 * sheet can show and lift it. */
	availability: StoreAvailability;
	adminAvailability?: { mode: "paused" | "offline"; note?: string; at?: number };
	/** The seller's own pause, which an admin switch on top hides from the
	 * resolved state — so "Reopen" can say what will still be off. */
	sellerPaused?: boolean;
	_id: Id<"retailers">;
	storeName: string;
	slug: string;
	/** Clerk subject of the owner — shown so an admin can match a store to a person. */
	ownerUserId: string;
	/** True when the store's OWNER is a Kedaipal admin (in `ADMIN_USER_IDS`). The
	 * directory renders an "Admin" pill instead of a subscription/plan status for
	 * these — an admin runs the app for free with the highest tier unlocked, so a
	 * trial/plan countdown would be misleading. A boolean only: the allowlist
	 * itself never crosses to the client. See docs/admin-console.md. */
	ownerIsAdmin: boolean;
	/** Team seats (86exr91r4): people with access (owner + active members) over
	 * the plan's total-people cap; `capUnlimited` for comped/admin stores.
	 * Pending invites shown separately so "2/3 +1 invited" reads at a glance. */
	seats: { active: number; cap: number; capUnlimited: boolean; invited: number };
	isFoundingMember: boolean;
	/** Onboarded with a founding promise (`subscriptions.foundingIntent`) — a
	 * founding store in waiting, refused an Enterprise contract like a member
	 * (T6), so the contract form says so before the tap. */
	foundingIntent: boolean;
	foundingMemberRank?: number;
	subscriptionStatus?: Doc<"subscriptions">["status"];
	plan?: Doc<"subscriptions">["plan"];
	/** The Enterprise contract (Credits T6) — admin-only, so the whole thing
	 * rides here (contact, notes) for the seller sheet's Enterprise section;
	 * `setBy` stays server-side (the audit log answers "who"). */
	enterprise?: Omit<NonNullable<Doc<"subscriptions">["enterprise"]>, "setBy">;
	/** A scheduled tier move (a downgrade, or an Enterprise store's move to
	 * Pro) and when it lands. */
	pendingPlanChange?: {
		plan: NonNullable<Doc<"subscriptions">["pendingPlanChange"]>["plan"];
		requestedAt: number;
	};
	/** The owner tapped the in-app "Talk to Arif" (z8r3fdkp8h follow-up) —
	 * an open Enterprise lead. Absent once a contract lands or an admin
	 * dismisses it; drives the "Wants Enterprise" filter. */
	enterpriseInterestAt?: number;
	/** On the house (z8r3fdeub2). True for an admin-granted comp AND for a
	 * legacy stampless comped row — the chip renders either way. */
	comped: boolean;
	/** The admin-granted stamp (kind/label/note, since when) — prefills the comp
	 * dialog for edits. `grantedBy` stays server-side (a raw Clerk subject is
	 * noise here; the audit log answers "who"). Absent on legacy rows. */
	comp?: {
		kind: "partner" | "sponsor" | "pilot" | "internal";
		label?: string;
		note?: string;
		grantedAt: number;
	};
	/** When an admin turned this store's comp upgrade off, while the store is
	 * still an expired seller because of it (cleared once it pays or is
	 * re-comped). Lets the directory say why a store is past due. */
	compEnded?: { at: number };
	/** Marketing tag the seller signed up with (`retailers.signupSource`,
	 * z8r3fdd1v0). Absent = untagged/direct. Rendered verbatim — these are
	 * Kedaipal's own acquisition tags (`powered-by`, `spotlight-<member>`, …),
	 * not the buyer-side labels. */
	signupSource?: string;
	/** The store whose "Powered by Kedaipal" badge brought this seller in
	 * (`retailers.signupReferrerId`, z8r3fdcwd0), resolved to its CURRENT slug
	 * + name. Absent = no badge referrer, or one that has since been purged. */
	signupReferrer?: { slug: string; storeName: string };
	/** Who REFERRED this store through the referral programme (z8r3fdetf5) —
	 * the `referrals` row the reward keys off, distinct from the badge
	 * attribution above. `referrer` is null when that store has since been
	 * deleted (the referral stands). */
	referral?: {
		referrer: { slug: string; storeName: string } | null;
		via: "link" | "admin";
		at: number;
		/** The reward (T2), once the store's first invoice was paid. */
		reward?: {
			refereeCredits: number;
			referrerCredits?: number;
			referrerOutcome: "granted" | "unmetered" | "deleted" | "self";
		};
	};
	/** Whether an admin can still set, change or remove the referral: the
	 * store hasn't paid its first plan invoice (the reward's moment). */
	referralEditable: boolean;
	/** Any invoice has ever been paid — a paying store, churned ones
	 * included. Drives the "Untagged payers" filter. */
	hasPaidInvoice: boolean;
	/** Which motion won this store (86eye3eyp): the channel, who set it
	 * (an admin tag is authoritative; a seller's onboarding answer waits for
	 * confirmation) and the channel the captured signals point at, for the
	 * tag dialog to pre-select. `channel` absent = untagged. */
	acquisition: {
		channel?: string;
		setBy?: AcquisitionSetBy;
		note?: string;
		at?: number;
		suggested: AcquisitionChannel | null;
	};
	createdAt: number;
	/** Pre-built store, not yet handed over (docs/prebuilt-stores.md). An admin
	 * built it before the vendor had an account, so it has no owner: every
	 * owner-shaped fact on this row (`ownerUserId`, `ownerEmail`, seats) is a
	 * placeholder or absent, and the directory must say "Unclaimed" rather than
	 * render a blank person. Flips to false the moment the vendor claims it. */
	unclaimed: boolean;
	/** The address that will claim it (`retailers.pendingOwnerEmail`). Only ever
	 * set while `unclaimed` — absent means an admin is still building and hasn't
	 * been given the vendor's email, which is a normal state the console names
	 * ("No handover email yet") rather than leaving blank. */
	pendingOwnerEmail?: string;
	/** When the handover invitation was last emailed (z8r3fdmy7n). Absent while
	 * an address is named but never told — the commonest way a handover stalls,
	 * so the console surfaces it rather than leaving the admin to remember. */
	handoverInviteSentAt?: number;
	/** When a pre-built store was handed over. Set = this store started life
	 * unclaimed; absent = it was created by its own owner, like every store
	 * before this feature. */
	claimedAt?: number;
	/** A dev-only purge cascade is running (z8r3fdbmc9) — the directory locks
	 * the row (no Manage, no second purge) until it disappears. */
	purging: boolean;
	/** Marketplace state (z8r3fdkmyp): the seller's own opt-out stamp
	 * (read-only here — only the seller flips it), the admin-set paid window,
	 * the admin's "keep this comped store off the rail" override, the admin's
	 * hide (with its note to the seller), and whether the store is internal
	 * (never listed). Whether it's ON the rail is judged with
	 * `highlightSource` over these + `comped`/`comp.kind` — never re-derived
	 * inline. */
	marketplace: {
		unlistedAt?: number;
		sponsoredUntil?: number;
		compHighlightOffAt?: number;
		hidden?: { at: number; note?: string };
		internal: boolean;
	};
	// --- Contact + billing facts (z8r3fdh37c) ------------------------------
	// Everything an admin used to open a second tab for. All of it already
	// lived on `retailers` / `subscriptions` / `invoices` / `adminAuditLog`;
	// the directory just never carried it.
	/** The owner's email. Clerk's identity email is never stored, so this is
	 * `retailers.notifyEmail` — prefilled from Clerk at createRetailer and
	 * backfilled by `ensureNotifyEmailFromIdentity`. Absent = the seller cleared
	 * it, so the row says "no email on file" rather than showing nothing. */
	ownerEmail?: string;
	/** Buyer-facing store WhatsApp (`retailers.waPhone`), stored digits. */
	waPhone?: string;
	/** Where seller order alerts go (`retailers.notifyWaPhone`), stored digits.
	 * Often the same number as `waPhone`; the sheet collapses the duplicate. */
	notifyWaPhone?: string;
	country: Country;
	currency: string;
	billingCycle?: Doc<"subscriptions">["billingCycle"];
	/** The free period's backstop deadline — what "trial ends" means while the
	 * row is `trialing` and no invoice has been issued yet. */
	trialEndsAt?: number;
	/** When the free period actually ended (first order or the backstop) — set
	 * once the first invoice is issued; absent = still free. */
	freePeriodEndedAt?: number;
	freePeriodEndReason?: Doc<"subscriptions">["freePeriodEndReason"];
	/** What an `active` row renews at, and what an `on_hold` row's next hold
	 * period bills at. */
	currentPeriodEnd?: number;
	cancelledAt?: number;
	/** When the current Off-Season Hold began (z8r3fday24). */
	heldAt?: number;
	/** Saved auto-renew method (86eyb6z4r) — the rail, plus dunning state so
	 * "card failing ×2" reads on the row instead of in a webhook log. */
	autoRenew?: {
		method: string;
		methodLabel?: string;
		attachedAt: number;
		failedAttempts?: number;
		nextRetryAt?: number;
	};
	/** The open bill, if any — the thing to chase on a past-due row. Its
	 * tier and term say, before the tap, why a contract can't be saved or a
	 * move to Pro scheduled while it's open (T6). */
	pendingInvoice?: {
		invoiceNumber: string;
		dueDate: number;
		total: number;
		currency: string;
		hasPayNowLink: boolean;
		plan: Doc<"subscriptions">["plan"];
		billingCycle: Doc<"subscriptions">["billingCycle"];
		kind: "plan" | "hold";
	};
	/** The currency this store is billed in — its country's
	 * (`storeBillingCurrency`). A new Enterprise contract is frozen in exactly
	 * this, so the form labels the fee with it (T6). */
	billingCurrency: BillingCurrency;
	/** The most recently settled bill — "when did they last pay, how much". */
	lastPaidInvoice?: {
		invoiceNumber: string;
		paidAt: number;
		total: number;
		currency: string;
	};
	/** When a Kedaipal admin last opened this store in act-as mode
	 * (`adminAuditLog` `actAs.sessionStart`). Absent = never. */
	lastActAsAt?: number;
	/** Kedaipal Credits (T5, docs/credits.md): the store's CACHED balances —
	 * the plan bucket (this period's monthly credits; negative = orders owed),
	 * purchased credits (packs and admin lots), the usage period they belong
	 * to and what it granted, when the total last reached zero (`exhaustedAt`,
	 * set only while it's still there — "out of credits since"), and an
	 * admin's custom monthly grant. Absent = no credit account yet (a store
	 * the backfill hasn't reached). The drawer reads the live projection
	 * (`credits.adminGetAccount`); the directory reads the cache, which can
	 * lag a month boundary by the few minutes before the 00:05 MYT roll. */
	credits?: {
		plan: number;
		purchased: number;
		periodKey: string;
		periodGrant: number;
		exhaustedAt?: number;
		customGrant?: number;
	};
};

