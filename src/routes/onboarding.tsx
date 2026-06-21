import { RedirectToSignIn, Show } from "@clerk/tanstack-react-start";
import {
	createFileRoute,
	Link,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { Sparkles } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useSlugAvailability } from "../hooks/useSlugAvailability";
import { convexErrorMessage } from "../lib/format";
import { slugify } from "../lib/slug";

/**
 * Optional prefill, carried in the URL. Set when Kedaipal staff generate an
 * "onboard a client" link from the admin billing page (`via=admin`) — the store
 * name / slug / WhatsApp number are seeded so the client just reviews + confirms.
 * The store is still created under the **client's own** Clerk login (they sign in
 * first), so ownership is never ambiguous. See docs/manual-subscription.md.
 */
type OnboardingSearch = {
	store?: string;
	slug?: string;
	wa?: string;
	via?: string;
};

export const Route = createFileRoute("/onboarding")({
	validateSearch: (search: Record<string, unknown>): OnboardingSearch => {
		const str = (v: unknown) =>
			typeof v === "string" && v.trim().length > 0 ? v : undefined;
		return {
			store: str(search.store),
			slug: str(search.slug),
			wa: str(search.wa),
			via: str(search.via),
		};
	},
	component: OnboardingRoute,
});

function OnboardingRoute() {
	// Preserve the prefill query string across the sign-in round-trip — otherwise
	// Clerk would bounce the client back to a bare /onboarding and drop the prefill.
	const location = useLocation();
	return (
		<Show
			when="signed-in"
			fallback={<RedirectToSignIn signInForceRedirectUrl={location.href} />}
		>
			<OnboardingForm />
		</Show>
	);
}

function OnboardingForm() {
	const navigate = useNavigate();
	const search = Route.useSearch();
	const retailer = useQuery(api.retailers.getMyRetailer);
	const createRetailer = useMutation(api.retailers.createRetailer);

	// Assisted = an admin-generated prefill link. Seed the fields, surface the WA
	// number for review, and tell the client what's going on.
	const assisted = search.via === "admin";

	const [storeName, setStoreName] = useState(search.store ?? "");
	const [slug, setSlug] = useState(search.slug ?? "");
	// If a slug came in the link, treat it as hand-set so it's not re-derived.
	const [slugEdited, setSlugEdited] = useState(Boolean(search.slug));
	const [waPhone, setWaPhone] = useState(search.wa ?? "");
	const [submitting, setSubmitting] = useState(false);
	const [agreed, setAgreed] = useState(false);

	const availability = useSlugAvailability(slug);

	// Already onboarded → straight to dashboard.
	useEffect(() => {
		if (retailer) navigate({ to: "/app" });
	}, [retailer, navigate]);

	// Auto-derive slug from store name until the user hand-edits it.
	useEffect(() => {
		if (!slugEdited) setSlug(slugify(storeName));
	}, [storeName, slugEdited]);

	if (retailer === undefined) {
		return <LoadingScreen />;
	}

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		if (storeName.trim().length < 2) {
			toast.error("Store name must be at least 2 characters");
			return;
		}
		if (availability.status !== "available") return;
		if (!agreed) {
			toast.error(
				"Please accept the Terms, Privacy Policy, and Acceptable Use Policy",
			);
			return;
		}
		setSubmitting(true);
		try {
			const trimmedWa = waPhone.trim();
			await createRetailer({
				storeName: storeName.trim(),
				slug,
				...(trimmedWa.length > 0 ? { waPhone: trimmedWa } : {}),
			});
			navigate({ to: "/app" });
		} catch (err) {
			toast.error(convexErrorMessage(err));
			setSubmitting(false);
		}
	}

	const canSubmit =
		storeName.trim().length >= 2 &&
		availability.status === "available" &&
		agreed &&
		!submitting;

	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 pb-32 pt-12">
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
						Kedaipal set this up for you. Review the details below and tap{" "}
						<span className="font-medium text-foreground">Create store</span> —
						you can change anything later in Settings.
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

				{assisted ? (
					<Field label="WhatsApp number">
						<Input
							type="tel"
							inputMode="tel"
							value={waPhone}
							onChange={(e) => setWaPhone(e.target.value)}
							placeholder="e.g. 60123456789"
							variant="field"
						/>
						<span className="text-xs text-muted-foreground">
							The number buyers reach you on. Leave blank to add it later.
						</span>
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
		<main className="mx-auto flex min-h-dvh w-full max-w-md items-center justify-center px-5">
			<p className="text-sm text-muted-foreground">Loading…</p>
		</main>
	);
}
