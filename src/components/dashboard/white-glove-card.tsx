import { useMutation, useQuery } from "convex/react";
import { Award, X } from "lucide-react";
import { api } from "../../../convex/_generated/api";

/**
 * One-time celebratory card shown to a freshly-minted Founding Member, prompting
 * them to schedule the white-glove onboarding call. Dismisses (and never returns)
 * once they tap the CTA or close it (`markWhiteGloveScheduled`). See
 * docs/manual-subscription.md.
 */
export function WhiteGloveCard({ slug }: { slug: string }) {
	const status = useQuery(api.foundingMembers.myStatus, {});
	const instructions = useQuery(
		api.billing.paymentInstructions,
		status && !status.whiteGloveScheduled ? {} : "skip",
	);
	const markScheduled = useMutation(
		api.foundingMembers.markWhiteGloveScheduled,
	);

	if (!status || status.whiteGloveScheduled) return null;

	const phone = instructions?.whatsappPhone;
	const waUrl = phone
		? `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(
				`Hi Arif! I'm Founding Member #${status.rank} (/${slug}) — I'd like to schedule my white-glove onboarding call.`,
			)}`
		: undefined;

	return (
		<section className="relative flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-950/40">
			<button
				type="button"
				onClick={() => markScheduled({})}
				aria-label="Dismiss"
				className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-full text-amber-700/70 hover:bg-amber-100 dark:hover:bg-amber-900"
			>
				<X className="size-4" />
			</button>
			<Award className="size-6 shrink-0 text-amber-600" />
			<div className="flex min-w-0 flex-col gap-2">
				<div>
					<p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
						You're Founding Member #{status.rank} of 10 🎉
					</p>
					<p className="text-xs text-amber-800/80 dark:text-amber-300/80">
						Schedule your white-glove onboarding call — we'll help you get the
						most out of Kedaipal.
					</p>
				</div>
				{waUrl ? (
					<a
						href={waUrl}
						target="_blank"
						rel="noreferrer"
						onClick={() => markScheduled({})}
						className="inline-flex h-9 w-fit items-center rounded-lg bg-foreground px-3.5 text-sm font-medium text-background"
					>
						Schedule your call
					</a>
				) : null}
			</div>
		</section>
	);
}
