// The Enterprise contract form (Credits T6, ClickUp z8r3fdkp8h,
// docs/pricing.md#enterprise) — a page of the seller sheet, like the credit
// ledger: one drawer, a back link to the seller. What the admin types here is
// what every Enterprise invoice bills and what the store is granted each month
// (`enterprise.setContract`, audited). Amounts are typed in major units and
// stored in minor ones; every reason the server would refuse is said beside
// the button first (`enterpriseContractProblem`, one author).
import { useMutation } from "convex/react";
import { ChevronLeft, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { AdminSellerRow } from "../../../convex/admin";
import {
	ENTERPRISE_BLOCK_SIZE_DEFAULT,
	enterpriseBlockPrice,
	enterpriseContractProblem,
} from "../../../convex/lib/enterprise";
import {
	BILLING_CURRENCY_FOR_COUNTRY,
	type BillingCurrency,
	type BillingCycle,
	enterprisePrice,
} from "../../../convex/lib/plans";
import {
	convexErrorMessage,
	currencySymbol,
	formatPrice,
} from "../../lib/format";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SheetDescription, SheetHeader, SheetTitle } from "../ui/sheet";
import { Textarea } from "../ui/textarea";

/** The credit ledger's own ceiling (`ADMIN_CREDIT_LIMIT`, convex/credits.ts) —
 * said before the tap rather than discovered after it. */
const MAX_INCLUDED = 100_000;

/** "888" / "888.50" → 88800 / 88850; anything else → NaN. */
function toMinor(raw: string): number {
	const trimmed = raw.trim();
	if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return Number.NaN;
	return Math.round(Number(trimmed) * 100);
}

function toWhole(raw: string): number {
	const trimmed = raw.trim();
	return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

const majorOf = (minor: number) =>
	minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2);

