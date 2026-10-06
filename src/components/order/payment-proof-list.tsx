import type { FunctionReturnType } from "convex/server";
import { ChevronDown, ExternalLink, ImageOff } from "lucide-react";
import { useId, useState } from "react";
import type { api } from "../../../convex/_generated/api";
import { formatOrderTimestamp } from "../../lib/format";
import { cn } from "../../lib/utils";
import { AppImage } from "../ui/app-image";
import { CopyButton } from "../ui/copy-button";
import { Skeleton } from "../ui/skeleton";

export type PaymentProofEntry = FunctionReturnType<
	typeof api.orders.listPaymentProofs
>[number];

/**
 * The buyer's "I've paid" submissions on the seller's order page (z8r3fdn2uj).
 *
 * `claimed` — inside the amber card, while the seller is deciding whether the
 * money arrived: the lead screenshot renders LARGE, because reading the
 * amount off it is the job. `received` — inside the green card, afterwards:
 * a compact thumbnail + reference row the seller can reopen for a dispute,
 * refund or reconciliation. Before this the proof vanished the moment the
 * payment was marked received.
 *
 * Either way the lead is the newest submission carrying a screenshot (see
 * `currentClaimIndex`), and every other submission sits under one collapsed
 * "Other submissions (n)" row — so a resubmit never silently hides the first
 * screenshot, and the common single-submission case shows no extra chrome.
 *
 * Every image is `sensitive` — a buyer's bank screenshot is order-owned and
 * erased on delete, so it must never land on the public image proxy.
 */
export function PaymentProofList({
	proofs,
	tone,
}: {
	/** `undefined` while loading. */
	proofs: readonly PaymentProofEntry[] | undefined;
	tone: "claimed" | "received";
}) {
	if (proofs === undefined) return <ProofSkeleton tone={tone} />;

	const current = proofs.find((p) => p.isCurrent);
	if (!current) {
		// Received with no claim = the seller marked it paid themselves (cash at
		// the counter, a transfer they spotted) — there's nothing the buyer sent.
		return tone === "claimed" ? (
			<p className="text-sm text-amber-900/90 dark:text-amber-200/90">
				No screenshot attached. Cross-check the amount and reference in your
				bank app.
			</p>
		) : null;
	}
	const others = proofs.filter((p) => !p.isCurrent);

	return (
		<div className="flex flex-col gap-2">
			{tone === "claimed" ? (
				<LargeProof entry={current} />
			) : (
				<CompactProof entry={current} />
			)}
			{others.length > 0 ? <OtherSubmissions entries={others} /> : null}
		</div>
	);
}

/**
 * The reference the seller reconciles by, for THIS submission: its own, else
 * the one another submission carried (`borrowedLeadReference`).
 *
 * One author, called by both cards. The amber card used to read the ORDER's
 * `paymentReference` instead — the LATEST value — so an order whose newest
 * submission was a reference-only fix showed one number while the seller was
 * deciding and a different one on the green card afterwards. Same order, two
 * reference numbers, and the seller tallying against a bank statement had no
 * way to tell which belonged to the screenshot in front of them. Found by
 * driving it (z8r3fdnpxf).
 */
export function leadReference(entry: PaymentProofEntry): string | null {
	// The borrow WINS over the lead's own: the server only ever borrows a
	// reference that is NEWER than the lead's, and a later reference is a
	// correction or an addition, never a regression. See `borrowedLeadReference`.
	return entry.borrowedReference?.reference ?? entry.reference ?? null;
}

/** Where a borrowed reference came from — never presented as this submission's. */
function BorrowedFrom({ entry }: { entry: PaymentProofEntry }) {
	if (!entry.borrowedReference) return null;
	return (
		<span className="text-xs text-muted-foreground">
			From their submission on{" "}
			{formatOrderTimestamp(entry.borrowedReference.submittedAt)}
		</span>
	);
}

/**
 * What the buyer sent, as the amber card states it while the seller decides.
 * Reads the SUBMISSION the screenshot belongs to, not the order — see
 * `leadReference`.
 */
