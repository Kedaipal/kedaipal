import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { Lock, Plus, Ticket } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { DEFAULT_CURRENCY } from "../../../convex/lib/currency";
import {
	VOUCHER_NOTE_MAX,
	type VoucherStatus,
} from "../../../convex/lib/vouchers";
import { useDashboardRetailer } from "../../hooks/useDashboardRetailer";
import { usePermission } from "../../hooks/usePermission";
import { useAreaLock } from "../../hooks/useStoreLock";
import { isVoucherIssuingLocked } from "../../lib/subscription";
import {
	batchFallbackName,
	batchVoidableCount,
	groupVouchers,
	type VoucherGroup,
} from "../../lib/voucher-groups";
import { NeedsAccessNote } from "../app/owner-only-note";
import { ViewOnlyNote } from "../app/view-only-note";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";
import { Field, FieldDescription, FieldLabel } from "../ui/field";
import { FilterChip, FilterChipRow } from "../ui/filter-chip";
import { Input } from "../ui/input";
import { IssueVoucherDialog } from "./issue-voucher-dialog";
import { VoucherBatchCard } from "./voucher-batch-card";
import {
	VoucherList,
	VoucherListSkeleton,
	type VoucherRowView,
} from "./voucher-list";
import {
	type ShareableVoucher,
	VoucherShareSheet,
} from "./voucher-share-sheet";

/**
 * Vouchers (`z8r3fdr617`) — the seller's issue-and-track surface, now the
 * "Voucher codes" tab of the Promotions home (`z8r3fducfd`).
 *
 * It moved there because a voucher and a bulk sale price answer the same
 * question — "what am I offering buyers off?" — and the voucher ticket built
 * it to share that home. It is still not a settings tab (nothing here is
 * configuration — these are live promises with money attached) and not a
 * tab under Products (a voucher is not a product). `/app/vouchers` redirects
 * here, so every link already shared keeps working.
 *
 * The route is NOT plan-walled, unlike Customers and Insights. Issuing is the
 * Pro capability; the LIST is not, because a store that drops to Starter still
 * has outstanding codes it has to honour and must be able to see and void
 * them. So the gate lands on one button, with its reason beside it.
 */

/** A grouped run, as the card and the batch dialogs pass it around. */
type BatchGroup = Extract<VoucherGroup<VoucherRowView>, { kind: "batch" }>;

const FILTERS: Array<{ key: VoucherStatus | "all"; label: string }> = [
	{ key: "active", label: "Active" },
	{ key: "redeemed", label: "Used" },
	{ key: "expired", label: "Expired" },
	{ key: "voided", label: "Voided" },
	{ key: "all", label: "All" },
];

