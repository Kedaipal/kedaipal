import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { PartyPopper } from "lucide-react";
import { api } from "../../../convex/_generated/api";

/**
 * One-time celebratory banner shown once the store is ACTIVATED — i.e. its first
 * order reached confirmed. The dashboard only renders this for a window after
 * `activatedAt` (see ACTIVATION_CELEBRATION_MS in app.index), so it's a transient
 * "you're live!" moment that self-clears — no stored dismissal state.
 *
 * Doubles as the testimonial ask: a seller who just landed their first order is
 * exactly who you want a quote from, so the CTA opens a WhatsApp chat to the
 * Kedaipal contact (reusing the configured checkout number, like WhiteGloveCard).
 */
export function FirstOrderCelebration({
	slug,
	storeName,
}: {
	slug: string;
	storeName: string;
}) {
	const instructions = useQuery(api.billing.paymentInstructions, {});

	const phone = instructions?.whatsappPhone;
	const testimonialUrl = phone
		? `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(
				`Hi! ${storeName} (/${slug}) just received our first order through Kedaipal 🎉 Happy to share a testimonial!`,
			)}`
		: undefined;

	return (
		<section className="relative overflow-hidden rounded-2xl border border-emerald-300 bg-emerald-50 p-5 dark:border-emerald-800 dark:bg-emerald-950/40">
			<div
				className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-emerald-400/20 blur-3xl"
				aria-hidden="true"
			/>
			<div className="relative flex items-start gap-3">
				<PartyPopper className="size-6 shrink-0 text-emerald-600" />
				<div className="flex min-w-0 flex-col gap-3">
					<div>
						<p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
							You're live — your first order is in! 🎉
						</p>
						<p className="mt-0.5 text-xs text-emerald-800/80 dark:text-emerald-300/80">
							This is the milestone that matters. Keep sharing your link and the
							orders will keep coming.
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Link
							to="/app/orders"
							className="inline-flex h-9 items-center rounded-lg bg-foreground px-3.5 text-sm font-medium text-background"
						>
							View your orders
						</Link>
						{testimonialUrl ? (
							<a
								href={testimonialUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex h-9 items-center rounded-lg border border-emerald-300 px-3.5 text-sm font-medium text-emerald-900 hover:bg-emerald-100 dark:border-emerald-700 dark:text-emerald-200 dark:hover:bg-emerald-900"
							>
								Loving it? Send a testimonial
							</a>
						) : null}
					</div>
				</div>
			</div>
		</section>
	);
}
