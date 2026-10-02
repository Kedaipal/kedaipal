// The admin credit ledger (Kedaipal Credits T5, docs/credits.md): one store's
// balances and open lots, every movement newest first, and the two admin
// levers — a hand adjustment and a custom monthly grant. A page INSIDE the
// seller sheet, opened from its Credits section with a back link to the
// seller — one drawer, never a drawer stacked on a drawer (Zaki, 1 Oct
// 2026). The server gates every read and write with `requireAdmin`, and both
// writes are audited.
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation, usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ChevronLeft, Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import type { AdminSellerRow } from "../../../convex/admin";
import { GRANT_LEVER_CONTRACT_REFUSAL } from "../../../convex/lib/credits";
import { PURCHASED_CREDIT_LIFETIME_MONTHS } from "../../../convex/lib/plans";
import { convexErrorMessage, formatShortDate } from "../../lib/format";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SheetDescription, SheetHeader, SheetTitle } from "../ui/sheet";
import { Skeleton } from "../ui/skeleton";
import { Textarea } from "../ui/textarea";

/** The server's typo guard (`ADMIN_CREDIT_LIMIT`, convex/credits.ts) — said
 * before the tap rather than discovered after it. */
const ADMIN_CREDIT_LIMIT = 100_000;
const NOTE_MIN = 3;
const NOTE_MAX = 500;
const PAGE_SIZE = 20;

type LedgerRow = Doc<"creditLedger">;
type Bucket = "plan" | "purchased";

const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

/** "2026-10" → "Oct 2026" — the usage period is the MYT calendar month. */
export function periodLabel(periodKey: string): string {
	const [year, month] = periodKey.split("-");
	const name = MONTHS[Number(month) - 1];
	return name ? `${name} ${year}` : periodKey;
}

const TYPE_LABEL: Record<LedgerRow["type"], string> = {
	grant: "Grant",
	purchase: "Top-up",
	debit: "Order",
	refund: "Refund",
	adjust: "Adjustment",
	expire: "Expired",
};

const CAUSE_LABEL: Record<NonNullable<LedgerRow["cause"]>, string> = {
	seller: "cancelled by the seller",
	system: "lapsed on its own",
	buyer: "the buyer backed out",
	admin: "removed by an admin",
};

/** What a ledger row was, in a sentence fragment an admin can scan. */
export function ledgerRowLabel(row: LedgerRow): string {
	if (row.type === "grant")
		return row.reason === "trial" ? "Trial allowance" : "Monthly credits";
	if (row.type === "debit") return row.refLabel ?? "Order";
	if (row.type === "refund")
		return `${row.refLabel ?? "Order"}${row.cause ? ` · ${CAUSE_LABEL[row.cause]}` : ""}`;
	if (row.type === "expire")
		return row.bucket === "plan"
			? "Unused monthly credits"
			: `Bought credits past their ${PURCHASED_CREDIT_LIFETIME_MONTHS} months`;
	if (row.type === "purchase") return "Top-up pack";
	if (row.reason === "referral_referee" || row.reason === "referral_referrer")
		return "Referral reward";
	if (row.reason === "enterprise_block") return "Enterprise overage block";
	return row.bucket === "plan" ? "Plan credits" : "Bought credits";
}

/**
 * The ledger page of the seller sheet. `onBack` returns to the seller's
 * details; it takes focus on arrival, and the page starts at its top even when
 * the details were scrolled to the Credits section.
 */
