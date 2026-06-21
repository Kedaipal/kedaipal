// Builds the prefilled onboarding invite link the admin sends to a client when
// onboarding them by hand (admin billing → "Onboard a client"). The client opens
// it, signs in once, and confirms — the store is created under *their* own Clerk
// login, so ownership is never ambiguous. Kept pure so it's unit-testable and the
// param contract stays in lockstep with onboarding.tsx's `validateSearch`.

export type OnboardingInviteFields = {
	storeName: string;
	slug?: string;
	waPhone?: string;
};

/**
 * Compose `<origin>/onboarding?store=…&slug=…&wa=…&via=admin`. Blank optional
 * fields are omitted (not emitted as empty params). Values are URL-encoded by
 * `URLSearchParams`. Returns `""` when there's no usable store name, so callers
 * can gate the copy button on a truthy result.
 */
export function buildOnboardingInviteLink(
	origin: string,
	fields: OnboardingInviteFields,
): string {
	const store = fields.storeName.trim();
	if (store.length === 0) return "";

	const params = new URLSearchParams({ store, via: "admin" });
	const slug = fields.slug?.trim();
	if (slug) params.set("slug", slug);
	const wa = fields.waPhone?.trim();
	if (wa) params.set("wa", wa);

	return `${origin}/onboarding?${params.toString()}`;
}
