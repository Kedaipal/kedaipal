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
	enterpriseContractCaps,
	enterpriseContractProblem,
	enterpriseTermChangeBlocker,
} from "../../../convex/lib/enterprise";
import {
	type BillingCurrency,
	type BillingCycle,
	enterprisePrice,
	isUnlimited,
	PLAN_CAPS,
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

/** Blank means "the tier decides" — `undefined`, never 0. */
const optionalWhole = (raw: string): number | undefined =>
	raw.trim() === "" ? undefined : toWhole(raw);

/**
 * Another store's live contract, offered as a starting point. Every enterprise
 * deal is negotiated, so there is nothing stable enough to be a saved template
 * — but the LAST deal is the best first draft of the next one, and it already
 * exists. The picker only fills the form; nothing is saved until the button.
 */
export type EnterpriseContractTemplate = {
	retailerId: string;
	storeName: string;
	contract: NonNullable<AdminSellerRow["enterprise"]>;
};

export function EnterpriseContractPage({
	seller,
	templates,
	onBack,
}: {
	seller: AdminSellerRow;
	/** Other stores' contracts, to start a new deal from. Comes from the
	 * sellers list the drawer was opened out of — no extra query. */
	templates: EnterpriseContractTemplate[];
	onBack: () => void;
}) {
	const setContract = useMutation(api.enterprise.setContract);
	const existing = seller.enterprise;
	// A new contract is frozen in the store's BILLING currency — its last paid
	// bill's, else its country's — read from the same answer `setContract`
	// uses, so the label and the stored fee can never disagree. An existing
	// contract keeps the currency it was agreed in.
	const currency: BillingCurrency =
		existing?.currency ?? seller.billingCurrency;

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
	const [teammates, setTeammates] = useState(
		existing?.teammates === undefined ? "" : String(existing.teammates),
	);
	const [broadcasts, setBroadcasts] = useState(
		existing?.broadcastQuota === undefined
			? ""
			: String(existing.broadcastQuota),
	);
	const [contact, setContact] = useState(existing?.contactName ?? "");
	const [notes, setNotes] = useState(existing?.notes ?? "");
	const [saving, setSaving] = useState(false);
	// Which contract the form was started from, so the picker shows its own
	// effect instead of snapping back to the placeholder.
	const [startedFrom, setStartedFrom] = useState("");

	/** Fill every negotiated number from another deal — the fee, the credits,
	 * the overage, the allowances and the term. NOT the contact or the notes:
	 * those belong to the other buyer, and carrying them across is how the
	 * wrong name ends up on a contract. */
	const startFrom = (retailerId: string) => {
		setStartedFrom(retailerId);
		const from = templates.find((t) => t.retailerId === retailerId)?.contract;
		if (!from) return;
		setFee(majorOf(from.baseFeeMinor));
		setIncluded(String(from.includedCredits));
		setRate(majorOf(from.overageRateMinor));
		setBlock(String(from.blockSize));
		setTeammates(from.teammates === undefined ? "" : String(from.teammates));
		setBroadcasts(
			from.broadcastQuota === undefined ? "" : String(from.broadcastQuota),
		);
	};

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
		teammates: optionalWhole(teammates),
		broadcastQuota: optionalWhole(broadcasts),
		contactName: contact,
		notes: notes.trim() || undefined,
	};
	// Teammates already working in this store: people besides the owner, plus
	// pending invites (an invite holds a seat). The contract can't be saved
	// under it — the server refuses with the same sentence.
	const teammatesInUse =
		Math.max(0, seller.seats.active - 1) + seller.seats.invited;
	const blankFields = !fee.trim() || !included.trim() || !rate.trim();
	const problem = blankFields
		? "Fill in the fee, the included credits and the overage rate."
		: enterpriseContractProblem(input, MAX_INCLUDED, teammatesInUse);
	const founding = seller.isFoundingMember || seller.foundingIntent;
	// Every refusal `setContract` would throw, said here first.
	const refusal = seller.comped
		? "This store is comped — end the comp before putting it on a contract."
		: founding
			? "Founding Members stay on Founding Pro — a founding store can't be put on an Enterprise contract."
			: seller.subscriptionStatus === "on_hold"
				? "This store is on Off-Season Hold — resume it before putting it on a contract."
				: enterpriseTermChangeBlocker({
						pending: seller.pendingInvoice
							? {
									invoiceNumber: seller.pendingInvoice.invoiceNumber,
									plan: seller.pendingInvoice.plan,
									billingCycle: seller.pendingInvoice.billingCycle,
								}
							: undefined,
						billingCycle: cycle,
					});
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

	// What the typed numbers actually resolve to — the same helper the server
	// writes onto the row, so the preview can't flatter the save.
	const caps = enterpriseContractCaps(input);
	const preview = problem
		? null
		: `Bills ${formatPrice(enterprisePrice({ baseFeeMinor: input.baseFeeMinor, currency }, cycle), currency)} a ${cycle === "annual" ? "year" : "month"} · ${input.includedCredits.toLocaleString("en")} credits a month · ${isUnlimited(caps.userCap) ? "unlimited teammates" : `${caps.userCap - 1} ${caps.userCap === 2 ? "teammate" : "teammates"}`} · ${caps.broadcastQuota.toLocaleString("en")} broadcasts · blocks of ${input.blockSize.toLocaleString("en")} at ${formatPrice(input.overageRateMinor, currency)} = ${formatPrice(enterpriseBlockPrice(input), currency)}`;

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
				{/* Every deal is negotiated, so there is no template library worth
				    keeping — but the last deal is the best first draft of the next
				    one. Offered only on a NEW contract: on a live one it would
				    overwrite numbers someone is editing. */}
				{!existing && templates.length > 0 ? (
					<div className="flex flex-col gap-1.5">
						<label htmlFor="ent-template" className="text-sm font-medium">
							Start from another contract
						</label>
						<select
							id="ent-template"
							value={startedFrom}
							onChange={(e) => startFrom(e.target.value)}
							className="min-h-11 rounded-xl border border-input bg-background px-3 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
						>
							<option value="">Start from scratch</option>
							{templates.map((t) => (
								<option key={t.retailerId} value={t.retailerId}>
									{t.storeName} —{" "}
									{formatPrice(t.contract.baseFeeMinor, t.contract.currency)}/mo
									· {t.contract.includedCredits.toLocaleString("en")} credits
								</option>
							))}
						</select>
						<p className="text-xs text-muted-foreground">
							Fills the numbers only — the contact and notes stay this deal's.
							Nothing is saved until you press the button.
						</p>
					</div>
				) : null}

				<div className="flex flex-col gap-2">
					<span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						What they pay
					</span>
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
				</div>

				<div className="flex flex-col gap-2">
					<span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						What they get each month
					</span>
					<div className="grid gap-4 sm:grid-cols-2">
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
							id="ent-teammates"
							label="Teammates"
							value={teammates}
							onChange={setTeammates}
							placeholder="Unlimited"
							inputMode="numeric"
							hint={
								teammatesInUse > 0
									? `Besides the owner. Blank = unlimited. Using ${teammatesInUse} now.`
									: "Besides the owner. Blank = unlimited."
							}
						/>
						<Field
							id="ent-broadcasts"
							label="Broadcasts a month"
							value={broadcasts}
							onChange={setBroadcasts}
							placeholder={String(PLAN_CAPS.enterprise.broadcastQuota)}
							inputMode="numeric"
							hint={`Blank = the tier default (${PLAN_CAPS.enterprise.broadcastQuota}). Broadcasts aren't built yet.`}
						/>
					</div>
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
						higher number lands this month), and it gets{" "}
						{isUnlimited(caps.userCap)
							? "unlimited teammates"
							: `${caps.userCap - 1} ${caps.userCap === 2 ? "teammate" : "teammates"}`}
						. The way off a contract is a scheduled move to Pro.
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
