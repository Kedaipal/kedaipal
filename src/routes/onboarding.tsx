import {
	RedirectToSignIn,
	RedirectToSignUp,
	Show,
} from "@clerk/tanstack-react-start";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { Sparkles } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import {
	COUNTRIES,
	COUNTRY_CURRENCY,
	COUNTRY_LABELS,
	type Country,
} from "../../convex/lib/country";
import {
	MOBILE_EXAMPLE,
	MOBILE_KIND,
	MOBILE_MESSAGE,
	otherCountryMobile,
} from "../../convex/lib/slug";
import { OnboardingTopBar } from "../components/onboarding/onboarding-top-bar";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { MyPhoneInput } from "../components/ui/my-phone-input";
import { useLandingRegion } from "../hooks/useLandingRegion";
import { useOnboardingStart } from "../hooks/useOnboardingStart";
import { useSlugAvailability } from "../hooks/useSlugAvailability";
import { convexErrorMessage } from "../lib/format";
import { readGaClientId, trackEvent } from "../lib/ga-events";
import {
	readMarketingReferrerStore,
	readMarketingSource,
} from "../lib/marketing-attribution";
import {
	decodeOnboardingPrefill,
	type OnboardingPrefill,
} from "../lib/onboarding-link";
import type { ClaimRefusal } from "../../convex/lib/unclaimedStore";
import { clearStoredActAs } from "../hooks/useActAs";
import { waPhoneCheckoutSchema } from "../lib/schemas";
import { slugify, validateStoreName } from "../lib/slug";

/**
 * Optional prefill, carried as a single URL-safe token (`?p=…`). Set when Kedaipal
 * staff generate an "onboard a client" link from the admin billing page — the
 * store name / slug / WhatsApp number are seeded so the client just reviews +
 * confirms. The store is still created under the **client's own** Clerk login (they
 * sign up first), so ownership is never ambiguous. A single token (vs separate
 * query params) survives the Clerk auth redirect intact. See onboarding-link.ts.
 */
type OnboardingSearch = {
	prefill?: OnboardingPrefill;
};

export const Route = createFileRoute("/onboarding")({
	validateSearch: (search: Record<string, unknown>): OnboardingSearch => {
		const token = typeof search.p === "string" ? search.p : undefined;
		return { prefill: decodeOnboardingPrefill(token) };
	},
	component: OnboardingRoute,
});

function OnboardingRoute() {
	// Preserve the prefill token across the auth round-trip — otherwise Clerk would
	// bounce the client back to a bare /onboarding and drop the prefill.
	const location = useLocation();
	const search = Route.useSearch();
	// An admin-invited client (has a prefill token) is brand-new — send them to
	// SIGN-UP, not sign-in (sign-in would dead-end with "couldn't find account").
	// Everyone else reaching /onboarding signed-out already has an account → sign-in.
	const fallback = search.prefill ? (
		<RedirectToSignUp
			signUpForceRedirectUrl={location.href}
			signUpFallbackRedirectUrl={location.href}
		/>
	) : (
		<RedirectToSignIn signInForceRedirectUrl={location.href} />
	);
	return (
		<Show when="signed-in" fallback={fallback}>
			<OnboardingForm />
		</Show>
	);
}

// Helper line under the assisted-onboarding phone field — names the mobile
// kind the picked country's validator arm accepts (SG-lite, 86eynw2dy).
const WA_PHONE_HELP: Record<Country, string> = {
	MY: "The Malaysian mobile buyers reach you on. Leave blank to add it later.",
	SG: "The Singapore mobile buyers reach you on. Leave blank to add it later.",
};

