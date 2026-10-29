import { Globe } from "lucide-react";
import { COUNTRY_LABELS, type Country } from "../../../convex/lib/country";
import { TONE_CHIP } from "../../lib/tone";
import { cn } from "../../lib/utils";

/**
 * "Overseas · Singapore" — marks an order going to the other country
 * (z8r3fdr5yy) wherever the seller reads its address, so a cross-border
 * parcel is never packed or booked as a domestic one by accident.
 */
export function OverseasChip({
	country,
	className,
}: {
	country: Country;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
				TONE_CHIP.info,
				className,
			)}
		>
			<Globe className="size-3" aria-hidden />
			Overseas · {COUNTRY_LABELS[country]}
		</span>
	);
}
