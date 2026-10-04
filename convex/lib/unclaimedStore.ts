// Pre-built stores, handed over later (admin white-glove).
//
// An admin can build a whole store — catalog, fulfilment, settings, branding —
// BEFORE the vendor has an account anywhere, then hand it over by naming the
// email they will sign up with. The vendor signs in once and the store is
// theirs. Nothing is "transferred" out of a Clerk account, because the store
// was never bound to one: see docs/prebuilt-stores.md.
//
// THE OWNERLESS STATE, and why it is spelled into `retailers.userId`:
// every store-scoped read and write already resolves through
// `requireRetailerAccess`, whose owner branch is `retailer.userId === subject`.
// A store nobody owns therefore needs a `userId` that NO Clerk subject can
// ever equal — a sentinel. Putting the sentinel in the owner field (rather
// than adding a parallel `isUnclaimed` boolean beside a real-looking owner)
// means the existing gate refuses the whole world by construction: there is no
// new code path to forget. Admins still get in through the gate's admin branch
// (`ADMIN_USER_IDS`), which never looked at who the owner was — which is why
// act-as works on a pre-built store with no changes at all.
//
// The sentinel is UNIQUE PER STORE, not a shared constant. `retailers.by_user`
// is read with `.first()` everywhere on the assumption that a userId names at
// most one store; a shared "unclaimed" value would make two pre-built stores
// collide on that index and the second one would become unreachable.
//
// TWO facts, deliberately separate:
//   - the sentinel `userId` — "nobody owns this yet";
//   - `pendingOwnerEmail` — "…and THIS address gets it".
// An admin starts building before they have been given the vendor's email, so
// "built, no email yet" has to be representable. Keying unclaimed-ness on the
// email would make that state impossible to write down.

/** Marks an owner id as a placeholder rather than a Clerk subject. Clerk
 * subjects are `user_…`, so no real identity can ever collide with this. */
export const UNCLAIMED_OWNER_PREFIX = "unclaimed:";

const SENTINEL_ALPHABET =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const SENTINEL_LENGTH = 24;

/**
 * Mint a fresh placeholder owner id. Random (not sequential) so two stores
 * built in the same moment cannot collide on `retailers.by_user`, and so the
 * value carries no information. Web Crypto, available in both Convex runtimes
 * — same approach as `generateTrackingToken`.
 */
export function mintUnclaimedOwnerId(): string {
	const bytes = new Uint8Array(SENTINEL_LENGTH);
	crypto.getRandomValues(bytes);
	let suffix = "";
	for (let i = 0; i < SENTINEL_LENGTH; i++) {
		suffix += SENTINEL_ALPHABET[bytes[i] % SENTINEL_ALPHABET.length];
	}
	return `${UNCLAIMED_OWNER_PREFIX}${suffix}`;
}

/**
 * Is this store still waiting for its owner? THE one reader of the sentinel —
 * nothing else anywhere should test the prefix by hand, so the representation
 * stays changeable and every surface agrees on the answer.
 *
 * Takes the narrow `{ userId }` shape so a projected admin row, a full doc and
 * a test fixture can all ask.
 */
export function isUnclaimed(store: { userId: string }): boolean {
	return store.userId.startsWith(UNCLAIMED_OWNER_PREFIX);
}

/**
 * Why a sign-in could not take a store it was offered. Mirrors the team-invite
 * vocabulary (`convex/team.ts` `AcceptResult`) on purpose: the two flows refuse
 * for the same reasons — one login cannot be in two stores — so the copy a
 * seller reads should not depend on which door they came through.
 */
export type ClaimRefusal =
	/** No store is waiting for this caller's verified email. */
	| { reason: "none" }
	/** They already own a store. */
	| { reason: "own_store"; storeName: string }
	/** They are on another store's team. */
	| { reason: "other_membership"; storeName?: string }
	/** Their Clerk email is unverified, so it proves nothing. */
	| { reason: "unverified_email" };