function ClaimFacts({ entry }: { entry: PaymentProofEntry }) {
	const reference = leadReference(entry);
	return (
		<div className="flex flex-col gap-2 rounded-xl bg-background/80 p-3">
			<div className="flex items-start justify-between gap-3">
				<span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
					Reference
				</span>
				{reference ? (
					<div className="flex min-w-0 items-start gap-1">
						{/* Wrap, never truncate: a half-shown reference can't be matched
						    against a bank statement. */}
						<span className="min-w-0 wrap-anywhere text-right font-mono text-sm font-medium">
							{reference}
						</span>
						<CopyButton
							value={reference}
							ariaLabel="Copy customer's payment reference"
							successMessage="Reference copied"
							className="-my-2 -mr-2"
							labelClassName="sr-only"
						/>
					</div>
				) : (
					<em className="text-right text-sm font-normal text-muted-foreground">
						Not provided
					</em>
				)}
			</div>
			<div className="flex items-start justify-between gap-3">
				<span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
					Submitted
				</span>
				<span className="text-right text-sm">
					{formatOrderTimestamp(entry.submittedAt)}
				</span>
			</div>
			<BorrowedFrom entry={entry} />
		</div>
	);
}

/** The amber card's lead: the submission's own facts, then its full-width preview. */
function LargeProof({ entry }: { entry: PaymentProofEntry }) {
	return (
		<div className="flex flex-col gap-2">
			<ClaimFacts entry={entry} />
			{!entry.hasProof ? (
				<p className="text-sm text-amber-900/90 dark:text-amber-200/90">
					No screenshot attached. Cross-check the amount and reference in your
					bank app.
				</p>
			) : !entry.url ? (
				<ProofGoneNote />
			) : (
				<a
					href={entry.url}
					target="_blank"
					rel="noopener noreferrer"
					aria-label="Open payment screenshot full size"
					className="block overflow-hidden rounded-xl border border-amber-200 bg-background dark:border-amber-800"
				>
					<AppImage
						src={entry.url}
						alt="Payment receipt"
						aspect="h-64 w-full"
						objectFit="contain"
						sensitive
					/>
				</a>
			)}
		</div>
	);
}

/** The green card's lead: thumbnail + the reference the seller reconciles by. */
function CompactProof({ entry }: { entry: PaymentProofEntry }) {
	// A screenshot-only resubmit leads without a reference of its own; the
	// seller still gets the one the buyer sent earlier, labelled as such.
	const reference = leadReference(entry);
	return (
		<div className="flex flex-col gap-2">
			<p className="text-xs font-semibold uppercase tracking-widest text-emerald-800 dark:text-emerald-300">
				Customer&apos;s proof
			</p>
			<div className="flex items-start gap-3 rounded-xl bg-background/80 p-3">
				<Thumbnail entry={entry} size="lg" />
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<span className="text-xs text-muted-foreground">Reference</span>
					{reference ? (
						<div className="flex items-start justify-between gap-2">
							{/* Wrap, never truncate: a half-shown reference can't be
							    matched against a bank statement. wrap-anywhere breaks at
							    spaces first and only splits a long unbroken reference. */}
							<span className="min-w-0 wrap-anywhere font-mono text-sm font-medium">
								{reference}
							</span>
							<CopyButton
								value={reference}
								ariaLabel="Copy customer's payment reference"
								successMessage="Reference copied"
								className="-my-2 -mr-2"
								labelClassName="sr-only"
							/>
						</div>
					) : (
						<em className="text-sm text-muted-foreground">Not provided</em>
					)}
					<BorrowedFrom entry={entry} />
					<span className="text-xs text-muted-foreground">
						Sent {formatOrderTimestamp(entry.submittedAt)}
					</span>
					{!entry.hasProof ? (
						<span className="text-xs text-muted-foreground">
							No screenshot attached.
						</span>
					) : !entry.url ? (
						<span className="text-xs text-muted-foreground">
							Screenshot no longer available.
						</span>
					) : (
						<a
							href={entry.url}
							target="_blank"
							rel="noopener noreferrer"
							className="-ml-1 inline-flex min-h-11 w-fit items-center gap-1.5 rounded-lg px-1 text-sm font-medium text-foreground underline-offset-2 hover:underline"
						>
							<ExternalLink className="size-4" aria-hidden="true" />
							Open full size
						</a>
					)}
				</div>
			</div>
		</div>
	);
}

