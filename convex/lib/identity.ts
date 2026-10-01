// What a Clerk identity PROVES about the person holding it.
//
// One author for both flows that bind a store to a person by email — the team
// invite (convex/team.ts) and the pre-built store handover
// (retailers.claimStore) — because they turn on the same question, and the
// quiet failure is the same in both: comparing `identity.email` while
// forgetting `emailVerified`, which lets an address nobody confirmed stand in
// for control of an inbox.

/**
 * The Clerk identity's VERIFIED email, normalized like stored addresses are.
 *
 * Verification is the whole basis for "the token proves the link, the email
 * proves the person": a seat — or, for a pre-built store, OWNERSHIP — is bound
 * to whoever controls the named inbox, so an address the provider hasn't
 * confirmed is not evidence of control. Today that holds by configuration —
 * Clerk is on email-code sign-in, which can't complete on an unverified
 * address — and this makes it hold by CODE, so enabling password sign-up later
 * can't quietly turn "registered the named address first" into "took the
 * store". The check lives at the one seam every binding path shares, rather
 * than at the call sites, one of which would eventually be forgotten.
 *
 * An ABSENT claim stays permissive: a JWT template may simply not carry
 * `email_verified`, and reading "unknown" as "unverified" would lock every
 * accept out on a config change in the harmless direction. Only an explicit
 * `false` refuses.
 *
 * Callers must treat undefined as "this identity proves no address" — never
 * fall back to the raw `identity.email`.
 */
export function identityEmail(identity: {
	email?: unknown;
	emailVerified?: unknown;
}): string | undefined {
	if (identity.emailVerified === false) return undefined;
	return typeof identity.email === "string" && identity.email.trim().length > 0
		? identity.email.trim().toLowerCase()
		: undefined;
}
