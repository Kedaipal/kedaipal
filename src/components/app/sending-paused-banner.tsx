import { AlertOctagon } from "lucide-react";

/**
 * Dashboard banner shown when a seller's outbound WhatsApp sending is paused by
 * the WABA kill switch (retailerSendingLimits.pausedAt). Pause blocks only
 * NON-transactional sends (broadcasts/marketing) — order confirmations and status
 * updates still flow — so the copy says exactly that, to avoid the seller
 * panicking that customer messaging is down. Without this banner the pause would
 * be an invisible backend flag. Non-dismissable + red: it's an active limitation
 * that stays until ops lifts it. See docs/waba-protection.md.
 */
export function SendingPausedBanner({
	paused,
	reason,
}: {
	paused?: boolean;
	reason?: string;
}) {
	if (!paused) return null;
	return (
		<div className="flex items-start gap-3 border-b border-red-200 bg-red-50 px-5 py-3 dark:border-red-900 dark:bg-red-950/40 lg:px-8">
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
					This usually protects our shared WhatsApp number's quality. Please
					contact Kedaipal support to resolve it.
				</p>
			</div>
		</div>
	);
}
