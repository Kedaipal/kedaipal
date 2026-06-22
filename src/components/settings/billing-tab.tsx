import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Award, Banknote, ExternalLink, QrCode } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { formatPrice } from "../../lib/format";
import { trialDaysLeft } from "../../lib/subscription";
import { ZoomableImage } from "../ui/zoomable-image";

type Retailer = NonNullable<
	FunctionReturnType<typeof api.retailers.getMyRetailer>
>;

const PLAN_LABEL: Record<string, string> = {
	starter: "Starter",
	pro: "Pro",
	scale: "Scale",
};

function formatDate(ms: number): string {
	return new Date(ms).toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
}

/** Retailer-facing billing dashboard (Settings → Billing). Current plan + status,
 * the pending invoice + how to pay (Kedaipal's bank/DuitNow/QR), Founding ribbon,
 * and invoice history. See docs/manual-subscription.md. */
export function BillingTab({ retailer }: { retailer: Retailer }) {
	const sub = retailer.subscription;
	const invoices = useQuery(api.invoices.myInvoices, {}) ?? [];
	const instructions = useQuery(api.billing.paymentInstructions, {});

	const pending = invoices.find((i) => i.status === "pending");
	const history = invoices.filter((i) => i.status !== "pending");
	const now = Date.now();

	const statusLine = (() => {
		if (!sub) return "Active";
		if (sub.status === "trialing") {
			const d = trialDaysLeft(sub.trialEndsAt, now);
			return d > 0
				? `Trial · ${d} day${d === 1 ? "" : "s"} left`
				: "Trial ended";
		}
		if (sub.status === "past_due") return "Past due";
		if (sub.status === "cancelled") return "Cancelled";
		if (sub.currentPeriodEnd)
			return `Active · renews ${formatDate(sub.currentPeriodEnd)}`;
		return "Active";
	})();

	const hasPayDetails =
		instructions &&
		(instructions.bankAccountNumber ||
			instructions.duitnowId ||
			instructions.qrUrl);

	return (
		<div className="flex flex-col gap-6 pt-2">
			{retailer.isFoundingMember ? (
				<div className="flex items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
					<Award className="size-6 shrink-0 text-amber-600" />
					<div>
						<p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
							Founding Member #{retailer.foundingMemberRank} of 10
						</p>
						<p className="text-xs text-amber-800/80 dark:text-amber-300/80">
							Your 30% lifetime discount is locked in — thank you for backing
							Kedaipal early.
						</p>
					</div>
				</div>
			) : null}

			{/* Current plan */}
			<section className="flex flex-col gap-3 rounded-2xl border border-input bg-background p-5 lg:p-6">
				<div className="flex items-center justify-between gap-3">
					<div>
						<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Current plan
						</p>
						<p className="mt-1 text-lg font-semibold">
							{PLAN_LABEL[sub?.plan ?? "pro"]}
						</p>
					</div>
					<span
						className={`rounded-full px-2.5 py-1 text-xs font-medium ${
							sub?.status === "past_due"
								? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
								: sub?.status === "trialing"
									? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
									: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
						}`}
					>
						{statusLine}
					</span>
				</div>
				{sub?.comped ? (
					<p className="text-xs text-muted-foreground">
						Your account is on the house — no invoices to settle.
					</p>
				) : null}
			</section>

			{/* Pending invoice + how to pay */}
			{pending ? (
				<section className="flex flex-col gap-4 rounded-2xl border border-input bg-background p-5 lg:p-6">
					<div className="flex items-baseline justify-between gap-3">
						<div>
							<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
								Amount due
							</p>
							<p className="mt-1 text-2xl font-bold tabular-nums">
								{formatPrice(pending.total, pending.currency)}
							</p>
						</div>
						<div className="text-right">
							<p className="text-xs text-muted-foreground">Invoice</p>
							<p className="font-mono text-sm">{pending.invoiceNumber}</p>
							<p className="mt-1 text-xs text-muted-foreground">
								Due {formatDate(pending.dueDate)}
							</p>
						</div>
					</div>
					{pending.foundingDiscount ? (
						<p className="text-xs text-emerald-700 dark:text-emerald-400">
							Includes your Founding Member discount of{" "}
							{formatPrice(pending.foundingDiscount, pending.currency)}.
						</p>
					) : null}

					<div className="border-t border-border pt-4">
						<p className="text-sm font-medium">How to pay</p>
						{hasPayDetails ? (
							<div className="mt-2 flex flex-col gap-3">
								{instructions?.bankAccountNumber ? (
									<div className="flex items-start gap-2.5 text-sm">
										<Banknote className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
										<div>
											<p className="font-medium">
												{instructions.bankName ?? "Bank transfer"}
											</p>
											<p className="font-mono">
												{instructions.bankAccountNumber}
											</p>
											{instructions.bankAccountName ? (
												<p className="text-xs text-muted-foreground">
													{instructions.bankAccountName}
												</p>
											) : null}
										</div>
									</div>
								) : null}
								{instructions?.duitnowId ? (
									<div className="flex items-start gap-2.5 text-sm">
										<QrCode className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
										<div>
											<p className="font-medium">DuitNow</p>
											<p className="font-mono">{instructions.duitnowId}</p>
										</div>
									</div>
								) : null}
								{instructions?.qrUrl ? (
									<ZoomableImage
										src={instructions.qrUrl}
										alt="DuitNow QR"
										caption="Scan to pay (DuitNow)"
										wrapperClassName="w-40 overflow-hidden rounded-xl border border-border bg-white"
										className="block aspect-square w-full object-contain"
									/>
								) : null}
							</div>
						) : (
							<p className="mt-2 text-sm text-muted-foreground">
								Message us on WhatsApp to receive payment details.
							</p>
						)}
						{instructions?.whatsappPhone ? (
							<a
								href={`https://wa.me/${instructions.whatsappPhone.replace(/\D/g, "")}?text=${encodeURIComponent(
									`Hi, I've paid invoice ${pending.invoiceNumber} for my Kedaipal store (/${retailer.slug}).`,
								)}`}
								target="_blank"
								rel="noreferrer"
								className="mt-4 inline-flex h-10 w-fit items-center gap-1.5 rounded-lg bg-foreground px-4 text-sm font-medium text-background"
							>
								<ExternalLink className="size-4" />
								I've paid — notify us
							</a>
						) : null}
					</div>
				</section>
			) : null}

			{/* No invoice yet, but they need to act → reach Arif on WhatsApp. Manual
			    sub: Arif issues + activates once payment lands, so there's no
			    self-serve plan picker. */}
			{!pending &&
			!sub?.comped &&
			(sub?.status === "trialing" || sub?.status === "past_due") &&
			instructions?.whatsappPhone ? (
				<section className="flex flex-col gap-3 rounded-2xl border border-input bg-background p-5 lg:p-6">
					<div>
						<p className="text-sm font-medium">
							{sub.status === "past_due"
								? "Renew your subscription"
								: "Ready to choose a plan?"}
						</p>
						<p className="mt-1 text-xs text-muted-foreground">
							Message us on WhatsApp and we'll send your invoice. Your plan
							activates once payment lands.
						</p>
					</div>
					<a
						href={`https://wa.me/${instructions.whatsappPhone.replace(/\D/g, "")}?text=${encodeURIComponent(
							sub.status === "past_due"
								? `Hi, I'd like to renew my Kedaipal subscription for my store (/${retailer.slug}).`
								: `Hi, I'd like to choose a plan for my Kedaipal store (/${retailer.slug}).`,
						)}`}
						target="_blank"
						rel="noreferrer"
						className="inline-flex h-10 w-fit items-center gap-1.5 rounded-lg bg-foreground px-4 text-sm font-medium text-background"
					>
						<ExternalLink className="size-4" />
						Message us
					</a>
				</section>
			) : null}

			{/* History */}
			{history.length > 0 ? (
				<section className="flex flex-col gap-2 rounded-2xl border border-input bg-background p-5 lg:p-6">
					<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						Invoice history
					</p>
					<ul className="flex flex-col divide-y divide-border">
						{history.map((inv) => (
							<li
								key={inv._id}
								className="flex items-center justify-between gap-3 py-2.5 text-sm"
							>
								<div>
									<span className="font-mono">{inv.invoiceNumber}</span>
									<span className="ml-2 text-xs text-muted-foreground">
										{inv.markedPaidAt
											? formatDate(inv.markedPaidAt)
											: inv.voidedAt
												? formatDate(inv.voidedAt)
												: ""}
									</span>
								</div>
								<div className="flex items-center gap-3">
									<span
										className={`tabular-nums ${inv.status === "void" ? "text-muted-foreground line-through" : ""}`}
									>
										{formatPrice(inv.total, inv.currency)}
									</span>
									<span
										className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
											inv.status === "paid"
												? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
												: "bg-muted text-muted-foreground"
										}`}
									>
										{inv.status === "paid"
											? "Paid"
											: inv.status === "void"
												? "Cancelled"
												: inv.status}
									</span>
								</div>
							</li>
						))}
					</ul>
				</section>
			) : null}
		</div>
	);
}
