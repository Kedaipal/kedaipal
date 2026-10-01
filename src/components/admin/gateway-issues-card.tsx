import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { convexErrorMessage, formatPrice, formatShortDate } from "../../lib/format";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { CopyButton } from "../ui/copy-button";
import { Skeleton } from "../ui/skeleton";

type GatewayIssueRow = NonNullable<
	ReturnType<typeof useGatewayIssues>
>[number];

function useGatewayIssues() {
	return useQuery(convexQuery(api.invoices.listGatewayIssues, {})).data;
}

/** Wired card: query + resolve mutation around the pure view below. */
export function GatewayIssuesCard() {
	const issues = useGatewayIssues();
	const resolveIssue = useMutation(api.invoices.resolveGatewayIssue);
	if (issues === undefined) {
		return <Skeleton className="h-16 w-full rounded-2xl" />;
	}
	return (
		<GatewayIssuesView
			issues={issues}
			onResolve={async (invoiceId, note) => {
				try {
					await resolveIssue({ invoiceId, note });
					toast.success("Marked resolved");
					return true;
				} catch (err) {
					toast.error(convexErrorMessage(err));
					return false;
				}
			}}
		/>
	);
}

/** What happened, in the words of what to do about it. The invoice's status
 * is part of the meaning: the same late payment is "refund it" on a paid
 * bill and "refund it or apply it to their open bill" on a voided one. */
function issueCopy(row: GatewayIssueRow): string {
	if (row.kind === "amount_mismatch") {
		return "A HitPay payment landed that doesn't match this invoice's total — check the HitPay dashboard before settling anything.";
	}
	return row.invoiceStatus === "void"
		? "Paid after this invoice was voided. Decide with the seller: refund it in HitPay, or apply it by marking their open bill paid."
		: "Paid on top of an invoice that was already settled — a double payment. It likely needs a refund in HitPay.";
}

const STATUS_PILL: Record<GatewayIssueRow["invoiceStatus"], string> = {
	pending:
		"bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
	paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
	void: "bg-muted text-muted-foreground",
};

/**
 * Admin billing: "Payments to review" — every gateway payment that landed
 * without settling anything and still awaits a human decision. This queue
 * exists because a `late_payment` sits on a PAID or VOID invoice by
 * definition, so the pending-invoices list below structurally cannot show
 * it — the money was invisible exactly when it mattered (a possible double
 * payment). Rendered only while there is something to review: an
 * ever-present empty queue would teach the eye to skip it.
 */
export function GatewayIssuesView({
	issues,
	onResolve,
}: {
	issues: GatewayIssueRow[];
	/** Resolves true on success (closes the dialog). */
	onResolve: (invoiceId: GatewayIssueRow["invoiceId"], note?: string) => Promise<boolean>;
}) {
	const [resolving, setResolving] = useState<GatewayIssueRow | null>(null);

	if (issues.length === 0) return null;

	return (
		<section className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50/50 p-4 dark:border-red-900 dark:bg-red-950/20 lg:p-5">
			<div className="flex items-start gap-2.5">
				<AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-600 dark:text-red-400" />
				<div>
					<p className="text-sm font-semibold">
						Payments to review ({issues.length})
					</p>
					<p className="mt-0.5 text-xs text-muted-foreground">
						Real HitPay money that settled nothing — a double payment or a
						mismatched amount. Each needs a decision (refund it, or apply it
						by settling a bill), then Mark resolved.
					</p>
				</div>
			</div>
			<ul className="flex flex-col gap-2">
				{issues.map((row) => (
					<li
						key={`${row.invoiceId}:${row.paymentId}`}
						className="grid gap-3 rounded-xl border border-border bg-background p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
					>
						<div className="min-w-0 space-y-2">
							<div className="flex flex-wrap items-center gap-2">
								<p className="min-w-0 truncate text-sm font-semibold">
									{row.storeName}
								</p>
								{row.slug ? (
									<span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
										/{row.slug}
									</span>
								) : null}
								<span className="font-mono text-xs text-muted-foreground">
									{row.invoiceNumber}
								</span>
								<span
									className={`rounded-full px-2 py-0.5 text-[11px] font-medium uppercase ${STATUS_PILL[row.invoiceStatus]}`}
								>
									{row.invoiceStatus}
								</span>
							</div>
							<p className="text-xs font-medium text-red-600 dark:text-red-400">
								{row.amountSen !== undefined
									? `${formatPrice(row.amountSen, row.currency)} received ${formatShortDate(row.at)}`
									: `Payment received ${formatShortDate(row.at)}`}
								{" · invoice total "}
								{formatPrice(row.invoiceTotal, row.currency)}
							</p>
							<p className="text-xs text-muted-foreground">{issueCopy(row)}</p>
							<div className="flex items-center gap-1">
								<span className="shrink-0 text-xs text-muted-foreground">
									HitPay ref
								</span>
								<code
									title={row.paymentId}
									className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground"
								>
									{row.paymentId}
								</code>
								<CopyButton
									value={row.paymentId}
									ariaLabel="Copy the HitPay reference"
									successMessage="HitPay reference copied"
									labelClassName="hidden sm:inline"
								/>
							</div>
						</div>
						<div className="flex items-center justify-end">
							<button
								type="button"
								onClick={() => setResolving(row)}
								className="inline-flex h-11 items-center rounded-lg border border-border px-3.5 text-sm font-medium transition-colors hover:bg-muted"
							>
								Mark resolved
							</button>
						</div>
					</li>
				))}
			</ul>
			<ConfirmDialog
				open={resolving !== null}
				onOpenChange={(open) => {
					if (!open) setResolving(null);
				}}
				title="Mark this payment as resolved?"
				description={
					resolving
						? `${resolving.storeName} · ${resolving.invoiceNumber} · ref ${resolving.paymentId}. Resolving only clears it from this queue — it does not move any money, so refund or apply the payment first.`
						: undefined
				}
				confirmLabel="Mark resolved"
				reason={{
					label: "What was done with the money",
					placeholder: "e.g. refunded in HitPay / applied to INV-…",
					helper: "Kept on the invoice's audit trail with your name.",
				}}
				onConfirm={async (note) => {
					if (!resolving) return;
					if (await onResolve(resolving.invoiceId, note)) {
						setResolving(null);
					}
				}}
			/>
		</section>
	);
}