/**
 * Every submission that isn't the lead, newest first, behind one disclosure.
 * Collapsed by default: the lead is what the seller needs nine times in ten,
 * and a list of near-identical screenshots under it would bury the action.
 */
function OtherSubmissions({
	entries,
}: {
	entries: readonly PaymentProofEntry[];
}) {
	const [open, setOpen] = useState(false);
	const listId = useId();
	return (
		<div className="flex flex-col">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				aria-expanded={open}
				aria-controls={listId}
				className="flex min-h-11 items-center justify-between gap-2 rounded-lg px-1 text-sm font-medium text-foreground"
			>
				<span>Other submissions ({entries.length})</span>
				<ChevronDown
					className={cn("size-4 transition-transform", open && "rotate-180")}
					aria-hidden="true"
				/>
			</button>
			{open ? (
				<ul
					id={listId}
					className="flex flex-col divide-y divide-border rounded-xl bg-background/80"
				>
					{entries.map((entry) => (
						<li key={entry.key} className="flex items-center gap-3 p-3">
							<Thumbnail entry={entry} size="sm" />
							<div className="flex min-w-0 flex-1 flex-col">
								<span className="wrap-anywhere font-mono text-sm">
									{entry.reference ?? (
										<em className="font-sans text-muted-foreground">
											No reference
										</em>
									)}
								</span>
								<span className="text-xs text-muted-foreground">
									{formatOrderTimestamp(entry.submittedAt)}
									{entry.hasProof ? "" : " · no screenshot"}
								</span>
							</div>
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}

const THUMB_SIZE = {
	lg: "h-24 w-[72px]",
	// 44px wide: it's a tap target, not just a picture.
	sm: "h-14 w-11",
} as const;

/** Portrait box — receipts are tall, and a square crop cuts off the amount. */
function Thumbnail({
	entry,
	size,
}: {
	entry: PaymentProofEntry;
	size: keyof typeof THUMB_SIZE;
}) {
	const box = cn(
		"shrink-0 overflow-hidden rounded-lg border border-border bg-background",
		THUMB_SIZE[size],
	);
	if (!entry.hasProof || !entry.url) {
		return (
			<span
				className={cn(box, "flex items-center justify-center bg-muted")}
				role="img"
				aria-label={
					entry.hasProof ? "Screenshot no longer available" : "No screenshot"
				}
			>
				<ImageOff className="size-4 text-muted-foreground" aria-hidden="true" />
			</span>
		);
	}
	return (
		<a
			href={entry.url}
			target="_blank"
			rel="noopener noreferrer"
			aria-label={`Open payment screenshot sent ${formatOrderTimestamp(entry.submittedAt)}`}
			className={cn(box, "block")}
		>
			<AppImage
				src={entry.url}
				alt="Payment receipt"
				aspect="h-full w-full"
				objectFit="cover"
				sensitive
			/>
		</a>
	);
}

function ProofGoneNote() {
	return (
		<div className="flex items-center justify-center gap-2 rounded-xl border border-amber-200 bg-background p-4 text-xs text-muted-foreground dark:border-amber-800">
			<ImageOff className="size-4" aria-hidden="true" />
			Screenshot no longer available.
		</div>
	);
}

function ProofSkeleton({ tone }: { tone: "claimed" | "received" }) {
	return tone === "claimed" ? (
		<Skeleton className="h-64 w-full rounded-xl" />
	) : (
		<div className="flex items-start gap-3 rounded-xl bg-background/80 p-3">
			<Skeleton className="h-24 w-[72px] shrink-0 rounded-lg" />
			<div className="flex flex-1 flex-col gap-2 pt-1">
				<Skeleton className="h-3 w-16" />
				<Skeleton className="h-4 w-32" />
				<Skeleton className="h-3 w-24" />
			</div>
		</div>
	);
}
