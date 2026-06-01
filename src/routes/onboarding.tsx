import { RedirectToSignIn, Show } from "@clerk/tanstack-react-start";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useSlugAvailability } from "../hooks/useSlugAvailability";
import { convexErrorMessage } from "../lib/format";
import { slugify } from "../lib/slug";

export const Route = createFileRoute("/onboarding")({
	component: OnboardingRoute,
});

function OnboardingRoute() {
	return (
		<Show
			when="signed-in"
			fallback={<RedirectToSignIn signInForceRedirectUrl="/onboarding" />}
		>
			<OnboardingForm />
		</Show>
	);
}

function OnboardingForm() {
	const navigate = useNavigate();
	const retailer = useQuery(api.retailers.getMyRetailer);
	const createRetailer = useMutation(api.retailers.createRetailer);

	const [storeName, setStoreName] = useState("");
	const [slug, setSlug] = useState("");
	const [slugEdited, setSlugEdited] = useState(false);
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
			await createRetailer({ storeName: storeName.trim(), slug });
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
				<h1 className="text-3xl font-bold leading-tight">Name your store</h1>
				<p className="text-sm text-muted-foreground">
					This becomes your public link:{" "}
					<span className="font-mono text-foreground">
						kedaipal.com/{slug || "your-slug"}
					</span>
				</p>
			</header>

			<form onSubmit={handleSubmit} className="flex flex-col gap-5">
				<Field label="Store name">
					<Input
						type="text"
						value={storeName}
						onChange={(e) => setStoreName(e.target.value)}
						placeholder=""
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