export function CreditLedgerBody({
	seller,
	onBack,
}: {
	seller: AdminSellerRow;
	onBack?: () => void;
}) {
	const state = useQuery(
		convexQuery(api.credits.adminGetAccount, { retailerId: seller._id }),
	).data;
	const backRef = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		const back = backRef.current;
		// The drawer is the scroll container: start the page at its top.
		const drawer = back?.closest<HTMLElement>('[data-slot="sheet-content"]');
		if (drawer) drawer.scrollTop = 0;
		back?.focus();
	}, []);
	return (
		<>
			<SheetHeader className="gap-1 border-b border-border p-5 pr-14">
				{onBack ? (
					<button
						ref={backRef}
						type="button"
						onClick={onBack}
						className="-ml-2 mb-1 inline-flex min-h-11 w-fit max-w-full items-center gap-1 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:min-h-9"
					>
						<ChevronLeft className="size-4 shrink-0" aria-hidden="true" />
						<span className="truncate">{seller.storeName}</span>
					</button>
				) : null}
				<SheetTitle className="font-heading text-xl font-bold">
					Credit ledger
				</SheetTitle>
				<SheetDescription>
					Balances, open lots and every movement, newest first. Adjust by hand
					or set a custom monthly grant below — both are logged to your admin
					account.
				</SheetDescription>
			</SheetHeader>
			<div className="flex flex-col gap-6 p-5">
				{state === undefined ? (
					<div className="flex flex-col gap-2" aria-busy="true">
						<Skeleton className="h-20 w-full rounded-2xl" />
						<Skeleton className="h-11 w-full rounded-xl" />
					</div>
				) : state.view === null ? (
					<p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
						This store no longer exists.
					</p>
				) : (
					<>
						<BalanceBlock state={state} />
						<AdjustForm
							retailerId={seller._id}
							purchased={state.view.purchased}
							enterpriseBlockSize={
								seller.plan === "enterprise"
									? seller.enterprise?.blockSize
									: undefined
							}
						/>
						<GrantForm
							retailerId={seller._id}
							customGrant={state.account?.grantOverride}
							periodGrant={state.view.periodGrant}
							// SETTING a recurring allowance is a contract's or a comp's
							// job now (GRANT_LEVER_CONTRACT_REFUSAL) — a list-price plan
							// gets the reason, not a lever.
							setLocked={
								!(seller.plan === "enterprise" && seller.enterprise) &&
								!seller.comped
							}
						/>
					</>
				)}
				<LedgerList retailerId={seller._id} />
			</div>
		</>
	);
}

/** What `credits.adminGetAccount` answers: the projected balance, the raw
 * account row (null before the store's first order / the backfill) and the
 * open lots. */
type AccountState = FunctionReturnType<typeof api.credits.adminGetAccount>;

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-3">
			<h3 className="text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
				{title}
			</h3>
			{children}
		</section>
	);
}

function BalanceBlock({ state }: { state: AccountState }) {
	const view = state.view;
	if (!view) return null;
	const out = view.total <= 0;
	return (
		<Section title="Balance">
			{state.account === null ? (
				// No account row yet: the numbers below are the projection the
				// store would open with — say so, or they read as stored fact.
				<p className="text-xs text-muted-foreground">
					No credit account yet — it opens with the store's first order or the
					backfill. Showing what it would open with.
				</p>
			) : null}
			<div
				className={cn(
					"flex flex-col gap-1 rounded-2xl border p-4",
					out
						? "border-destructive/30 bg-destructive/10"
						: "border-border bg-muted/40",
				)}
			>
				<p
					className={cn(
						"text-2xl font-bold tabular-nums",
						out && "text-destructive",
					)}
				>
					{view.total < 0 ? `${-view.total} owed` : `${view.total} left`}
				</p>
				<p className="text-xs text-muted-foreground">
					Plan {view.plan} · bought {view.purchased}
					{view.exhaustedAt !== null
						? ` · out since ${formatShortDate(view.exhaustedAt)}`
						: ""}
				</p>
			</div>
			<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
				<dt className="text-muted-foreground">This month</dt>
				<dd>
					{periodLabel(view.periodKey)} · {view.periodGrant} granted
				</dd>
				<dt className="text-muted-foreground">Grant</dt>
				<dd>
					{view.regime === "trial"
						? "Trial allowance — one-off, not refreshed monthly"
						: view.regime === "none"
							? "None until the store pays or resumes"
							: `${view.nextGrant ?? view.periodGrant} a month${view.customGrant ? " (custom)" : ""}`}
				</dd>
				{view.refreshesAt !== null ? (
					<>
						<dt className="text-muted-foreground">Refreshes</dt>
						<dd>{formatShortDate(view.refreshesAt)}</dd>
					</>
				) : null}
				<dt className="text-muted-foreground">Seller refunds</dt>
				<dd>{view.sellerRefundsLeft} left this month</dd>
			</dl>
			{state.lots.length > 0 ? (
				<div className="flex flex-col gap-1">
					<p className="text-xs font-medium">Bought credits, by lot</p>
					<ul className="flex flex-col divide-y divide-border/60 rounded-xl border border-border text-[13px]">
						{state.lots.map((lot) => (
							<li
								key={lot._id}
								className="flex items-center justify-between gap-3 px-3 py-2"
							>
								<span className="tabular-nums">
									{lot.remaining} of {lot.credits}
								</span>
								<span className="text-muted-foreground">
									expires {formatShortDate(lot.expiresAt)}
								</span>
							</li>
						))}
					</ul>
				</div>
			) : null}
		</Section>
	);
}

