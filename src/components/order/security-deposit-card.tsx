// Security-deposit settlement (booking bundle S5, `86eyn4kee`). The deposit is
// held money collected with the one payment; after check-out the seller
// returns it and records the outcome here — "Mark returned", or keep part of
// it with a required reason the guest sees verbatim. The card is the reminder
// (no nudge cron in v1); the actual transfer stays off-platform, Kedaipal
// never moves order money.

import { useMutation } from "convex/react";
import { CheckCircle2, HandCoins } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { convexErrorMessage, formatPrice, parsePriceInput } from "../../lib/format";
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
import { Textarea } from "../ui/textarea";

type DepositOrder = {
	_id: Id<"orders">;
	deliveryMethod?: string;
	status: string;
	paymentStatus?: string;
	currency: string;
	securityDeposit?: number;
	securityDepositReturnedAt?: number;
	securityDepositKeptAmount?: number;
	securityDepositKeptReason?: string;
};

export function SecurityDepositCard({ order }: { order: DepositOrder }) {
	const settle = useMutation(api.bookings.settleSecurityDeposit);
	const [keepOpen, setKeepOpen] = useState(false);
	const [keptAmount, setKeptAmount] = useState("");
	const [reason, setReason] = useState("");
	const [saving, setSaving] = useState(false);

	const deposit = order.securityDeposit ?? 0;
	if (order.deliveryMethod !== "booking" || deposit <= 0) return null;

	const paid = order.paymentStatus === "received";
	const settled = order.securityDepositReturnedAt !== undefined;
	const kept = order.securityDepositKeptAmount ?? 0;

	// Settled — the outcome note both sides now share.
	if (settled) {
		return kept > 0 ? (
			<section className="flex flex-col gap-1.5 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/30">
				<p className="text-sm font-bold text-amber-900 dark:text-amber-200">
					Deposit settled — {formatPrice(kept, order.currency)} kept
				</p>
				{order.securityDepositKeptReason ? (
					<blockquote className="border-l-2 border-amber-300 pl-3 text-sm text-amber-900/90 dark:border-amber-700 dark:text-amber-200/90">
						{order.securityDepositKeptReason}
					</blockquote>
				) : null}
				<p className="text-xs text-amber-900/80 dark:text-amber-200/80">
					{formatPrice(deposit - kept, order.currency)} of the{" "}
					{formatPrice(deposit, order.currency)} deposit returned to the guest.
					They see this outcome and your reason on their order page.
				</p>
			</section>
		) : (
			<section className="flex items-start gap-2.5 rounded-2xl border border-accent/40 bg-accent/5 p-4">
				<CheckCircle2
					className="mt-0.5 size-4 shrink-0 text-accent-emphasis"
					aria-hidden
				/>
				<p className="text-sm">
					<span className="font-bold">Deposit returned in full</span>
					<span className="text-muted-foreground">
						{" "}
						— {formatPrice(deposit, order.currency)} back to the guest. They
						see this on their order page.
					</span>
				</p>
			</section>
		);
	}

	// Cancelled after payment: the deposit rides the one refund conversation —
	// no deposit-only settle here, just the money context stated plainly.
	if (order.status === "cancelled") {
		if (!paid) return null;
		return (
			<section className="rounded-2xl border border-border bg-card p-4">
				<p className="text-sm leading-relaxed text-muted-foreground">
					The guest&apos;s payment included the{" "}
					<span className="font-semibold text-foreground">
						{formatPrice(deposit, order.currency)} refundable security deposit
					</span>
					 — settle the refund with them directly (their order page says the
					same).
				</p>
			</section>
		);
	}

	// The action card appears at check-out (delivered) once the money was
	// actually collected — before that the totals row + receipt state the hold.
	if (order.status !== "delivered" || !paid) return null;

	const parsedKeep = parsePriceInput(keptAmount.trim());
	const keepSen = parsedKeep !== null ? Math.round(parsedKeep * 100) : null;
	const keepValid =
		keepSen !== null && keepSen > 0 && keepSen <= deposit;
	const reasonValid = reason.trim().length > 0;

	async function submit(keptSen: number, keptReason?: string) {
		setSaving(true);
		try {
			await settle({
				orderId: order._id,
				keptAmount: keptSen,
				reason: keptReason,
			});
			toast.success(
				keptSen > 0
					? "Deposit settled — the guest sees the split and your reason"
					: "Deposit marked returned — the guest sees it on their order page",
			);
			setKeepOpen(false);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	return (
		<section className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/30">
			<div className="flex items-start gap-2.5">
				<HandCoins
					className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400"
					aria-hidden
				/>
				<div className="flex flex-col gap-0.5">
					<p className="text-sm font-bold text-amber-900 dark:text-amber-200">
						Security deposit — {formatPrice(deposit, order.currency)} to return
					</p>
					<p className="text-xs leading-relaxed text-amber-900/80 dark:text-amber-200/80">
						The stay is checked out. Return the deposit to the guest, then
						record it here — the outcome (and any reason) shows on their order
						page.
					</p>
				</div>
			</div>
			<div className="flex flex-wrap gap-2">
				<Button
					className="tap-target flex-1"
					variant="secondary"
					isLoading={saving && !keepOpen}
					onClick={() => submit(0)}
				>
					Mark returned in full
				</Button>
				<Button
					className="tap-target flex-1"
					variant="outline"
					onClick={() => {
						setKeptAmount("");
						setReason("");
						setKeepOpen(true);
					}}
				>
					Keep part of it…
				</Button>
			</div>

			<Dialog open={keepOpen} onOpenChange={setKeepOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Keep part of the deposit</DialogTitle>
						<DialogDescription>
							For damage or losses from the stay. The guest sees the amount
							and your reason word-for-word on their order page — the rest of
							the {formatPrice(deposit, order.currency)} deposit is recorded
							as returned.
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-3">
						<label
							className="flex flex-col gap-1.5 text-sm font-medium"
							htmlFor="deposit-keep-amount"
						>
							Amount to keep ({order.currency})
							<Input
								id="deposit-keep-amount"
								inputMode="decimal"
								placeholder="0.00"
								value={keptAmount}
								onChange={(e) => setKeptAmount(e.target.value)}
								variant="field"
								isError={keptAmount.trim().length > 0 && !keepValid}
								className="w-40"
							/>
							{keptAmount.trim().length > 0 && !keepValid ? (
								<span className="text-xs font-normal text-destructive">
									Enter an amount up to{" "}
									{formatPrice(deposit, order.currency)}. To return
									everything, use &ldquo;Mark returned in full&rdquo;.
								</span>
							) : null}
						</label>
						<label
							className="flex flex-col gap-1.5 text-sm font-medium"
							htmlFor="deposit-keep-reason"
						>
							Reason (the guest sees this)
							<Textarea
								id="deposit-keep-reason"
								value={reason}
								onChange={(e) => setReason(e.target.value)}
								placeholder="e.g. Broken camp chair — replacement cost"
								maxLength={200}
								rows={3}
							/>
						</label>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setKeepOpen(false)}
							disabled={saving}
						>
							Cancel
						</Button>
						<Button
							variant="destructive"
							isLoading={saving}
							disabled={!keepValid || !reasonValid}
							onClick={() => {
								if (keepSen === null) return;
								void submit(keepSen, reason.trim());
							}}
						>
							Keep {keepValid ? formatPrice(keepSen, order.currency) : "…"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}
