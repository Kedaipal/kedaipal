import { useMutation } from "convex/react";
import { Loader2, Lock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	mytMidnightFromYmd,
	todayMytMidnight,
	ymdFromEpoch,
} from "../../../convex/lib/fulfilmentDate";
import {
	VOUCHER_BATCH_MAX,
	VOUCHER_NOTE_MAX,
	voucherValueError,
} from "../../../convex/lib/vouchers";
import { formatPrice } from "../../lib/format";
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
import { InputPrefixFrame } from "../ui/input-prefix-frame";
import { ModeButton } from "../ui/mode-button";
import { Textarea } from "../ui/textarea";

/**
 * Issue one voucher, or a run of them (`z8r3fdr617`).
 *
 * The form makes the three decisions that matter obvious — what it is worth,
 * how long it lasts, how many — and refuses nothing the server would accept:
 * the value check is the SHARED `voucherValueError`, so the
 * disabled-with-reason button and the server's refusal can never disagree.
 *
 * Both choices are `ModeButton` pairs rather than a mode-less field, because
 * each is genuinely a pick-one: an amount or a percentage, never-expires or a
 * date. "No expiry" in particular is a REAL answer and the default, so it gets
 * its own card instead of hiding behind an empty date field that reads as
 * unfinished.
 *
 * Deliberate copy, each line answering something a seller would otherwise have
 * to discover the hard way: a voucher is single-use (said here, not learned
 * when the second buyer is turned away), and the discount comes off the ITEMS,
 * never delivery — the guard rail most likely to surprise whoever just gave
 * away "RM50 off".
 */