export function EnterpriseContractPage({
	seller,
	onBack,
}: {
	seller: AdminSellerRow;
	onBack: () => void;
}) {
	const setContract = useMutation(api.enterprise.setContract);
	const existing = seller.enterprise;
	// A new contract takes the store's billing currency; an existing one keeps
	// the currency it was agreed in (the server freezes it too).
	const currency: BillingCurrency =
		existing?.currency ?? BILLING_CURRENCY_FOR_COUNTRY[seller.country];

	const [fee, setFee] = useState(
		existing ? majorOf(existing.baseFeeMinor) : "",
	);
	const [included, setIncluded] = useState(
		existing ? String(existing.includedCredits) : "",
	);
	const [rate, setRate] = useState(
		existing ? majorOf(existing.overageRateMinor) : "",
	);
	const [block, setBlock] = useState(
		String(existing?.blockSize ?? ENTERPRISE_BLOCK_SIZE_DEFAULT),
	);
	const [cycle, setCycle] = useState<BillingCycle>(
		seller.billingCycle ?? "monthly",
	);
	const [contact, setContact] = useState(existing?.contactName ?? "");
	const [notes, setNotes] = useState(existing?.notes ?? "");
	const [saving, setSaving] = useState(false);

	const backRef = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		const back = backRef.current;
		const drawer = back?.closest<HTMLElement>('[data-slot="sheet-content"]');
		if (drawer) drawer.scrollTop = 0;
		back?.focus();
	}, []);

	const input = {
		baseFeeMinor: toMinor(fee),
		includedCredits: toWhole(included),
		overageRateMinor: toMinor(rate),
		blockSize: toWhole(block),
		billingCycle: cycle,
		contactName: contact,
		notes: notes.trim() || undefined,
	};
	const blankFields = !fee.trim() || !included.trim() || !rate.trim();
	const problem = blankFields
		? "Fill in the fee, the included credits and the overage rate."
		: enterpriseContractProblem(input, MAX_INCLUDED);
	const founding = seller.isFoundingMember;
	const refusal = seller.comped
		? "This store is comped — end the comp before putting it on a contract."
		: founding
			? "Founding Members stay on Founding Pro — a founding store can't be put on an Enterprise contract."
			: seller.subscriptionStatus === "on_hold"
				? "This store is on Off-Season Hold — resume it before putting it on a contract."
				: null;
	const blocked = refusal ?? problem;

	async function save() {
		if (blocked) return;
		setSaving(true);
		try {
			const res = await setContract({
				retailerId: seller._id,
				...input,
				contactName: contact.trim(),
			});
			toast.success(
				res.created ? `${seller.storeName} is on Enterprise` : "Contract saved",
				{
					description: res.created
						? "Its next invoice bills the contract, and its monthly credits are the contract's."
						: "Changes bill from the next invoice; a higher credit number lands this month.",
				},
			);
			onBack();
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	const preview = problem
		? null
		: `Bills ${formatPrice(enterprisePrice({ baseFeeMinor: input.baseFeeMinor, currency }, cycle), currency)} a ${cycle === "annual" ? "year" : "month"} · ${input.includedCredits.toLocaleString("en")} credits a month · blocks of ${input.blockSize.toLocaleString("en")} at ${formatPrice(input.overageRateMinor, currency)} = ${formatPrice(enterpriseBlockPrice(input), currency)}`;

	return (
		<>
			<SheetHeader className="gap-1 border-b border-border p-5 pr-14">
				<button
					ref={backRef}
					type="button"
					onClick={onBack}
					className="-ml-2 mb-1 inline-flex min-h-11 w-fit max-w-full items-center gap-1 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:min-h-9"
				>
					<ChevronLeft className="size-4 shrink-0" aria-hidden="true" />
					<span className="truncate">{seller.storeName}</span>
				</button>
				<SheetTitle className="font-heading text-xl font-bold">
					{existing ? "Enterprise contract" : "Put on an Enterprise contract"}
				</SheetTitle>
				<SheetDescription>
					What this store is billed and granted, per its deal. Saved to the
					store and logged to your admin account.
				</SheetDescription>
			</SheetHeader>

			<div className="flex flex-col gap-5 p-5">
				<div className="grid gap-4 sm:grid-cols-2">
					<Field
						id="ent-fee"
						label={`Monthly fee (${currencySymbol(currency)})`}
						value={fee}
						onChange={setFee}
						placeholder="e.g. 888"
						inputMode="decimal"
						hint={
							existing
								? "The contract's currency is fixed."
								: "In the store's billing currency."
						}
					/>
					<Field
						id="ent-included"
						label="Credits included a month"
						value={included}
						onChange={setIncluded}
						placeholder="e.g. 1500"
						inputMode="numeric"
						hint="Becomes the store's monthly grant."
					/>
					<Field
						id="ent-rate"
						label={`Overage per credit (${currencySymbol(currency)})`}
						value={rate}
						onChange={setRate}
						placeholder="e.g. 0.60"
						inputMode="decimal"
					/>
					<Field
						id="ent-block"
						label="Block size (credits)"
						value={block}
						onChange={setBlock}
						placeholder={String(ENTERPRISE_BLOCK_SIZE_DEFAULT)}
						inputMode="numeric"
					/>
				</div>

				<div className="flex flex-col gap-1.5">
					<span className="text-sm font-medium">Term</span>
					<div className="grid grid-cols-2 gap-2">
						{(["monthly", "annual"] as const).map((c) => (
							<button
								key={c}
								type="button"
								aria-pressed={cycle === c}
								onClick={() => setCycle(c)}
								className={cn(
									"min-h-11 rounded-xl border px-3 text-sm font-medium transition-colors",
									cycle === c
										? "border-accent bg-accent/10 text-accent"
										: "border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
								)}
							>
								{c === "monthly" ? "Monthly" : "Yearly — 2 months free"}
							</button>
						))}
					</div>
					<p className="text-xs text-muted-foreground">
						Yearly bills the monthly fee × 10 and locks fee and rate for the
						year.
					</p>
				</div>

				<Field
					id="ent-contact"
					label="Contact"
					value={contact}
					onChange={setContact}
					placeholder="Who the deal is with"
				/>
				<div className="flex flex-col gap-1.5">
					<label htmlFor="ent-notes" className="text-sm font-medium">
						Notes
					</label>
					<Textarea
						id="ent-notes"
						value={notes}
						onChange={(e) => setNotes(e.target.value)}
						rows={2}
						maxLength={500}
						placeholder="Anything the next admin should know — signed date, special terms…"
					/>
					<p className="text-xs text-muted-foreground">
						Admin-only — never shown to the seller.
					</p>
				</div>

				{preview ? (
					<p className="rounded-xl border border-accent/20 bg-accent/5 px-3 py-2 text-[13px] tabular-nums">
						{preview}
					</p>
				) : null}
				{!existing && !refusal ? (
					<p className="text-xs text-muted-foreground">
						Saving moves the store to Enterprise now: its next invoice bills
						this contract, its monthly credits become the included number (a
						higher number lands this month), and its seats become unlimited. The
						way off a contract is a scheduled move to Pro.
					</p>
				) : null}

				<div className="flex flex-col gap-1.5">
					<Button
						onClick={save}
						disabled={blocked !== null || saving}
						className="tap-target w-full sm:w-fit"
					>
						{saving ? <Loader2 className="size-4 animate-spin" /> : null}
						{existing ? "Save contract" : "Put on Enterprise"}
					</Button>
					{blocked ? (
						<p className="text-xs text-muted-foreground">{blocked}</p>
					) : null}
				</div>
			</div>
		</>
	);
}

function Field({
	id,
	label,
	value,
	onChange,
	placeholder,
	inputMode,
	hint,
}: {
	id: string;
	label: string;
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	inputMode?: "numeric" | "decimal";
	hint?: string;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<label htmlFor={id} className="text-sm font-medium">
				{label}
			</label>
			<Input
				id={id}
				variant="field"
				inputMode={inputMode}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
			/>
			{hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
		</div>
	);
}
