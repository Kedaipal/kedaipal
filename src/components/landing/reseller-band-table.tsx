import {
	RESELLER_BANDS,
	type ResellerBandLabel,
} from "../../lib/resellerBands";
import { cn } from "../../lib/utils";
import { m } from "../../paraglide/messages";

// Active-reseller count label per band. Kept beside RESELLER_BANDS so the pure
// data module stays i18n-free (testable) while the copy resolves per-render.
const BAND_LABEL: Record<ResellerBandLabel, () => string> = {
	upTo10: m.pricingpage_band_upTo10,
	"11to30": m.pricingpage_band_11to30,
	"31to75": m.pricingpage_band_31to75,
	"75plus": m.pricingpage_band_75plus,
};

/**
 * Scale tier's active-reseller pricing bands, rendered as a compact 2-column
 * table. Shared by /pricing and the landing teaser so the numbers never drift.
 * Two columns only → no horizontal scroll on mobile.
 */
export function ResellerBandTable({ className }: { className?: string }) {
	return (
		<div
			className={cn(
				"rounded-xl border border-border bg-muted/30 p-3",
				className,
			)}
		>
			<p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
				{m.pricingpage_band_heading()}
			</p>
			<table className="mt-2 w-full text-sm">
				<thead>
					<tr className="text-[11px] uppercase tracking-wide text-muted-foreground/70">
						<th className="pb-1 text-left font-medium">
							{m.pricingpage_band_col_resellers()}
						</th>
						<th className="pb-1 text-right font-medium">
							{m.pricingpage_band_col_price()}
						</th>
					</tr>
				</thead>
				<tbody>
					{RESELLER_BANDS.map((band) => (
						<tr key={band.labelKey} className="border-t border-border/50">
							<td className="py-1.5 text-left text-muted-foreground">
								{BAND_LABEL[band.labelKey]()}
							</td>
							<td className="py-1.5 text-right font-semibold text-foreground">
								{band.price ?? m.pricingpage_band_custom()}
							</td>
						</tr>
					))}
				</tbody>
			</table>
			<p className="mt-2 text-[11px] leading-snug text-muted-foreground/70">
				{m.pricingpage_band_note()}
			</p>
		</div>
	);
}
