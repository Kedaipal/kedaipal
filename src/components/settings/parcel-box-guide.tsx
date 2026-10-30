/**
 * The three parcel boxes, as a seller needs to know them before EasyParcel
 * prices their checkout (z8r3fdr5yy, Zaki 30 Oct): what each box measures,
 * what it's charged as, and that checkout picks one from the parcel's weight.
 * A quick look in the app instead of a link to a long courier page.
 *
 * Every number comes from `PARCEL_BOXES` / `boxSizeWeightKg` — the same
 * constants the checkout quote and the dispatch card use — so the guide can't
 * drift from what is actually declared to EasyParcel.
 */

import { Package } from "lucide-react";
import {
	boxSizeWeightKg,
	PARCEL_BOXES,
	type ParcelBox,
} from "../../../convex/lib/easyparcel";
import { cn } from "../../lib/utils";

const BOX_LABEL: Record<ParcelBox, string> = {
	small: "Small",
	medium: "Medium",
	large: "Large",
};

/** What typically fits — a picture, not a promise. */
const BOX_FITS: Record<ParcelBox, string> = {
	small: "A tin of kuih, a pouch, a phone case",
	medium: "A shoebox, a few jars, folded clothes",
	large: "A boxed set, a small appliance",
};

const ORDER: ParcelBox[] = ["small", "medium", "large"];

function kg(value: number): string {
	return `${Number(value.toFixed(2))} kg`;
}

export function ParcelBoxGuide({ className }: { className?: string }) {
	return (
		<div className={cn("flex flex-col gap-2.5", className)}>
			<ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
				{ORDER.map((box, i) => {
					const d = PARCEL_BOXES[box];
					const from = i === 0 ? 0 : boxSizeWeightKg(ORDER[i - 1]);
					return (
						<li
							key={box}
							className="flex items-start gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5"
						>
							<Package
								aria-hidden
								className={cn(
									"mt-0.5 shrink-0 text-muted-foreground",
									box === "small"
										? "size-4"
										: box === "medium"
											? "size-5"
											: "size-6",
								)}
							/>
							<span className="flex min-w-0 flex-col gap-0.5">
								<span className="text-sm font-semibold">{BOX_LABEL[box]}</span>
								<span className="text-xs tabular-nums text-muted-foreground">
									{d.lengthCm} × {d.widthCm} × {d.heightCm} cm
								</span>
								<span className="text-xs text-muted-foreground">
									{i === ORDER.length - 1
										? `Parcels over ${kg(from)}`
										: `Parcels ${i === 0 ? "up to" : `${kg(from)} –`} ${kg(boxSizeWeightKg(box))}`}
								</span>
								<span className="text-xs text-muted-foreground">
									{BOX_FITS[box]}
								</span>
							</span>
						</li>
					);
				})}
			</ul>
			<p className="text-xs text-muted-foreground">
				Checkout picks the box from the parcel&apos;s weight. Couriers charge
				whichever is more: the real weight, or the box&apos;s size weight
				(length × width × height ÷ 5,000). When you book, you choose the box you
				actually pack in.
			</p>
		</div>
	);
}
