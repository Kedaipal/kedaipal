/**
 * Add a tip to a Lalamove booking that's still finding a rider (86eye9xd4).
 *
 * A booking nobody accepts EXPIRES — on the store this was built against, 15
 * of 18 failed bookings had. Lalamove's priority fee is the lever that makes a
 * nearby rider take it. Because it spends the seller's money and can't be
 * undone, the dialog carries everything a cautious seller needs before the
 * tap: fixed amounts (never a free field a thumb can fat-finger), what the
 * trip will cost in total, that it comes out of their own Lalamove wallet,
 * and the per-booking limit (`TIP_OPTIONS`, enforced again by the server).
 *
 * One component, opened from both places a stuck booking is seen: the order
 * page's rider card and its row on Deliveries.
 */

import { useAction } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { COUNTRY_CURRENCY } from "../../../convex/lib/country";
import { TIP_OPTIONS } from "../../../convex/lib/lalamoveTip";
import { formatPrice } from "../../lib/format";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";
import { ModeButton } from "../ui/mode-button";

/** Lalamove's market follows the store's currency — RM stores book in MY,
 * S$ stores in SG. */
export function tipRule(currency: string) {
	return TIP_OPTIONS[currency === COUNTRY_CURRENCY.SG ? "SG" : "MY"];
}

/** Can another step still be added under the cap? */
export function canTipMore(currency: string, tipped: number): boolean {
	const rule = tipRule(currency);
	return rule.amounts.some((a) => tipped + a <= rule.cap);
}

export function AddTipDialog({
	open,
	onOpenChange,
	shortId,
	currency,
	fare,
	tipped,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	shortId: string;
	currency: string;
	/** What the booking costs now — tips already added included. */
	fare: number;
	/** Tips already on this booking (minor units). */
	tipped: number;
}) {
	const addPriorityFee = useAction(api.lalamove.addPriorityFee);
	const rule = tipRule(currency);
	const room = rule.cap - tipped;
	const allowed = rule.amounts.filter((a) => a <= room);
	const [amount, setAmount] = useState<number | null>(null);
	const [busy, setBusy] = useState(false);
	const picked = amount !== null && allowed.includes(amount) ? amount : null;

	async function confirm() {
		if (picked === null) return;
		setBusy(true);
		try {
			const result = await addPriorityFee({ shortId, amount: picked });
			if (result.ok) {
				toast.success(
					`Tip of ${formatPrice(picked, currency)} added — riders nearby see a better fare.`,
				);
				setAmount(null);
				onOpenChange(false);
			} else {
				toast.error(result.message);
			}
		} finally {
			setBusy(false);
		}
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) setAmount(null);
				onOpenChange(next);
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Add a tip for the rider</DialogTitle>
					<DialogDescription>
						Still no rider on {shortId}. A tip (Lalamove&apos;s priority fee)
						makes the trip worth more to riders nearby, so one takes it sooner.
					</DialogDescription>
				</DialogHeader>
				<fieldset className="flex flex-col gap-2">
					<legend className="mb-2 text-xs font-medium text-muted-foreground">
						Tip amount
					</legend>
					<div className="grid grid-cols-3 gap-2">
						{rule.amounts.map((a) => (
							<ModeButton
								key={a}
								active={picked === a}
								disabled={!allowed.includes(a) || busy}
								onClick={() => setAmount(a)}
								title={formatPrice(a, currency)}
								subtitle={`Trip ${formatPrice(fare + a, currency)}`}
							/>
						))}
					</div>
				</fieldset>
				<ul className="flex flex-col gap-1 text-xs text-muted-foreground">
					<li>• Charged to your own Lalamove wallet, on top of the fare.</li>
					<li>• Can&apos;t be taken back once added.</li>
					<li>
						• Up to {formatPrice(rule.cap, currency)} per booking
						{tipped > 0
							? ` — ${formatPrice(tipped, currency)} added so far.`
							: "."}
					</li>
				</ul>
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						className="h-11"
						onClick={() => onOpenChange(false)}
					>
						Not now
					</Button>
					<Button
						type="button"
						className="h-11"
						isLoading={busy}
						disabled={picked === null || busy}
						onClick={() => void confirm()}
					>
						{picked === null
							? "Pick an amount"
							: `Add ${formatPrice(picked, currency)} tip`}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