export function VouchersPanel() {
	const retailer = useDashboardRetailer();
	const { canRead } = usePermission("vouchers");
	// The ONE lock hook every greyed-with-reason control reads (useStoreLock.ts):
	// subscription view-only (admin-aware — a Kedaipal admin is never locked,
	// mirroring the server's assertSubscriptionActive bypass) composed with the
	// member write grant, in the house priority. Hand-deriving this here is how
	// the first /test-code pass found an admin shown a seller's view-only
	// sentence over a button the server would have accepted.
	const areaLock = useAreaLock("vouchers");
	const [filter, setFilter] = useState<VoucherStatus | "all">("active");
	const [issuing, setIssuing] = useState(false);
	const [sharing, setSharing] = useState<ShareableVoucher | null>(null);
	const [voiding, setVoiding] = useState<VoucherRowView | null>(null);
	const [voidingBatch, setVoidingBatch] = useState<BatchGroup | null>(null);
	const [renaming, setRenaming] = useState<BatchGroup | null>(null);
	const [renameText, setRenameText] = useState("");
	const voidVoucher = useMutation(api.vouchers.voidVoucher);
	const voidBatch = useMutation(api.vouchers.voidBatch);
	const renameBatch = useMutation(api.vouchers.renameBatch);

	// The whole book in one read; the chips filter it in memory and
	// `groupVouchers` collapses runs (see the query's own note on why).
	const result = useQuery(
		convexQuery(
			api.vouchers.list,
			retailer && canRead ? { retailerId: retailer._id } : "skip",
		),
	).data;

	if (!retailer) return null;

	// No grant at all → the note IS the surface (the query is skipped, so a
	// disabled body would sit over skeletons that never resolve).
	if (!canRead) {
		return <NeedsAccessNote area="vouchers" level="read" />;
	}

	// Captured after the guard above: the batch handlers are hoisted function
	// declarations, so TS can't carry the narrowing into them.
	const retailerId = retailer._id;
	const currency = retailer.currency ?? DEFAULT_CURRENCY;
	const loading = result === undefined;
	const vouchers = result?.vouchers ?? [];
	const counts = result?.counts;
	const issuingLocked = isVoucherIssuingLocked(retailer);
	// The server's answer, not a re-derivation: `vouchers.list` asks the same
	// `storeCanUseVouchers` the redemption doors ask, so the pill on a row and
	// the refusal a buyer gets can never disagree (the admin-lock lesson).
	const redemptionPaused = result?.paused ?? false;
	// One reason, in the house priority (subscription outranks the grant,
	// `useAreaLock` decides); the Pro gate speaks only when nothing locks.
	const issueBlockedReason = areaLock.readOnly
		? areaLock.reason
		: redemptionPaused
			? // NOT "you can still share them": below Pro the codes don't
				// redeem either, and telling a seller to keep sharing a dead code
				// is how their buyer finds out at the till. State the pause, then
				// the one lever they still have.
				"Vouchers are part of the Pro plan. The codes you've issued are paused — buyers can't redeem them until you're back on Pro, and nothing is lost in the meantime. You can still void any you'd rather not honour."
			: issuingLocked
				? "Issuing vouchers is part of the Pro plan — you can still share and void the codes you've already created."
				: null;

	// Filter in memory, then group: a batch parent keeps counting the whole run
	// even while a chip is showing one of its children.
	const shown =
		filter === "all" ? vouchers : vouchers.filter((v) => v.status === filter);
	const groups = groupVouchers(shown, vouchers);

	async function confirmVoid() {
		if (!voiding) return;
		try {
			await voidVoucher({ voucherId: voiding.id });
			toast.success(`${voiding.code} voided — it won't redeem any more`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Couldn't void it");
		} finally {
			setVoiding(null);
		}
	}

	async function confirmVoidBatch() {
		if (!voidingBatch) return;
		try {
			const { voided, skippedRedeemed } = await voidBatch({
				retailerId,
				batchId: voidingBatch.batchId,
			});
			// Name the skip rather than silently doing less than the button said.
			toast.success(
				skippedRedeemed > 0
					? `${voided} voided · ${skippedRedeemed} already used, left alone`
					: `${voided} ${voided === 1 ? "code" : "codes"} voided`,
			);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Couldn't void them");
		} finally {
			setVoidingBatch(null);
		}
	}

	async function confirmRename() {
		if (!renaming) return;
		try {
			await renameBatch({
				retailerId,
				batchId: renaming.batchId,
				note: renameText,
			});
			toast.success("Batch renamed");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Couldn't rename it");
		} finally {
			setRenaming(null);
		}
	}

	const issueButton = (
		<Button
			className="tap-target gap-1.5"
			onClick={() => setIssuing(true)}
			disabled={issueBlockedReason !== null}
		>
			<Plus className="size-4" aria-hidden />
			New voucher
		</Button>
	);

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-start justify-between gap-3">
				<p className="text-[13px] text-muted-foreground">
					Single-use codes you give one buyer at a time.
					{counts ? ` ${counts.active} active · ${counts.redeemed} used.` : ""}
				</p>
				<div className="shrink-0">{issueButton}</div>
			</div>

			{/* The gate's reason, where the seller is clicking — never a silent
			    disabled button. The SUBSCRIPTION case renders the house
			    ViewOnlyNote (self-hiding, links to Billing); the other causes
			    (grant, Pro) wear the same Lock-note clothes so one visual means
			    "why the action is off" — the first /test-code pass read the old
			    dashed box as a disabled search bar. */}
			<ViewOnlyNote />
			{issueBlockedReason !== null && areaLock.cause !== "subscription" ? (
				<div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/50 p-3 text-muted-foreground">
					<Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
					<p className="text-xs leading-relaxed">{issueBlockedReason}</p>
				</div>
			) : null}

			{/* Filter chips carry their counts, so a chip can show its number
			    while its tab is empty. */}
			<FilterChipRow>
				{FILTERS.map((f) => (
					<FilterChip
						key={f.key}
						selected={filter === f.key}
						onClick={() => setFilter(f.key)}
						count={
							counts
								? f.key === "all"
									? counts.active +
										counts.redeemed +
										counts.expired +
										counts.voided
									: counts[f.key]
								: undefined
						}
					>
						{f.label}
					</FilterChip>
				))}
			</FilterChipRow>

			{loading ? (
				<VoucherListSkeleton />
			) : groups.length === 0 ? (
				<EmptyState filter={filter} counts={counts} />
			) : (
				<ul className="flex flex-col gap-2">
					{groups.map((group) =>
						group.kind === "batch" ? (
							<VoucherBatchCard
								key={group.key}
								group={group}
								canWrite={!areaLock.readOnly}
								paused={redemptionPaused}
								onShare={(v) => setSharing(v)}
								onVoid={(v) => setVoiding(v)}
								onVoidBatch={(g) => setVoidingBatch(g)}
								onRename={(g) => {
									setRenameText(g.note ?? "");
									setRenaming(g);
								}}
							/>
						) : (
							// A singly-issued voucher is its own object — no parent to
							// collapse into, so it keeps the plain row.
							<VoucherList
								key={group.key}
								vouchers={[group.voucher]}
								canWrite={!areaLock.readOnly}
								paused={redemptionPaused}
								onShare={(v) => setSharing(v)}
								onVoid={(v) => setVoiding(v)}
							/>
						),
					)}
				</ul>
			)}

			<IssueVoucherDialog
				open={issuing}
				onClose={() => setIssuing(false)}
				retailerId={retailer._id}
				currency={currency}
				onIssued={(created) => {
					// A single voucher goes straight to the share sheet — issuing and
					// sending are one errand. A BATCH doesn't: there is no one code to
					// share, and the list is where a run is worked through.
					if (created.length === 1) {
						setFilter("active");
						const row = created[0];
						setSharing({ ...row, currency } as ShareableVoucher);
					} else {
						setFilter("active");
					}
				}}
			/>

			<VoucherShareSheet
				voucher={sharing}
				storeName={retailer.storeName}
				slug={retailer.slug}
				onClose={() => setSharing(null)}
			/>

			{/* Rename — the one bulk UPDATE a run needs (a voucher's value is
			    immutable once issued, so there is nothing else to change in
			    bulk). Reuses the house confirm shell rather than a bespoke
			    modal for one field. */}
			<Dialog
				open={renaming !== null}
				onOpenChange={(o) => !o && setRenaming(null)}
			>
				<DialogContent className="sm:max-w-sm">
					<DialogHeader>
						<DialogTitle>Name this batch</DialogTitle>
						<DialogDescription>
							{renaming
								? `${renaming.totalCount} codes issued together. Only you see this name — it's how you'll find the run again.`
								: ""}
						</DialogDescription>
					</DialogHeader>
					<Field>
						<FieldLabel htmlFor="batch-name">Batch name</FieldLabel>
						<Input
							id="batch-name"
							variant="field"
							maxLength={VOUCHER_NOTE_MAX}
							placeholder={
								renaming
									? batchFallbackName(renaming.totalCount, renaming.createdAt)
									: ""
							}
							value={renameText}
							onChange={(e) => setRenameText(e.target.value)}
						/>
						<FieldDescription>
							Leave it empty to go back to “
							{renaming
								? batchFallbackName(renaming.totalCount, renaming.createdAt)
								: ""}
							”.
						</FieldDescription>
					</Field>
					<DialogFooter>
						<Button
							variant="outline"
							className="tap-target"
							onClick={() => setRenaming(null)}
						>
							Cancel
						</Button>
						<Button className="tap-target" onClick={confirmRename}>
							Save name
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<ConfirmDialog
				open={voidingBatch !== null}
				onOpenChange={(o) => !o && setVoidingBatch(null)}
				title={
					voidingBatch
						? `Void ${batchVoidableCount(voidingBatch.counts)} remaining codes?`
						: ""
				}
				description={
					voidingBatch
						? `Every code in “${voidingBatch.note ?? batchFallbackName(voidingBatch.totalCount, voidingBatch.createdAt)}” that hasn't been used stops working straight away. Codes already spent are left alone — a placed order can't be clawed back. The run stays in your list with its history.`
						: ""
				}
				confirmLabel="Void them"
				destructive
				onConfirm={confirmVoidBatch}
			/>

			<ConfirmDialog
				open={voiding !== null}
				onOpenChange={(o) => !o && setVoiding(null)}
				title={`Void ${voiding?.code ?? ""}?`}
				description="The code stops working straight away. It stays in your list with its history, and anyone you've already sent it to will be told it's no longer valid."
				confirmLabel="Void it"
				destructive
				onConfirm={confirmVoid}
			/>
		</div>
	);
}

