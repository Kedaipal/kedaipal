import { AlertTriangle, Clock } from "lucide-react";
import type {
	AutoChargeDescription,
	AutoChargeTone,
} from "../../lib/auto-charge-status";
import { CopyButton } from "../ui/copy-button";

/** Same pill families as the admin console's other rail pills (red = failing,
 * emerald = healthy), plus amber for "the system is checking". Stopped wears
 * an icon so "a human must act" never reads as ordinary dunning. */
const PILL_CLASS: Record<AutoChargeTone, string> = {
	stopped:
		"bg-red-100 text-red-700 ring-1 ring-inset ring-red-300 dark:bg-red-950 dark:text-red-300 dark:ring-red-800",
	unconfirmed:
		"bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
	failed: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
	healthy:
		"bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
};

/**
 * The auto-charge pill — one control for both admin lists (the pending bills
 * and the auto-renewal overview). `showHealthy={false}` where every row is
 * already on auto-renewal and a green "Auto-renew" would say nothing.
 */
export function AutoChargePill({
	description,
	showHealthy = true,
}: {
	description: AutoChargeDescription;
	showHealthy?: boolean;
}) {
	if (description.tone === "healthy" && !showHealthy) return null;
	return (
		<span
			className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${PILL_CLASS[description.tone]}`}
		>
			{description.tone === "stopped" ? (
				<AlertTriangle aria-hidden className="size-3" />
			) : description.tone === "unconfirmed" ? (
				<Clock aria-hidden className="size-3" />
			) : null}
			{description.pill}
		</span>
	);
}

/** What the pill means and what happens next. A stopped charge leads with the
 * fact in red, then the way out, then the HitPay reference to look it up by —
 * copyable, because it's a long id nobody should retype. */
export function AutoChargeDetail({
	description,
}: {
	description: AutoChargeDescription;
}) {
	if (!description.detail) return null;
	return (
		<div className="space-y-1">
			{description.lead ? (
				<p className="text-xs font-medium text-red-600 dark:text-red-400">
					{description.lead}
				</p>
			) : null}
			<p className="text-xs text-muted-foreground">{description.detail}</p>
			{description.reference ? (
				<div className="flex items-center gap-1">
					<span className="shrink-0 text-xs text-muted-foreground">
						HitPay ref
					</span>
					<code
						title={description.reference}
						className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground"
					>
						{description.reference}
					</code>
					<CopyButton
						value={description.reference}
						ariaLabel="Copy the HitPay reference"
						successMessage="HitPay reference copied"
						labelClassName="hidden sm:inline"
					/>
				</div>
			) : null}
		</div>
	);
}