function OnboardingForm() {
	const navigate = useNavigate();
	const search = Route.useSearch();
	const retailer = useQuery(convexQuery(api.retailers.getMyRetailer, {})).data;
	// Pre-built store handover (docs/prebuilt-stores.md): is a finished store
	// waiting for this login? Read here, beside the "do I already have a store?"
	// question, because the answer decides WHICH SCREEN this is — not a banner on
	// top of a wizard the vendor must not use.
	const claimable = useQuery(convexQuery(api.retailers.myClaimableStore, {}))
		.data;
	const createRetailer = useMutation(api.retailers.createRetailer);
	// Assisted = an admin-generated prefill link. Seed the fields, surface the WA
	// number for review, and tell the client what's going on.
	const prefill = search.prefill;
	const assisted = Boolean(prefill);

	// GA4 funnel (z8r3fdd1v0): fires onboarding_start only once the query says
	// "no store yet" — an already-onboarded seller landing here gets redirected
	// below and must not count as a funnel entry.
	useOnboardingStart(retailer);

	const [storeName, setStoreName] = useState(prefill?.store ?? "");
	const [slug, setSlug] = useState(prefill?.slug ?? "");
	// If a slug came in the link, treat it as hand-set so it's not re-derived.
	const [slugEdited, setSlugEdited] = useState(Boolean(prefill?.slug));
	const [waPhone, setWaPhone] = useState(prefill?.wa ?? "");
	// Inline rejection for the (assisted) WhatsApp field — set on submit, not
	// per keystroke, and cleared the moment the number or the country changes.
	const [waPhoneError, setWaPhoneError] = useState<string | null>(null);
	// Store country (SG-lite). Picked BEFORE the store exists because currency
	// is born from it (SG → SGD) and products freeze their currency at create —
	// fixing it after the catalog exists means a bulk currency switch.
	//
	// The default is no longer a bare "MY" (z8r3fdbmc9): self-serve seeds from
	// the SAME resolution the pricing pages use — the visitor's stored
	// RegionToggle pick, else Cloudflare's geo answer, else the device time
	// zone (`useLandingRegion`) — so a seller who was just reading S$ pricing
	// isn't handed Malaysia at the moment currency binds to the store. The
	// picker stays visible, so a wrong guess costs one tap, and an explicit
	// pick here writes the same region cookie, keeping the marketing pages on
	// the currency the seller chose. Assisted invites bypass the guess
	// entirely: the token is admin-curated, and an ABSENT country there means
	// Malaysia (only the non-default country rides the token — see
	// onboarding-link.ts).
	const [region, setRegion] = useLandingRegion();
	const [assistedCountry, setAssistedCountry] = useState<Country>(
		prefill?.country ?? "MY",
	);
	const country = assisted ? assistedCountry : region;
	function setCountry(next: Country) {
		if (assisted) setAssistedCountry(next);
		else setRegion(next);
		// The verdict on the typed number changes with the plate.
		setWaPhoneError(null);
	}
	const [submitting, setSubmitting] = useState(false);
	const [agreed, setAgreed] = useState(false);

	const availability = useSlugAvailability(slug, "create");

	// Already onboarded → straight to dashboard.
	useEffect(() => {
		if (retailer) navigate({ to: "/app" });
	}, [retailer, navigate]);

	// Auto-derive slug from store name until the user hand-edits it.
	useEffect(() => {
		if (!slugEdited) setSlug(slugify(storeName));
	}, [storeName, slugEdited]);

	// `claimable.state === "anonymous"` means Convex answered before the Clerk
	// token attached — a timing state, not a verdict (see myClaimableStore).
	// Rendering the wizard on it flashed "Name your store" at a vendor whose
	// store was already built and waiting. Always transient here: this component
	// only mounts inside `<Show when="signed-in">`.
	if (
		retailer === undefined ||
		claimable === undefined ||
		claimable.state === "anonymous"
	) {
		return <LoadingScreen />;
	}

	// A store that is already theirs REPLACES the wizard — it never sits as a
	// banner above it. Their store exists, fully built; offering "Name your
	// store" beside it invites a second store this login cannot have, and
	// `createRetailer` would only refuse after they had filled the whole form.
	// A dead end dressed as a choice is worse than no choice (CLAUDE.md).
	if (claimable.state === "claimable") {
		return (
			<ClaimStoreScreen
				storeName={claimable.storeName}
				slug={claimable.slug}
			/>
		);
	}

	// Same rule as the server (`assertValidStoreName`), read inline before the
	// seller ever submits — the brand check is the one they would not guess.
	const nameCheck = validateStoreName(storeName);

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		if (!nameCheck.ok) {
			toast.error(nameCheck.message);
			return;
		}
		if (availability.status !== "available") return;
		if (!agreed) {
			toast.error(
				"Please accept the Terms, Privacy Policy, and Acceptable Use Policy",
			);
			return;
		}
		const trimmedWa = waPhone.trim();
		if (
			trimmedWa.length > 0 &&
			!waPhoneCheckoutSchema[country].safeParse(trimmedWa).success
		) {
			// Pointed copy, because the fix is on this screen: the Country picker
			// sits one field up. Falls back to the picked country's own line when
			// the digits match nobody.
			const other = otherCountryMobile(trimmedWa, country);
			setWaPhoneError(
				other
					? `That looks like a ${MOBILE_KIND[other]} number — switch Country above to ${COUNTRY_LABELS[other]}, or enter a ${MOBILE_KIND[country]} number (e.g. ${MOBILE_EXAMPLE[country]})`
					: MOBILE_MESSAGE[country],
			);
			return;
		}
		setSubmitting(true);
		try {
			// The tag the session arrived with (marketing routes / powered-by
			// badge) — the server re-sanitizes, this is only a hint. Beside it,
			// the store whose badge it was (z8r3fdcwd0) — the server resolves the
			// slug to a store and drops one that names nobody.
			const signupSource = readMarketingSource();
			const signupReferrerSlug = readMarketingReferrerStore();
			// GA client id, so server-side key events (first_order/subscribe_paid)
			// stitch to this browser's funnel — validated server-side, hint only.
			const gaClientId = readGaClientId();
			await createRetailer({
				storeName: storeName.trim(),
				slug,
				country,
				...(trimmedWa.length > 0 ? { waPhone: trimmedWa } : {}),
				// Founding-10: starts on the normal 14-day trial; the discounted Pro
				// plan begins once Arif marks their founding invoice paid.
				...(prefill?.founding ? { intent: "founding" as const } : {}),
				...(signupSource !== undefined ? { signupSource } : {}),
				...(signupReferrerSlug !== undefined ? { signupReferrerSlug } : {}),
				...(gaClientId !== undefined ? { gaClientId } : {}),
			});
			// The funnel's terminal key event — after the mutation succeeds, so a
			// slug collision or validation error can't inflate conversions.
			trackEvent("store_created");
			navigate({ to: "/app" });
		} catch (err) {
			toast.error(convexErrorMessage(err));
			setSubmitting(false);
		}
	}

	const canSubmit =
		nameCheck.ok &&
		availability.status === "available" &&
		agreed &&
		!submitting;

	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 pb-32 pt-6">
			{/* Brand + account bar — same container width as the form, so the page
			    says whose app this is and which account the store will belong to
			    (with the way out) before asking for anything. */}
			<OnboardingTopBar />
			{/* Team states (86exr91r4), ABOVE the wizard: a pending invitation is
			    almost always why an invited helper is standing here (they signed up
			    directly instead of tapping the email link), and a freshly-removed
			    member deserves the explanation before a bare "create your store". */}
			<PendingInvitesBanner />
			<RemovedFromTeamBanner />
			<HandoverBlockedBanner claimable={claimable} />
			<header className="flex flex-col gap-2">
				<p className="text-xs font-semibold uppercase tracking-widest text-accent">
					Step 1 of 1
				</p>
				<h1 className="text-3xl font-bold leading-tight">
					{assisted ? "Confirm your store" : "Name your store"}
				</h1>
				<p className="text-sm text-muted-foreground">
					This becomes your public link:{" "}
					<span className="font-mono text-foreground">
						kedaipal.com/{slug || "your-slug"}
					</span>
				</p>
			</header>

			{assisted ? (
				<div className="flex items-start gap-3 rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 text-sm">
					<Sparkles className="mt-0.5 size-4 shrink-0 text-accent" />
					<p className="text-muted-foreground">
						{prefill?.founding ? (
							<>
								You're being set up as a{" "}
								<span className="font-medium text-foreground">
									Founding Member
								</span>{" "}
								— your discounted Pro plan starts once you settle the first
								invoice. Review the details and tap{" "}
								<span className="font-medium text-foreground">
									Create store
								</span>
								.
							</>
						) : (
							<>
								Kedaipal set this up for you. Review the details below and tap{" "}
								<span className="font-medium text-foreground">
									Create store
								</span>{" "}
								— you can change anything later in Settings.
							</>
						)}
					</p>
				</div>
			) : null}

			<form onSubmit={handleSubmit} className="flex flex-col gap-5">
				<Field label="Store name">
					<Input
						type="text"
						value={storeName}
						onChange={(e) => setStoreName(e.target.value)}
						placeholder="e.g. Your store name"
						variant="field"
					/>
					{storeName.trim().length > 0 && !nameCheck.ok ? (
						<p className="text-sm text-destructive">✗ {nameCheck.message}</p>
					) : null}
				</Field>

				<Field label="URL slug">
					<div className="flex items-center rounded-xl border border-input bg-background pl-4 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/50">
						<span className="select-none text-muted-foreground">
							kedaipal.com/
						</span>
						<Input
							type="text"
							value={slug}
							onChange={(e) => {
								setSlug(e.target.value);
								setSlugEdited(true);
							}}
							placeholder="your-slug"
							variant="bare"
							className="min-h-11 flex-1 pr-4 font-mono text-base"
						/>
					</div>
					<AvailabilityHint state={availability} />
				</Field>

				<Field label="Country">
					<div className="grid grid-cols-2 gap-2">
						{COUNTRIES.map((c) => (
							<button
								key={c}
								type="button"
								aria-pressed={country === c}
								onClick={() => setCountry(c)}
								className={`min-h-11 rounded-xl border px-4 text-sm font-medium transition-colors ${
									country === c
										? "border-accent bg-accent/10 text-foreground"
										: "border-input bg-background text-muted-foreground hover:border-ring"
								}`}
							>
								{COUNTRY_LABELS[c]}
							</button>
						))}
					</div>
					<span className="text-xs text-muted-foreground">
						Sets your storefront currency ({COUNTRY_CURRENCY[country]}) and
						which phone numbers and addresses checkout accepts. You can change
						both later in Settings.
					</span>
				</Field>

				{assisted ? (
					<Field label="WhatsApp number">
						{/* Reacts to the country picker above LIVE — flipping to
						    Singapore re-plates the field to +65, matching the arm
						    createRetailer validates the same-call country with. */}
						<MyPhoneInput
							value={waPhone}
							onChange={(next) => {
								setWaPhone(next);
								if (waPhoneError) setWaPhoneError(null);
							}}
							country={country}
							isError={waPhoneError !== null}
						/>
						{waPhoneError ? (
							<span className="text-xs font-medium text-destructive">
								{waPhoneError}
							</span>
						) : (
							<span className="text-xs text-muted-foreground">
								{WA_PHONE_HELP[country]}
							</span>
						)}
					</Field>
				) : null}

				<label className="flex items-start gap-3 text-sm text-muted-foreground">
					<input
						type="checkbox"
						checked={agreed}
						onChange={(e) => setAgreed(e.target.checked)}
						className="mt-0.5 size-5 shrink-0 rounded border-input accent-accent"
					/>
					<span>
						I agree to the{" "}
						<Link
							to="/terms"
							target="_blank"
							className="font-medium text-foreground underline"
						>
							Terms
						</Link>
						,{" "}
						<Link
							to="/privacy"
							target="_blank"
							className="font-medium text-foreground underline"
						>
							Privacy Policy
						</Link>
						, and{" "}
						<Link
							to="/acceptable-use"
							target="_blank"
							className="font-medium text-foreground underline"
						>
							Acceptable Use Policy
						</Link>
						.
					</span>
				</label>
			</form>

			<div className="fixed inset-x-0 bottom-0 border-t border-border bg-background px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
				<div className="mx-auto max-w-md">
					<Button
						type="submit"
						onClick={handleSubmit}
						disabled={!canSubmit}
						className="h-12 w-full text-base"
					>
						{submitting ? "Creating…" : "Create store"}
					</Button>
				</div>
			</div>
		</main>
	);
}