export function IssueVoucherDialog({
	open,
	onClose,
	retailerId,
	currency,
	onIssued,
}: {
	open: boolean;
	onClose: () => void;
	retailerId: Id<"retailers">;
	currency: string;
	/** Hands back the freshly minted run so the page can open the share sheet
	 * on a single voucher — issuing and sending are one errand. */
	onIssued: (vouchers: Array<{ code: string }>) => void;
}) {
	const createVoucher = useMutation(api.vouchers.create);
	const [kind, setKind] = useState<"fixed" | "percent">("fixed");
	const [amount, setAmount] = useState("");
	const [percent, setPercent] = useState("10");
	const [expires, setExpires] = useState(false);
	const [expiryYmd, setExpiryYmd] = useState("");
	const [note, setNote] = useState("");
	const [count, setCount] = useState("1");
	const [saving, setSaving] = useState(false);

	function reset() {
		setKind("fixed");
		setAmount("");
		setPercent("10");
		setExpires(false);
		setExpiryYmd("");
		setNote("");
		setCount("1");
	}

	// Minor units. An empty field is "nothing entered yet" — invalid, but it
	// must not shout at someone who hasn't typed anything.
	const parsed =
		kind === "fixed"
			? Math.round(Number.parseFloat(amount.replace(/,/g, "")) * 100)
			: Number.parseInt(percent, 10);
	const value = Number.isFinite(parsed) ? parsed : 0;
	const touched =
		kind === "fixed" ? amount.trim() !== "" : percent.trim() !== "";
	const valueError = touched ? voucherValueError({ kind, value }) : null;

	const howMany = Number.parseInt(count, 10);
	const countError =
		!Number.isInteger(howMany) || howMany < 1
			? "Enter how many to create"
			: howMany > VOUCHER_BATCH_MAX
				? `${VOUCHER_BATCH_MAX} at a time, max`
				: null;

	const expiryError =
		expires && expiryYmd === "" ? "Pick an expiry date" : null;

	const blocked = !touched
		? "Enter what the voucher is worth"
		: (valueError ?? countError ?? expiryError);

	async function submit() {
		if (blocked !== null) return;
		setSaving(true);
		try {
			const { vouchers } = await createVoucher({
				retailerId,
				kind,
				value,
				expiresAt:
					expires && expiryYmd !== ""
						? mytMidnightFromYmd(expiryYmd)
						: undefined,
				note: note.trim() || undefined,
				count: howMany > 1 ? howMany : undefined,
			});
			toast.success(
				vouchers.length === 1
					? `Voucher ${vouchers[0].code} created`
					: `${vouchers.length} vouchers created`,
			);
			reset();
			onIssued(vouchers);
			onClose();
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Couldn't create the voucher",
			);
		} finally {
			setSaving(false);
		}
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(o) => {
				if (!o && !saving) {
					reset();
					onClose();
				}
			}}
		>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>New voucher</DialogTitle>
					<DialogDescription>
						Each code works once, on one order. The discount comes off the items
						— never delivery or a deposit.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-5">
					<Field>
						<FieldLabel htmlFor="voucher-worth">What it takes off</FieldLabel>
						<div className="grid grid-cols-2 gap-2">
							<ModeButton
								active={kind === "fixed"}
								onClick={() => setKind("fixed")}
								title="An amount"
								subtitle={`${currencySymbol(currency)} off the order`}
							/>
							<ModeButton
								active={kind === "percent"}
								onClick={() => setKind("percent")}
								title="A percentage"
								subtitle="% off the items"
							/>
						</div>
						{kind === "fixed" ? (
							<InputPrefixFrame
								prefix={currencySymbol(currency)}
								invalid={valueError !== null}
							>
								<Input
									id="voucher-worth"
									variant="bare"
									inputMode="decimal"
									placeholder="10.00"
									value={amount}
									onChange={(e) => setAmount(e.target.value)}
									isError={valueError !== null}
								/>
							</InputPrefixFrame>
						) : (
							<InputPrefixFrame prefix="%" invalid={valueError !== null}>
								<Input
									id="voucher-worth"
									variant="bare"
									inputMode="numeric"
									placeholder="10"
									value={percent}
									onChange={(e) => setPercent(e.target.value)}
									isError={valueError !== null}
								/>
							</InputPrefixFrame>
						)}
						{valueError ? (
							<p role="alert" className="text-xs font-medium text-destructive">
								{valueError}
							</p>
						) : (
							<FieldDescription>
								{kind === "fixed"
									? `Capped at the order's item total — ${formatPrice(5000, currency)} off a ${formatPrice(3000, currency)} basket takes ${formatPrice(3000, currency)}, and delivery is still paid.`
									: "Taken off the item total, after any promo prices."}
							</FieldDescription>
						)}
					</Field>

					<Field>
						<FieldLabel>Expiry</FieldLabel>
						<div className="grid grid-cols-2 gap-2">
							<ModeButton
								active={!expires}
								onClick={() => setExpires(false)}
								title="Never expires"
								subtitle="Works until used or voided"
							/>
							<ModeButton
								active={expires}
								onClick={() => setExpires(true)}
								title="Expires on…"
								subtitle="Last day it works"
							/>
						</div>
						{expires ? (
							<>
								<DatePicker
									id="voucher-expiry"
									label="Last day"
									value={expiryYmd}
									onChange={setExpiryYmd}
									min={ymdFromEpoch(todayMytMidnight())}
									isError={expiryError !== null}
								/>
								<FieldDescription>
									Works all through that day, in your store's time.
								</FieldDescription>
							</>
						) : null}
					</Field>

					<Field>
						<FieldLabel htmlFor="voucher-count">How many</FieldLabel>
						<Input
							id="voucher-count"
							variant="field"
							inputMode="numeric"
							value={count}
							onChange={(e) => setCount(e.target.value)}
							isError={countError !== null}
							className="max-w-28"
						/>
						{countError ? (
							<p role="alert" className="text-xs font-medium text-destructive">
								{countError}
							</p>
						) : (
							<FieldDescription>
								{howMany > 1
									? `${howMany} separate codes, each good for one order. You can share or void the whole run together.`
									: "One code, for one order."}
							</FieldDescription>
						)}
					</Field>

					<Field>
						<FieldLabel htmlFor="voucher-note">
							Label{" "}
							<span className="font-normal text-muted-foreground">
								(optional)
							</span>
						</FieldLabel>
						<Textarea
							id="voucher-note"
							rows={2}
							maxLength={VOUCHER_NOTE_MAX}
							placeholder="Raya giveaway"
							value={note}
							onChange={(e) => setNote(e.target.value)}
						/>
						<FieldDescription>
							Only you see this — it's how you'll tell 20 look-alike codes apart
							in three months.
						</FieldDescription>
					</Field>
				</div>

				{/* The reason the action is off — in a tooltip nobody opens, it is
				    invisible; as a bare muted line under the last field, it reads as
				    a THIRD hint for the Label textarea (which is exactly how it
				    looked when rendered). So it is separated from the form, carries
				    the lock glyph, and sits in the action zone it belongs to. */}
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
						onClick={() => {
							reset();
							onClose();
						}}
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
						{howMany > 1 ? `Create ${howMany} vouchers` : "Create voucher"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** The store's own currency symbol for the plate — never a hardcoded "RM"
 * (an SG store bills in SGD, and the plate would be the first thing to lie). */
function currencySymbol(currency: string): string {
	return formatPrice(0, currency).replace(/[\d.,\s ]/g, "") || currency;
}
