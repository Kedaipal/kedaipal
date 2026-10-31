// Tag the channel that won a store (86eye3eyp, docs/acquisition-attribution.md).
// Mounted only while open, so the choice initialises from the row every time
// (the referral-dialog / comp-dialog shape).

import { useMutation } from "convex/react";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { AdminSellerRow } from "../../../convex/admin";
import {
	ACQUISITION_CHANNELS,
	ACQUISITION_NOTE_MAX,
	type AcquisitionChannel,
	CHANNEL_COPY,
	isAcquisitionChannel,
} from "../../../convex/lib/metrics";
import { convexErrorMessage } from "../../lib/format";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";

/** What the captured signals point at, said in the dialog so a suggestion
 * is never a mystery pre-selection. */
function suggestionReason(seller: AdminSellerRow): string {
	if (seller.referral) return "this store has a referral row";
	if (seller.signupSource)
		return `it signed up through the ${seller.signupSource} link`;
	return "";
}

/** The channel to pre-select: what's on the row, else the suggestion. */
function initialChannel(seller: AdminSellerRow): AcquisitionChannel | null {
	const current = seller.acquisition.channel;
	if (isAcquisitionChannel(current)) return current;
	return seller.acquisition.suggested;
}

export function AcquisitionDialog({
	seller,
	onClose,
}: {
	seller: AdminSellerRow;
	onClose: () => void;
}) {
	const setSource = useMutation(api.metrics.setAcquisitionSource);
	const [channel, setChannel] = useState<AcquisitionChannel | null>(() =>
		initialChannel(seller),
	);
	const [note, setNote] = useState(seller.acquisition.note ?? "");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const { suggested, setBy } = seller.acquisition;
	const reason = suggestionReason(seller);
	const confirming = setBy === "seller";
	const unchanged =
		setBy === "admin" &&
		channel === seller.acquisition.channel &&
		note.trim() === (seller.acquisition.note ?? "");

	async function save() {
		if (!channel) return;
		setSaving(true);
		setError(null);
		try {
			await setSource({
				retailerId: seller._id,
				source: channel,
				...(note.trim() ? { note } : {}),
			});
			toast.success(
				`${seller.storeName} tagged as ${CHANNEL_COPY[channel].label}`,
				{ description: "It now counts towards that channel's CAC." },
			);
			onClose();
		} catch (err) {
			setError(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	return (
		<Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
			<DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>How did {seller.storeName} arrive?</DialogTitle>
					<DialogDescription>
						This decides which channel the store counts towards in CAC. Sellers
						never see it.
					</DialogDescription>
				</DialogHeader>

				{confirming && isAcquisitionChannel(seller.acquisition.channel) ? (
					<p className="rounded-xl border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
						The seller answered{" "}
						<span className="font-medium text-foreground">
							{CHANNEL_COPY[seller.acquisition.channel].label}
						</span>{" "}
						at signup. Saving confirms it, or pick the one that's true.
					</p>
				) : suggested && reason ? (
					<p className="flex items-start gap-2 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-muted-foreground">
						<Sparkles
							className="mt-0.5 size-3.5 shrink-0 text-accent-emphasis"
							aria-hidden
						/>
						<span>
							Suggested{" "}
							<span className="font-medium text-foreground">
								{CHANNEL_COPY[suggested].label}
							</span>
							: {reason}.
						</span>
					</p>
				) : null}

				<fieldset className="flex flex-col gap-1.5">
					<legend className="pb-1.5 text-xs font-semibold">Channel</legend>
					{ACQUISITION_CHANNELS.map((id) => {
						const checked = channel === id;
						return (
							<label
								key={id}
								className={cn(
									"flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 transition-colors",
									checked
										? "border-accent bg-accent/5"
										: "border-border hover:bg-muted/50",
								)}
							>
								<input
									type="radio"
									name="acquisition-channel"
									value={id}
									checked={checked}
									onChange={() => {
										setChannel(id);
										setError(null);
									}}
									className="mt-0.5 size-4 accent-accent"
								/>
								<span className="flex min-w-0 flex-col">
									<span className="text-sm font-medium">
										{CHANNEL_COPY[id].label}
										{id === suggested && !confirming ? (
											<span className="ml-2 text-[11px] font-semibold text-accent-emphasis">
												Suggested
											</span>
										) : null}
									</span>
									<span className="text-xs text-muted-foreground">
										{CHANNEL_COPY[id].hint}
									</span>
								</span>
							</label>
						);
					})}
				</fieldset>

				<div className="flex flex-col gap-1.5">
					<label htmlFor="acquisition-note" className="text-xs font-semibold">
						Note{" "}
						<span className="font-normal text-muted-foreground">
							(optional)
						</span>
					</label>
					<Input
						id="acquisition-note"
						variant="field"
						value={note}
						maxLength={ACQUISITION_NOTE_MAX}
						onChange={(e) => {
							setNote(e.target.value);
							setError(null);
						}}
						placeholder="Who, where, when"
						aria-invalid={error !== null}
					/>
					{error ? (
						<p className="text-sm text-destructive">{error}</p>
					) : (
						<p className="text-xs text-muted-foreground">
							e.g. "Intro from Khalil at the Great Day Club talk". Up to{" "}
							{ACQUISITION_NOTE_MAX} characters.
						</p>
					)}
				</div>

				<DialogFooter>
					<Button
						type="button"
						variant="ghost"
						onClick={onClose}
						disabled={saving}
					>
						Cancel
					</Button>
					<Button
						type="button"
						onClick={save}
						disabled={!channel || unchanged || saving}
						isLoading={saving}
					>
						{channel
							? `${confirming && channel === seller.acquisition.channel ? "Confirm" : "Tag as"} ${CHANNEL_COPY[channel].label}`
							: "Pick a channel"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
