/**
 * Despatch-label template card — Settings → Fulfilment (86eyp63mp).
 *
 * Sits directly under the Delivery card, because that is what it configures:
 * once a seller has decided how orders travel, this is the paper that goes on
 * the parcel. (Pickup orders never get one — they have no address.)
 *
 * Presentational: config in, a patch out via `onSave`, so it unit-tests without
 * Convex (the `wa-order-alerts-card.tsx` posture). The card is the ONE place
 * that tells a seller what this label is and — just as importantly — what it
 * is not: a Kedaipal despatch label, not a courier's official consignment note.
 */

import { Printer } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	AWB_FOOTER_MAX,
	type AwbConfig,
	type AwbPaperSize,
	type StoredAwbConfig,
} from "../../../convex/lib/awbConfig";
import { convexErrorMessage } from "../../lib/format";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

const PAPER_OPTIONS: ReadonlyArray<{
	value: AwbPaperSize;
	title: string;
	detail: string;
}> = [
	{
		value: "a4-4up",
		title: "A4 sheet, 4 labels",
		detail: "Print on any office printer, then cut along the dotted lines.",
	},
	{
		value: "a6",
		title: "A6 label roll",
		detail: "One label per page, for a thermal label printer.",
	},
];

/** Each toggle names what it prints AND the reason a seller might not want it —
 * a switch with no consequence line is a switch nobody touches. */
const TOGGLES: ReadonlyArray<{
	key: keyof Pick<
		AwbConfig,
		"showLogo" | "showItems" | "showCod" | "showWeight" | "showNote"
	>;
	label: string;
	detail: string;
}> = [
	{
		key: "showLogo",
		label: "Your store logo",
		detail: "Skipped automatically if your logo isn't a PNG or JPEG.",
	},
	{
		key: "showCod",
		label: "Payment status",
		detail:
			"Prints the amount still to collect on unpaid orders, or a PAID mark once it's settled — so nobody gets asked to pay twice.",
	},
	{
		key: "showWeight",
		label: "Parcel weight",
		detail:
			"Needs a weight on the product's choices. Left off the label when any item has none.",
	},
	{
		key: "showNote",
		label: "Buyer's order note",
		detail: "Where “call before delivery” usually lives.",
	},
	{
		key: "showItems",
		label: "What's inside",
		detail:
			"Handy when you pack from the label — but it also tells anyone handling the parcel what's in it. Up to 3 lines.",
	},
];

export function DespatchLabelCard({
	config,
	onSave,
}: {
	/** The store's resolved label template. */
	config: AwbConfig;
	onSave: (patch: StoredAwbConfig | null) => Promise<unknown>;
}) {
	const [draft, setDraft] = useState<AwbConfig>(config);
	const [saving, setSaving] = useState(false);

	const footer = draft.footerText ?? "";
	const footerTooLong = footer.length > AWB_FOOTER_MAX;
	const dirty =
		draft.paperSize !== config.paperSize ||
		draft.showLogo !== config.showLogo ||
		draft.showItems !== config.showItems ||
		draft.showCod !== config.showCod ||
		draft.showWeight !== config.showWeight ||
		draft.showNote !== config.showNote ||
		(draft.footerText ?? "") !== (config.footerText ?? "");

	async function save() {
		if (!dirty || footerTooLong) return;
		setSaving(true);
		try {
			await onSave({
				paperSize: draft.paperSize,
				showLogo: draft.showLogo,
				showItems: draft.showItems,
				showCod: draft.showCod,
				showWeight: draft.showWeight,
				showNote: draft.showNote,
				footerText: footer.trim() || undefined,
			});
			toast.success("Label template updated.");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	return (
		<section className="flex flex-col gap-4 rounded-2xl border border-input bg-background p-5 lg:p-6">
			<div className="flex flex-col gap-1">
				<h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
					<Printer
						className="size-4 text-muted-foreground"
						aria-hidden="true"
					/>
					Despatch labels
				</h3>
				<p className="text-xs leading-relaxed text-muted-foreground">
					The address label you stick on a parcel. Print one from any order, or
					print every packed-and-paid order at once from your Orders page. This
					is Kedaipal&apos;s own label — not a courier&apos;s official
					consignment note — so it shows the courier and tracking number{" "}
					<em>you</em> recorded when marking the order shipped.
				</p>
			</div>

			<fieldset className="flex flex-col gap-2">
				<legend className="pb-2 text-xs font-medium text-muted-foreground">
					Label size
				</legend>
				<div className="grid gap-2 sm:grid-cols-2">
					{PAPER_OPTIONS.map((option) => {
						const active = draft.paperSize === option.value;
						return (
							<button
								key={option.value}
								type="button"
								aria-pressed={active}
								onClick={() =>
									setDraft((d) => ({ ...d, paperSize: option.value }))
								}
								className={cn(
									"flex flex-col gap-1 rounded-xl border p-3 text-left transition-colors",
									active
										? "border-accent bg-accent/5"
										: "border-input hover:bg-muted",
								)}
							>
								<span className="text-sm font-semibold text-foreground">
									{option.title}
								</span>
								<span className="text-xs leading-relaxed text-muted-foreground">
									{option.detail}
								</span>
							</button>
						);
					})}
				</div>
			</fieldset>

			<fieldset className="flex flex-col gap-3">
				<legend className="pb-1 text-xs font-medium text-muted-foreground">
					What the label shows
				</legend>
				{TOGGLES.map((toggle) => (
					<label
						key={toggle.key}
						className="flex cursor-pointer items-start gap-3"
					>
						<input
							type="checkbox"
							checked={draft[toggle.key]}
							onChange={(e) =>
								setDraft((d) => ({ ...d, [toggle.key]: e.target.checked }))
							}
							className="mt-0.5 size-5 shrink-0 accent-accent"
						/>
						<span className="flex min-w-0 flex-col gap-0.5">
							<span className="text-sm font-medium text-foreground">
								{toggle.label}
							</span>
							<span className="text-xs leading-relaxed text-muted-foreground">
								{toggle.detail}
							</span>
						</span>
					</label>
				))}
			</fieldset>

			<div className="flex flex-col gap-1.5">
				<label
					htmlFor="awb-footer"
					className="text-xs font-medium text-muted-foreground"
				>
					Footer line (optional)
				</label>
				<Input
					id="awb-footer"
					value={footer}
					variant="field"
					maxLength={AWB_FOOTER_MAX + 20}
					isError={footerTooLong}
					placeholder="Returns: 012-345 6789 · Thank you!"
					onChange={(e) =>
						setDraft((d) => ({ ...d, footerText: e.target.value }))
					}
				/>
				<p
					className={cn(
						"text-xs",
						footerTooLong ? "text-destructive" : "text-muted-foreground",
					)}
				>
					{footerTooLong
						? `Keep it to ${AWB_FOOTER_MAX} characters or fewer.`
						: "Printed small at the bottom of every label."}
				</p>
			</div>

			<div className="flex flex-wrap items-center gap-3">
				<Button
					type="button"
					onClick={save}
					disabled={!dirty || footerTooLong || saving}
					isLoading={saving}
					className="h-11"
				>
					Save
				</Button>
				{dirty ? (
					<Button
						type="button"
						variant="ghost"
						className="h-11"
						onClick={() => setDraft(config)}
						disabled={saving}
					>
						Discard changes
					</Button>
				) : null}
			</div>
		</section>
	);
}
