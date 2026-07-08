import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { ExternalLink, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { api } from "../../../convex/_generated/api";

/**
 * Upgrade surfaces for plan-gated (Pro-and-above) features. Two shapes:
 *  - `ProFeatureWall` — full-page stand-in for a wholly gated screen
 *    (/app/customers). The feature stays DISCOVERABLE in nav; the wall says
 *    what it does and how to unlock it — never a dead end.
 *  - `ProFeatureTease` — compact inline strip where only part of a screen is
 *    gated (the orders inbox controls) so the rest keeps working.
 * The server (`assertPlanFeature`) is the real lock; these only render the
 * locked state. Upgrade = message us on WhatsApp (manual billing — Arif issues
 * the invoice), with Settings → Billing as the fallback path.
 */
export function ProFeatureWall({
	slug,
	icon,
	title,
	blurb,
	bullets,
}: {
	slug: string;
	icon: ReactNode;
	title: string;
	blurb: string;
	bullets?: string[];
}) {
	const instructions = useQuery(api.billing.paymentInstructions, {});
	const waUrl = instructions?.whatsappPhone
		? `https://wa.me/${instructions.whatsappPhone.replace(/\D/g, "")}?text=${encodeURIComponent(
				`Hi, I'd like to upgrade to Pro for my Kedaipal store (/${slug}).`,
			)}`
		: undefined;
	return (
		<div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border px-6 py-12 text-center">
			<div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
				{icon}
			</div>
			<div className="max-w-md">
				<div className="flex items-center justify-center gap-2">
					<p className="font-semibold">{title}</p>
					<ProBadge />
				</div>
				<p className="mt-1.5 text-sm text-muted-foreground">{blurb}</p>
			</div>
			{bullets && bullets.length > 0 ? (
				<ul className="flex max-w-md flex-col gap-1.5 text-left text-sm text-muted-foreground">
					{bullets.map((b) => (
						<li key={b} className="flex items-start gap-2">
							<Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent" />
							{b}
						</li>
					))}
				</ul>
			) : null}
			<div className="mt-1 flex flex-col gap-2 sm:flex-row">
				{waUrl ? (
					<a
						href={waUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-foreground px-4 text-sm font-medium text-background"
					>
						<ExternalLink className="size-4" />
						Upgrade to Pro
					</a>
				) : null}
				<Link
					to="/app/settings"
					search={{ tab: "billing" }}
					className="inline-flex h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
				>
					View plans & billing
				</Link>
			</div>
		</div>
	);
}

export function ProFeatureTease({ message }: { message: string }) {
	return (
		<div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-sm lg:p-4">
			<Sparkles className="size-4 shrink-0 text-accent" aria-hidden="true" />
			<p className="flex-1 text-sm text-muted-foreground">{message}</p>
			<Link
				to="/app/settings"
				search={{ tab: "billing" }}
				className="inline-flex h-9 shrink-0 items-center rounded-lg bg-foreground px-3.5 text-sm font-medium text-background"
			>
				Upgrade
			</Link>
		</div>
	);
}

/** Tiny "Pro" chip — marks gated features in nav + walls so the tier boundary
 * is visible, not a surprise. */
export function ProBadge({ className }: { className?: string }) {
	return (
		<span
			className={`inline-flex items-center rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent ${className ?? ""}`}
		>
			Pro
		</span>
	);
}