function hasAny(counts: Record<VoucherStatus, number> | undefined): boolean {
	if (!counts) return false;
	return counts.active + counts.redeemed + counts.expired + counts.voided > 0;
}

/**
 * Two genuinely different empties. A store with no vouchers at all needs to be
 * told what they're FOR; a filter with no matches needs to be told it's the
 * filter, not the store — otherwise someone whose codes are all spent reads
 * "no vouchers yet" and thinks they lost them.
 */
function EmptyState({
	filter,
	counts,
}: {
	filter: VoucherStatus | "all";
	counts: Record<VoucherStatus, number> | undefined;
}) {
	const filtered = hasAny(counts) && filter !== "all";
	return (
		<div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-10 text-center">
			<div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
				<Ticket className="size-5 text-muted-foreground" aria-hidden />
			</div>
			{filtered ? (
				<div>
					<p className="font-medium">No {labelFor(filter)} vouchers</p>
					<p className="mt-1 text-sm text-muted-foreground">
						{/* Name WHERE they are, not just that they're elsewhere —
						    the counts are already in hand, and "the different
						    filters above" made the seller read all four chips to
						    find out which one holds anything. */}
						Your vouchers are under {elsewhereLine(counts, filter)}.
					</p>
				</div>
			) : (
				<div className="max-w-sm">
					<p className="font-medium">No vouchers yet</p>
					<p className="mt-1 text-sm text-muted-foreground">
						A voucher is a single-use code you give one buyer — say, to make up
						for a late order, or as a giveaway at a stall. They enter it at
						checkout, or show you its QR at the counter.
					</p>
				</div>
			)}
		</div>
	);
}

/**
 * "Active (1) and Voided (7)" — the filters that actually hold something,
 * excluding the empty one the seller is standing on. Falls back to the vague
 * form only if the counts haven't loaded, which is the one case where naming
 * them would be a guess.
 */
export function elsewhereLine(
	counts: Record<VoucherStatus, number> | undefined,
	filter: VoucherStatus | "all",
): string {
	if (!counts) return "the other filters above";
	const named = FILTERS.filter(
		(f): f is (typeof FILTERS)[number] & { key: VoucherStatus } =>
			f.key !== "all" && f.key !== filter && counts[f.key] > 0,
	).map((f) => `${f.label} (${counts[f.key]})`);
	if (named.length === 0) return "the other filters above";
	if (named.length === 1) return named[0];
	return `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}

function labelFor(filter: VoucherStatus | "all"): string {
	return (
		FILTERS.find((f) => f.key === filter)?.label.toLowerCase() ?? "matching"
	);
}