/** A whole-number amount, or why it isn't one yet. */
function parseAmount(raw: string): { amount: number } | { reason: string } {
	const trimmed = raw.trim();
	if (!trimmed) return { reason: "Enter how many credits." };
	const n = Number(trimmed);
	if (!Number.isInteger(n))
		return { reason: "Credits are whole numbers — no decimals." };
	if (n === 0) return { reason: "Enter a number other than zero." };
	if (Math.abs(n) > ADMIN_CREDIT_LIMIT)
		return {
			reason: `That's more than ${ADMIN_CREDIT_LIMIT.toLocaleString("en")} credits — check the number.`,
		};
	return { amount: n };
}

function AdjustForm({
	retailerId,
	purchased,
	enterpriseBlockSize,
}: {
	retailerId: AdminSellerRow["_id"];
	purchased: number;
	/** Set on an Enterprise store (T6): its contract's block size, so an
	 * overage block can be landed under its own ledger reason. */
	enterpriseBlockSize?: number;
}) {
	const adjust = useMutation(api.credits.adminAdjust);
	const [bucket, setBucket] = useState<Bucket>("plan");
	const [raw, setRaw] = useState("");
	const [note, setNote] = useState("");
	const [saving, setSaving] = useState(false);
	const [block, setBlock] = useState(false);

	const parsed = parseAmount(raw);
	const amount = "amount" in parsed ? parsed.amount : null;
	// Every reason the server would refuse, said beside the button instead.
	const blocked =
		"reason" in parsed
			? parsed.reason
			: block && amount !== null && amount < 0
				? "A block adds bought credits — enter a positive number."
				: bucket === "purchased" && amount !== null && -amount > purchased
					? `This store holds ${purchased} bought credits — take away at most that many, or adjust the plan credits instead.`
					: note.trim().length < NOTE_MIN
						? "Add a note saying why."
						: null;

	const noun = bucket === "plan" ? "plan" : "bought";
	const label =
		amount === null
			? "Adjust credits"
			: block
				? `Land a ${amount.toLocaleString("en")}-credit block`
				: amount > 0
					? `Add ${amount} ${noun} credit${amount === 1 ? "" : "s"}`
					: `Take away ${-amount} ${noun} credit${amount === -1 ? "" : "s"}`;

	function toggleBlock(on: boolean) {
		setBlock(on);
		if (on && enterpriseBlockSize !== undefined) {
			setBucket("purchased");
			setRaw(String(enterpriseBlockSize));
		}
	}

	async function submit() {
		if (blocked || amount === null) return;
		setSaving(true);
		try {
			const res = await adjust({
				retailerId,
				bucket,
				amount,
				note,
				...(block ? { enterpriseBlock: true } : {}),
			});
			toast.success("Credits adjusted", {
				description: `Now plan ${res.plan} · bought ${res.purchased}.`,
			});
			setRaw("");
			setNote("");
			setBlock(false);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	return (
		<Section title="Adjust by hand">
			{/* The same segmented choice the comp dialog uses — one idea, one
			    control. */}
			{enterpriseBlockSize !== undefined ? (
				<label className="flex items-start gap-2.5 rounded-xl border border-border p-3 text-sm">
					<input
						type="checkbox"
						checked={block}
						onChange={(e) => toggleBlock(e.target.checked)}
						className="mt-0.5 size-4"
					/>
					<span>
						<span className="font-medium">Enterprise overage block</span>
						<span className="block text-xs text-muted-foreground">
							Bought credits under the contract, landed once its manual invoice
							is paid — logged as a block, not goodwill.
						</span>
					</span>
				</label>
			) : null}
			<div className="grid grid-cols-2 gap-2">
				{(["plan", "purchased"] as const).map((b) => (
					<button
						key={b}
						type="button"
						aria-pressed={bucket === b}
						disabled={block && b === "plan"}
						onClick={() => setBucket(b)}
						className={cn(
							"min-h-11 rounded-xl border px-3 text-sm font-medium transition-colors",
							bucket === b
								? "border-accent bg-accent/10 text-accent"
								: "border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
						)}
					>
						{b === "plan" ? "Plan credits" : "Bought credits"}
					</button>
				))}
			</div>
			<p className="text-xs text-muted-foreground">
				{bucket === "plan"
					? "Plan credits last until this month's reset — right for a one-off correction to this month."
					: `Added bought credits land as a lot that lasts ${PURCHASED_CREDIT_LIFETIME_MONTHS} months, like a top-up. Taking away uses the oldest lot first and can't go below zero.`}
			</p>
			<div className="flex flex-col gap-1.5">
				<label htmlFor="credit-adjust-amount" className="text-sm font-medium">
					Credits
				</label>
				<Input
					id="credit-adjust-amount"
					variant="field"
					inputMode="numeric"
					value={raw}
					onChange={(e) => setRaw(e.target.value)}
					placeholder="e.g. 50, or -20 to take away"
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<label htmlFor="credit-adjust-note" className="text-sm font-medium">
					Note
				</label>
				<Textarea
					id="credit-adjust-note"
					value={note}
					onChange={(e) => setNote(e.target.value)}
					maxLength={NOTE_MAX}
					rows={2}
					placeholder="Why — goodwill, a correction, a refunded top-up…"
				/>
				<p className="text-xs text-muted-foreground">
					Required. Admin-only: kept on the store's ledger, never shown to the
					seller.
				</p>
			</div>
			<div className="flex flex-col gap-1.5">
				<Button
					onClick={submit}
					disabled={blocked !== null || saving}
					className="tap-target w-full sm:w-fit"
				>
					{saving ? <Loader2 className="size-4 animate-spin" /> : null}
					{label}
				</Button>
				{blocked && raw.trim() ? (
					<p className="text-xs text-muted-foreground">{blocked}</p>
				) : null}
			</div>
		</Section>
	);
}

function GrantForm({
	retailerId,
	customGrant,
	periodGrant,
	setLocked,
}: {
	retailerId: AdminSellerRow["_id"];
	customGrant: number | undefined;
	periodGrant: number;
	/** A list-price plan (not comped, no contract): setting is refused with
	 * the one-author reason; clearing a stale grant still works. */
	setLocked: boolean;
}) {
	const setGrant = useMutation(api.credits.adminSetGrantOverride);
	const [raw, setRaw] = useState(
		customGrant !== undefined ? String(customGrant) : "",
	);
	const [saving, setSaving] = useState<"save" | "clear" | null>(null);

	const n = Number(raw.trim());
	const valid =
		raw.trim() !== "" &&
		Number.isInteger(n) &&
		n >= 0 &&
		n <= ADMIN_CREDIT_LIMIT;
	const unchanged = valid && n === customGrant;
	const reason = !raw.trim()
		? null
		: !valid
			? `A whole number of credits from 0 to ${ADMIN_CREDIT_LIMIT.toLocaleString("en")}.`
			: unchanged
				? "That's the grant already set."
				: null;

	async function run(grant: number | null) {
		setSaving(grant === null ? "clear" : "save");
		try {
			const res = await setGrant({ retailerId, grant });
			toast.success(
				grant === null
					? "Custom grant cleared — back to the plan's grant from next month"
					: `Custom grant set to ${grant} a month`,
				{ description: `This month: ${res.periodGrant} granted.` },
			);
			if (grant === null) setRaw("");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(null);
		}
	}

	return (
		<Section title="Custom monthly grant">
			<p className="text-[13px]">
				{customGrant !== undefined ? (
					<>
						<strong className="font-semibold">{customGrant} a month</strong> —
						custom
					</>
				) : (
					<>The plan's grant ({periodGrant} this month)</>
				)}
			</p>
			{setLocked ? (
				<p className="text-xs text-muted-foreground">
					{GRANT_LEVER_CONTRACT_REFUSAL}
				</p>
			) : (
				<p className="text-xs text-muted-foreground">
					Beats every plan grant — for a sponsored store, or edits an Enterprise
					contract's included credits — and the seller gets no upgrade nudges. A
					higher grant lands its difference this month; a lower one, or clearing
					it, waits for next month.
				</p>
			)}
			{setLocked ? null : (
				<div className="flex flex-col gap-1.5">
					<label htmlFor="credit-grant" className="text-sm font-medium">
						Credits a month
					</label>
					<Input
						id="credit-grant"
						variant="field"
						inputMode="numeric"
						value={raw}
						onChange={(e) => setRaw(e.target.value)}
						placeholder="e.g. 1000"
					/>
				</div>
			)}
			<div className="flex flex-col gap-2 sm:flex-row">
				{setLocked ? null : (
					<Button
						onClick={() => run(n)}
						disabled={!valid || unchanged || saving !== null}
						className="tap-target w-full sm:w-fit"
					>
						{saving === "save" ? (
							<Loader2 className="size-4 animate-spin" />
						) : null}
						{valid && !unchanged ? `Set ${n} a month` : "Set custom grant"}
					</Button>
				)}
				{customGrant !== undefined ? (
					<Button
						variant="outline"
						onClick={() => run(null)}
						disabled={saving !== null}
						className="tap-target w-full sm:w-fit"
					>
						{saving === "clear" ? (
							<Loader2 className="size-4 animate-spin" />
						) : null}
						Clear — use the plan's grant
					</Button>
				) : null}
			</div>
			{reason ? (
				<p className="text-xs text-muted-foreground">{reason}</p>
			) : null}
		</Section>
	);
}

function LedgerList({ retailerId }: { retailerId: AdminSellerRow["_id"] }) {
	const { results, status, loadMore } = usePaginatedQuery(
		api.credits.adminListLedger,
		{ retailerId },
		{ initialNumItems: PAGE_SIZE },
	);
	return (
		<Section title="Ledger">
			{status === "LoadingFirstPage" ? (
				<div className="flex flex-col gap-2" aria-busy="true">
					<Skeleton className="h-14 w-full rounded-xl" />
					<Skeleton className="h-14 w-full rounded-xl" />
				</div>
			) : results.length === 0 ? (
				<p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
					No credit movements yet. The first one is the store's grant.
				</p>
			) : (
				<ul className="flex flex-col divide-y divide-border/60 rounded-xl border border-border">
					{results.map((row) => (
						<LedgerItem key={row._id} row={row} />
					))}
				</ul>
			)}
			{status === "CanLoadMore" || status === "LoadingMore" ? (
				<Button
					variant="outline"
					onClick={() => loadMore(PAGE_SIZE)}
					disabled={status === "LoadingMore"}
					className="tap-target w-full"
				>
					{status === "LoadingMore" ? (
						<Loader2 className="size-4 animate-spin" />
					) : null}
					Show older movements
				</Button>
			) : null}
		</Section>
	);
}

function LedgerItem({ row }: { row: LedgerRow }) {
	const positive = row.amount > 0;
	return (
		<li className="flex flex-col gap-1 px-3 py-2.5 text-[13px]">
			<div className="flex items-baseline justify-between gap-3">
				<span className="flex min-w-0 items-baseline gap-2">
					<span className="shrink-0 rounded-md bg-muted px-1.5 py-px text-[11px] font-semibold text-muted-foreground">
						{TYPE_LABEL[row.type]}
					</span>
					<span className="truncate">{ledgerRowLabel(row)}</span>
				</span>
				<span
					className={cn(
						"shrink-0 font-semibold tabular-nums",
						positive ? "text-foreground" : "text-muted-foreground",
					)}
				>
					{positive ? `+${row.amount}` : `−${-row.amount}`}
				</span>
			</div>
			<div className="flex items-baseline justify-between gap-3 text-[11px] text-muted-foreground">
				<span>
					{formatShortDate(row.createdAt)} ·{" "}
					{row.bucket === "plan" ? "plan" : "bought"}
				</span>
				<span className="tabular-nums">
					after: plan {row.planAfter} · bought {row.purchasedAfter}
				</span>
			</div>
			{row.note ? (
				<p className="text-xs text-muted-foreground">
					<span className="font-medium text-foreground">Admin note:</span>{" "}
					{row.note}
				</p>
			) : null}
		</li>
	);
}
