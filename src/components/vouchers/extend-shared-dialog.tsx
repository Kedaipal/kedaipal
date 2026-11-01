import { useMutation } from "convex/react";
import { Loader2, Lock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	composeFulfilmentMoment,
	hhmmFromMinutes,
	mytMidnightFromYmd,
	mytMinutesOfDay,
	timeMinutesFromHhmm,
	todayMytMidnight,
	ymdFromEpoch,
} from "../../../convex/lib/fulfilmentDate";
import {
	formatSharedUses,
	formatVoucherMoment,
	SHARED_USES_MAX,
	sharedExtendError,
	type VoucherStatus,
	whatStoppedShared,
} from "../../../convex/lib/vouchers";
import { Button } from "../ui/button";
import { DatePicker } from "../ui/date-picker";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";
import { Field, FieldDescription, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { TimePicker } from "../ui/time-picker";
import { LimitRow } from "./limit-row";

/** The shared code being extended — the fields the dialog reads off a row. */
export interface ExtendableVoucher {
	id: Id<"vouchers">;
	code: string;
	status: VoucherStatus;
	maxRedemptions?: number;
	redeemedCount?: number;
	endsAt?: number;
}

/**
 * Give a live shared code more room (`z8r3fdz0pw`) — a higher cap, a later
 * end, or one of the two bounds dropped while the other stays.
 *
 * Deliberately NOT an edit form. The value, the per-buyer limit, the minimum
 * spend and the start are not on this screen at all, because a code already
 * on a poster has told its buyers what it is worth; the dialog says so in its
 * description rather than showing greyed-out fields to wonder about. Every
 * check is `sharedExtendError`, the helper the mutation runs, so the disabled
 * button and the server can't disagree.
 *
 * On a code that has run out or ended, the same dialog brings it back — the
 * title and the button say so, because that is a bigger act than "a few
 * more".
 */
export function ExtendSharedDialog({
	voucher,
	onClose,
}: {
	voucher: ExtendableVoucher | null;
	onClose: () => void;
}) {
	return (
		<Dialog
			open={voucher !== null}
			onOpenChange={(o) => {
				if (!o) onClose();
			}}
		>
			{/* Keyed so each code opens on its OWN bounds, never the last one's. */}
			{voucher ? (
				<ExtendForm key={voucher.id} voucher={voucher} onClose={onClose} />
			) : null}
		</Dialog>
	);
}

function ExtendForm({
	voucher,
	onClose,
}: {
	voucher: ExtendableVoucher;
	onClose: () => void;
}) {
	const extend = useMutation(api.vouchers.extendShared);
	const [capOn, setCapOn] = useState(voucher.maxRedemptions !== undefined);
	const [cap, setCap] = useState(String(voucher.maxRedemptions ?? ""));
	const initialYmd =
		voucher.endsAt !== undefined
			? ymdFromEpoch(todayMytMidnight(voucher.endsAt))
			: "";
	const initialHhmm =
		voucher.endsAt !== undefined
			? hhmmFromMinutes(mytMinutesOfDay(voucher.endsAt))
			: "23:59";
	const [endOn, setEndOn] = useState(voucher.endsAt !== undefined);
	const [endYmd, setEndYmd] = useState(initialYmd);
	const [endHhmm, setEndHhmm] = useState(initialHhmm);
	const [saving, setSaving] = useState(false);

	const capNumber = Number.parseInt(cap, 10);
	// The pickers speak whole minutes; the stored end may carry seconds. An
	// end the seller hasn't touched is the stored INSTANT, or rebuilding it
	// would read as "moved earlier" and refuse a cap-only raise.
	const endUntouched =
		voucher.endsAt !== undefined &&
		endYmd === initialYmd &&
		endHhmm === initialHhmm;
	const endsAt = !(endOn && endYmd !== "")
		? undefined
		: endUntouched
			? voucher.endsAt
			: composeFulfilmentMoment(
					mytMidnightFromYmd(endYmd),
					timeMinutesFromHhmm(endHhmm),
				);
	const next = {
		maxRedemptions: capOn ? capNumber : undefined,
		endsAt: endOn ? (endsAt ?? Number.NaN) : undefined,
	};
	const blocked = sharedExtendError(voucher, next, Date.now());
	// Bringing a dead code back is a bigger act than "a few more" — the
	// title, the description and the button all say which one this is.
	const reviving =
		voucher.status === "redeemed" || voucher.status === "expired";

	async function submit() {
		if (blocked !== null) return;
		setSaving(true);
		try {
			const row = await extend({
				voucherId: voucher.id,
				maxRedemptions: next.maxRedemptions,
				endsAt: next.endsAt,
			});
			toast.success(
				row.status === "active"
					? `${voucher.code} is live — ${formatSharedUses(row)}${
							row.endsAt ? `, until ${formatVoucherMoment(row.endsAt)}` : ""
						}`
					: `${voucher.code} updated`,
			);
			onClose();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Couldn't extend it");
		} finally {
			setSaving(false);
		}
	}

	return (
		<DialogContent className="sm:max-w-lg">
			<DialogHeader>
				<DialogTitle>
					{reviving ? `Bring ${voucher.code} back` : `Extend ${voucher.code}`}
				</DialogTitle>
				<DialogDescription>
					{reviving
						? revivalSentence(voucher, Date.now())
						: `${formatSharedUses(voucher)} so far.`}{" "}
					You can give it more room, never less. Its discount and who qualifies
					stay as they are, because buyers have already been told.
				</DialogDescription>
			</DialogHeader>

			<Field>
				<FieldLabel>When it stops working</FieldLabel>
				<div className="flex flex-col gap-2">
					<LimitRow
						on={capOn}
						onChange={setCapOn}
						title="Total orders"
						subtitle={
							voucher.maxRedemptions !== undefined
								? `Now ${voucher.maxRedemptions}. Raise it, or turn it off.`
								: "Off now. Adding one would cut the code short."
						}
					>
						<div className="flex items-center gap-3">
							<Input
								aria-label="How many orders in total"
								variant="field"
								inputMode="numeric"
								value={cap}
								onChange={(e) => setCap(e.target.value)}
								isError={
									capOn &&
									(!Number.isInteger(capNumber) ||
										capNumber < (voucher.maxRedemptions ?? 1) ||
										capNumber > SHARED_USES_MAX)
								}
								className="max-w-28"
							/>
							<span className="text-sm text-muted-foreground">
								orders in total
							</span>
						</div>
					</LimitRow>
					<LimitRow
						on={endOn}
						onChange={setEndOn}
						title="End time"
						subtitle={
							voucher.endsAt !== undefined
								? `Now ${formatVoucherMoment(voucher.endsAt)}. Move it later, or turn it off.`
								: "Off now. Adding one would cut the code short."
						}
					>
						<div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,10rem)]">
							<DatePicker
								id="extend-end-date"
								label="Last day"
								value={endYmd}
								onChange={setEndYmd}
								min={ymdFromEpoch(
									todayMytMidnight(Math.max(Date.now(), voucher.endsAt ?? 0)),
								)}
							/>
							<TimePicker
								aria-label="End time"
								value={endHhmm}
								onChange={setEndHhmm}
							/>
						</div>
					</LimitRow>
				</div>
				<FieldDescription>
					{capOn && endOn
						? "Whichever comes first still ends it."
						: capOn
							? "With no end time, it runs until every use is taken."
							: endOn
								? "With no total, any number of orders can use it until it ends."
								: // Both off: the blocked line right below says it
									// (`SHARED_NEEDS_A_BOUND`) — a second wording here
									// would be the same rule twice.
									null}
				</FieldDescription>
			</Field>

			{blocked !== null && !saving ? (
				<p className="flex items-start gap-1.5 border-t border-border pt-3 text-xs font-medium text-muted-foreground">
					<Lock className="mt-px size-3.5 shrink-0" aria-hidden />
					{blocked}
				</p>
			) : null}
			<DialogFooter>
				<Button
					variant="outline"
					className="tap-target"
					onClick={onClose}
					disabled={saving}
				>
					Cancel
				</Button>
				<Button
					className="tap-target gap-2"
					onClick={submit}
					disabled={blocked !== null || saving}
				>
					{saving ? (
						<Loader2 className="size-4 animate-spin" aria-hidden />
					) : null}
					{reviving ? "Bring it back" : "Save"}
				</Button>
			</DialogFooter>
		</DialogContent>
	);
}

/**
 * What a dead shared code needs to come back, naming the bound(s) that
 * stopped it (`whatStoppedShared`). It never offers a move that can't revive
 * the code: a later end does nothing for a code that ran out, which is the
 * rule `sharedExtendError` enforces (PR #440 review) — so the description
 * and the refusal under it can't disagree.
 */
export function revivalSentence(
	voucher: {
		maxRedemptions?: number;
		redeemedCount?: number;
		endsAt?: number;
	},
	now: number,
): string {
	const { ranOut, ended } = whatStoppedShared(voucher, now);
	const uses = formatSharedUses(voucher);
	if (ranOut && ended)
		return `It ran out with ${uses}, and its end time has passed. Raise the total and move the end later to bring it back.`;
	if (ended && voucher.endsAt !== undefined)
		return `It ended ${formatVoucherMoment(voucher.endsAt)} with ${uses}. Move the end later to bring it back.`;
	return `It ran out with ${uses}. Raise the total to bring it back.`;
}