function Field({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: input is nested via children prop
		<label className="flex flex-col gap-2">
			<span className="text-sm font-medium">{label}</span>
			{children}
		</label>
	);
}

function AvailabilityHint({
	state,
}: {
	state: ReturnType<typeof useSlugAvailability>;
}) {
	if (state.status === "idle") return null;
	const map = {
		checking: { text: "Checking…", className: "text-muted-foreground" },
		available: { text: "✓ Available", className: "text-accent" },
		taken: { text: "✗ Taken", className: "text-destructive" },
		invalid: {
			text: `✗ ${state.status === "invalid" ? state.message : ""}`,
			className: "text-destructive",
		},
	} as const;
	const info = map[state.status];
	return <p className={`text-sm ${info.className}`}>{info.text}</p>;
}

function LoadingScreen() {
	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-6">
			{/* Same bar as the form screen, so the brand doesn't blink in late. */}
			<OnboardingTopBar />
			<p className="m-auto text-sm text-muted-foreground">Loading…</p>
		</main>
	);
}

// ---------------------------------------------------------------------------
// Pre-built store handover (docs/prebuilt-stores.md)
// ---------------------------------------------------------------------------

/**
 * "Your store is ready" — the whole of a white-glove vendor's onboarding.
 *
 * Exported for the visual harness + onboarding-claim.test.tsx (same reason
 * comp-dialog exports its dialog): this screen is behind Clerk and a specific
 * data state, so the only way to LOOK at its states is to render it directly.
 *
 * REPLACES the wizard rather than banners it, because this login cannot create
 * a store (one store per login) and must not be shown a form that would refuse
 * at the end. The screen's job is to make a store the vendor has never seen
 * feel like theirs before they tap: it names the store, shows the real
 * storefront link they can open in a tab, and says what is inside.
 *
 * CONSENT IS TAKEN HERE. `createUnclaimedStore` deliberately stamps none — an
 * admin cannot agree to the Terms on the vendor's behalf — so this is the first
 * and only moment the person actually bound by the agreement accepts it, and
 * `claimStore` requires it. Same checkbox, same links, same "not pre-ticked"
 * rule as the wizard.
 */
