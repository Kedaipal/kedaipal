import { useQuery } from "convex/react";
import { AlertOctagon, MessageCircle } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { Button } from "../ui/button";

/**
 * Dashboard banner shown when a seller's outbound WhatsApp sending is paused by
 * the WABA kill switch (retailerSendingLimits.pausedAt). Pause blocks only
 * NON-transactional sends (broadcasts/marketing) — order confirmations and status
 * updates still flow — so the copy says exactly that, to avoid the seller
 * panicking that customer messaging is down. Without this banner the pause would
 * be an invisible backend flag. Non-dismissable + red: it's an active limitation
 * that stays until ops lifts it.
 *
 * The CTA opens a WhatsApp chat to Kedaipal support (same number as the billing
 * "message us" flow) with a prefilled, store-aware message — so the seller can
 * reach us in one tap instead of hunting for a contact. See docs/waba-protection.md.
 */
export function SendingPausedBanner({
	paused,
	reason,
	slug,
}: {
	paused?: boolean;
	reason?: string;
	slug: string;
}) {
	// Only fetch the support number when actually paused (skip the query on every
	// dashboard load for the common, un-paused case).
	const instructions = useQuery(
		api.billing.paymentInstructions,
		paused ? {} : "skip",
	);

	if (!paused) return null;

	const phone = instructions?.whatsappPhone?.replace(/\D/g, "");
	const waUrl = phone
		? `https://wa.me/${phone}?text=${encodeURIComponent(
				`Hi Kedaipal! My store (/${slug}) WhatsApp sending is paused${
					reason ? ` — reason given: "${reason}"` : ""
				}. Could you help me get it sorted?`,
			)}`
		: undefined;

	return (
		<div className="flex flex-col gap-3 border-b border-red-200 bg-red-50 px-5 py-3 dark:border-red-900 dark:bg-red-950/40 sm:flex-row sm:items-start sm:justify-between lg:px-8">
			<div className="flex items-start gap-3">
				<AlertOctagon className="mt-0.5 size-5 shrink-0 text-red-600 dark:text-red-400" />
				<div className="flex flex-col gap-0.5">
					<p className="text-sm text-foreground/90">
						<span className="font-medium">
							Marketing/broadcast WhatsApp sends are paused for your store.
						</span>{" "}
						Your storefront, orders, and customers' order confirmations &amp;
						status updates are <span className="font-medium">not affected</span>{" "}
						and continue as normal.
					</p>
					<p className="text-sm text-foreground/70">
						{reason ? `Reason: ${reason}. ` : ""}
						This usually protects our shared WhatsApp number's quality — reach
						out and we'll help you resolve it.
					</p>
				</div>
			</div>
			{waUrl ? (
				<Button asChild size="sm" className="w-full shrink-0 sm:w-auto">
					<a href={waUrl} target="_blank" rel="noopener noreferrer">
						<MessageCircle className="size-4" />
						Contact support
					</a>
				</Button>
			) : null}
		</div>
	);
}
