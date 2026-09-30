import { ArrowUpRight, Building2 } from "lucide-react";
import { useSupportWaNumber } from "../../hooks/useSupportWaNumber";
import {
	enterpriseFromOrdersLabel,
	enterpriseTalkUrl,
} from "../../lib/enterprise-contact";
import { trackEvent } from "../../lib/ga-events";

/**
 * Enterprise, where a seller picks or changes a plan (Credits T6): no price
 * and no Subscribe — a row that says who it's for and opens a chat with Arif,
 * the store named in the message so he knows who's writing. The same door
 * /pricing and the landing teaser open (`enterpriseTalkUrl`).
 *
 * A viewer who can't change billing (an admin acting as the store, a teammate
 * with billing READ) sees the button disabled — the annual card's treatment of
 * its WhatsApp CTA, and never a chat opened in the store's name. The REASON is
 * the host card's `OwnerOnlyNote`, placed beside this row: one per card, so
 * the plan-change card's single note serves its options and this row alike.
 */
export function EnterpriseOffer({
	slug,
	ownerOnly = false,
}: {
	slug: string;
	ownerOnly?: boolean;
}) {
	const supportWa = useSupportWaNumber();
	const cta = ownerOnly ? (
		<button
			type="button"
			disabled
			className="tap-target inline-flex h-11 w-fit shrink-0 cursor-not-allowed items-center gap-1.5 rounded-lg border border-border px-4 text-sm font-medium text-foreground opacity-50 sm:h-10"
		>
			Talk to Arif
			<ArrowUpRight className="size-4" aria-hidden />
		</button>
	) : (
		<a
			href={enterpriseTalkUrl(supportWa, { slug })}
			target="_blank"
			rel="noopener noreferrer"
			onClick={() =>
				trackEvent("enterprise_talk_clicked", { surface: "billing" })
			}
			className="tap-target inline-flex h-11 w-fit shrink-0 items-center gap-1.5 rounded-lg border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted sm:h-10"
		>
			Talk to Arif
			<ArrowUpRight className="size-4" aria-hidden />
		</a>
	);
	return (
		<div className="flex flex-col gap-3 rounded-xl border border-dashed border-border p-4 sm:flex-row sm:items-center sm:justify-between">
			<div className="flex items-start gap-3">
				<Building2
					className="mt-0.5 size-5 shrink-0 text-muted-foreground"
					aria-hidden
				/>
				<div>
					<p className="flex items-center gap-2 text-sm font-semibold">
						Enterprise
						<span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
							Custom
						</span>
					</p>
					<p className="mt-0.5 text-xs text-muted-foreground">
						Built for {enterpriseFromOrdersLabel()}+ orders a month — credits
						sized to your volume and unlimited teammates, priced per deal.
					</p>
				</div>
			</div>
			{cta}
		</div>
	);
}