export function ClaimStoreScreen({
	storeName,
	slug,
}: {
	storeName: string;
	slug: string;
}) {
	const navigate = useNavigate();
	const claimStore = useMutation(api.retailers.claimStore);
	const [agreed, setAgreed] = useState(false);
	const [claiming, setClaiming] = useState(false);
	const storefront = `kedaipal.com/${slug}`;

	async function handleClaim() {
		setClaiming(true);
		try {
			const result = await claimStore({ acceptedLegal: agreed });
			if (result.ok) {
				// The store just changed hands, so ANY act-as session pointing at
				// it is stale by definition — and the usual way to reach this
				// screen is the admin's own tab, where they built the store and
				// then signed out for the vendor to claim it. Without this the
				// vendor lands on their new dashboard wearing the admin's
				// "BUILDING" banner over a cached unclaimed payload (Zaki, 2 Oct).
				// Cleared through the provider-FREE helper: `ActAsProvider` wraps
				// the `/app` subtree only, so `useActAs()` throws on this route —
				// which is exactly how this screen crashed the first time a
				// vendor opened it. PR #325 makes act-as session-keyed in
				// general; this is the one moment that belongs to the handover.
				clearStoredActAs();
				toast.success(`${storeName} is yours — welcome to Kedaipal!`);
				navigate({ to: "/app" });
				return;
			}
			// The refusals are all "something changed since this page loaded" —
			// another tab claimed it, or this login joined a team meanwhile. Say
			// which, and leave them on a page that re-reads on refresh.
			toast.error(
				result.reason === "own_store"
					? `This login already runs ${result.storeName}, and an account can only hold one store.`
					: result.reason === "other_membership"
						? `You're on the team at ${result.storeName ?? "another store"}. Leave that team from Settings → Team first.`
						: result.reason === "unverified_email"
							? "Your email address isn't verified yet — verify it, then reload this page."
							: "This store is no longer waiting to be claimed — ask us to check it.",
			);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setClaiming(false);
		}
	}

	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 pb-32 pt-6">
			<OnboardingTopBar />
			<header className="flex flex-col gap-2">
				<p className="text-xs font-semibold uppercase tracking-widest text-accent">
					Ready for you
				</p>
				<h1 className="text-3xl font-bold leading-tight">
					{storeName} is set up
				</h1>
				<p className="text-sm text-muted-foreground">
					We built this store for you. Take it over and it's yours — products,
					settings and all.
				</p>
			</header>

			<div className="flex items-start gap-3 rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 text-sm">
				<Sparkles className="mt-0.5 size-4 shrink-0 text-accent" />
				<div className="flex min-w-0 flex-col gap-1">
					<p className="font-medium text-foreground">Your store link</p>
					<a
						href={`https://${storefront}`}
						target="_blank"
						rel="noreferrer"
						className="truncate font-mono text-[13px] text-accent-emphasis underline"
					>
						{storefront}
					</a>
					<p className="text-xs text-muted-foreground">
						Open it in a tab to see what buyers will see. It isn't listed
						publicly until you take it over.
					</p>
				</div>
			</div>

			<label className="flex items-start gap-3 text-sm text-muted-foreground">
				<input
					type="checkbox"
					checked={agreed}
					onChange={(e) => setAgreed(e.target.checked)}
					className="mt-0.5 size-5 shrink-0 rounded border-input accent-accent"
				/>
				<span>
					I agree to the{" "}
					<Link
						to="/terms"
						target="_blank"
						className="font-medium text-foreground underline"
					>
						Terms
					</Link>
					,{" "}
					<Link
						to="/privacy"
						target="_blank"
						className="font-medium text-foreground underline"
					>
						Privacy Policy
					</Link>
					, and{" "}
					<Link
						to="/acceptable-use"
						target="_blank"
						className="font-medium text-foreground underline"
					>
						Acceptable Use Policy
					</Link>
					.
				</span>
			</label>

			<div className="fixed inset-x-0 bottom-0 border-t border-border bg-background px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
				<div className="mx-auto w-full max-w-md">
					<Button
						className="h-12 w-full text-base"
						disabled={!agreed || claiming}
						onClick={() => void handleClaim()}
					>
						{claiming ? "Taking over…" : `Take over ${storeName}`}
					</Button>
					{/* Disabled-with-reason: the button above goes quiet until the box
					    is ticked, and a quiet button with no reason is the oldest
					    dead end there is. */}
					<p className="mt-2 text-center text-xs text-muted-foreground">
						{agreed
							? "Your 14-day free trial starts when you take it over — not before."
							: "Tick the box above to continue."}
					</p>
				</div>
			</div>
		</main>
	);
}

/**
 * A store IS waiting for this address, but this login can't hold it — it
 * already runs a store, or sits on another store's team.
 *
 * Without this the vendor sees nothing at all: `myClaimableStore` would answer
 * "none", the wizard would render, and the store we built for them would be
 * invisible with no hint that it exists or why they can't reach it. Same shape
 * as `RemovedFromTeamBanner` — one explanation, one way out.
 */
export function HandoverBlockedBanner({
	claimable,
}: {
	claimable:
		| { state: "anonymous" }
		| { state: "none" }
		| { state: "blocked"; storeName: string; refusal: ClaimRefusal };
}) {
	if (claimable.state !== "blocked") return null;
	const { storeName, refusal } = claimable;
	const why =
		refusal.reason === "own_store"
			? `This login already runs ${refusal.storeName}, and an account can only hold one store. Close that store first, or sign up with a different email and tell us which one to use.`
			: refusal.reason === "other_membership"
				? `You're on the team at ${refusal.storeName ?? "another store"}, and an account can only be in one store. Leave that team from Settings → Team, then reload this page.`
				: "Your email address isn't verified yet. Verify it, then reload this page.";
	return (
		<div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
			<p className="text-sm font-semibold">
				{storeName} is waiting for you — but not on this login
			</p>
			<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
				{why}
			</p>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Team banners (86exr91r4)
// ---------------------------------------------------------------------------

/** "You've been invited to {Store}" — the direct-signup path: the helper made
 * an account without tapping the email link, so the invite must find THEM.
 * Accepting here is safe without the token because the list only ever holds
 * invites addressed to this login's verified email. */
function PendingInvitesBanner() {
	const navigate = useNavigate();
	const invites = useQuery(convexQuery(api.team.myPendingInvites, {})).data;
	const accept = useMutation(api.team.acceptPendingInvite);
	const [joining, setJoining] = useState<string | null>(null);
	if (!invites || invites.length === 0) return null;
	return (
		<div className="flex flex-col gap-3 rounded-2xl border border-accent/30 bg-accent/5 p-4">
			{invites.map((invite) => (
				<div
					key={invite.memberId}
					className="flex flex-wrap items-center gap-3"
				>
					<div className="min-w-0 flex-1 basis-48">
						<p className="text-sm font-semibold">
							You've been invited to {invite.storeName}
						</p>
						<p className="text-xs text-muted-foreground">
							Join their team instead of creating a store — you'll work from
							this login with the access they set.
						</p>
					</div>
					<Button
						className="h-10"
						disabled={joining !== null}
						onClick={async () => {
							setJoining(invite.memberId);
							try {
								const result = await accept({ memberId: invite.memberId });
								if (result.ok) {
									toast.success(`Welcome to ${result.storeName}!`);
									navigate({ to: "/app" });
									return;
								}
								toast.error(
									result.reason === "no_seat"
										? `${invite.storeName} has no free seat any more — ask the owner to resend once one opens.`
										: result.reason === "expired"
											? "That invitation expired — ask the owner to resend it."
											: "That invitation is no longer valid — ask the owner to resend it.",
								);
							} catch (err) {
								toast.error(convexErrorMessage(err));
							} finally {
								setJoining(null);
							}
						}}
					>
						{joining === invite.memberId ? "Joining…" : "Join"}
					</Button>
				</div>
			))}
		</div>
	);
}

/** The removed state: without this, a helper the owner removed lands on a bare
 * "create your store" wizard with no idea why — the one screen the spec says
 * must explain itself. */
function RemovedFromTeamBanner() {
	const membership = useQuery(convexQuery(api.team.myMembershipState, {})).data;
	const removed = membership?.removed;
	if (!removed) return null;
	const why =
		removed.reason === "plan_change"
			? `${removed.storeName} moved to a plan with fewer team seats, so your seat was released.`
			: removed.reason === "store_deleted"
				? `${removed.storeName} closed their Kedaipal store.`
				: `The owner of ${removed.storeName} removed your team access.`;
	return (
		<div className="rounded-2xl border border-border bg-muted/50 p-4">
			<p className="text-sm font-semibold">
				You no longer have access to {removed.storeName}
			</p>
			<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
				{why}{" "}
				{removed.reason === "removed_by_owner"
					? "If that's a surprise, ask them directly — or start a store of your own below."
					: "You can start a store of your own below, or ask the owner to re-invite you."}
			</p>
		</div>
	);
}
