import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
	Award,
	Banknote,
	CreditCard,
	ExternalLink,
	Eye,
	LifeBuoy,
	Loader2,
	Mail,
	MessageCircle,
	QrCode,
	ShieldCheck,
} from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import {
	FOUNDING_BENEFIT_WARNING_MS,
	FOUNDING_PLAN,
	foundingPlanLocked,
	isUnlimited,
} from "../../../convex/lib/plans";
import { HOLD_LABEL } from "../../../convex/lib/seasonalHold";
import { useResetOnBfcache } from "../../hooks/useResetOnBfcache";
import { useSupportWaNumber } from "../../hooks/useSupportWaNumber";
import { resolveAnnualOffer } from "../../lib/annual-billing";
import { buildWaContactLink } from "../../lib/contact";
import {
	type CardTarget,
	type FixHighlight,
	highlightRingClass,
} from "../../lib/country-setup-copy";
import { formatPrice, formatShortDate } from "../../lib/format";
import { LEGAL_CONTACT_EMAIL } from "../../lib/legal";
import { SPOTLIGHT_ANCHOR } from "../../lib/spotlight";
import {
	freePeriodState,
	isRenewing,
	ORDER_CAP_WARN_RATIO,
	PLAN_LABEL,
} from "../../lib/subscription";
import { ZoomableImage } from "../ui/zoomable-image";
import { AnnualBillingCard } from "./annual-billing-card";
import { AutoRenewalCard } from "./auto-renewal-card";
import { FirstInvoiceSwitch } from "./first-invoice-switch";
import { InvoiceDownloadButton } from "./invoice-download-button";
import { PlanChangeCard } from "./plan-change-card";
import { OwnerOnlyNote } from "./owner-only-note";
import { PlanPickerCard } from "./plan-picker-card";
import { SeasonalHoldCard } from "./seasonal-hold-card";

type Retailer = NonNullable<
	FunctionReturnType<typeof api.retailers.getMyRetailer>
>;

/** Retailer-facing billing dashboard (Settings → Billing). Current plan + status,
 * the pending invoice + how to pay (Pay-now link, then Kedaipal's
 * bank/DuitNow/QR), the annual offer, the auto-renewal card, the self-serve
 * plan picker, Founding ribbon, and invoice history. See
 * docs/manual-subscription.md + docs/hitpay-recurring.md. */
export function BillingTab({
	retailer,
	target,
	billingReturn,
	onBillingReturnHandled,
}: {
	retailer: Retailer;
	/** Deep-link target — which card to ring, and how (see FulfilmentTab). */
	target?: CardTarget;
	/** From the URL: back from HitPay's auth page ("autorenew") or its invoice
	 * checkout ("paid"). Undefined on a plain visit. */
	billingReturn?: "autorenew" | "paid";
	onBillingReturnHandled?: () => void;
}) {
	const sub = retailer.subscription;
	const ring = (anchor: string): FixHighlight | undefined =>
		target?.anchor === anchor ? target.highlight : undefined;
	const isAdmin = useQuery(convexQuery(api.billing.amIAdmin, {})).data ?? false;
	// Admin act-as (z8r3fdfty4): every store-scoped billing READ names the
	// seller's store. Omitted, the server answers for the CALLER — inside
	// act-as that is the admin's OWN store, which priced a founding seller's
	// plan at the admin's list rate and listed the admin's invoices under it.
	const actingAsAdmin = retailer.actingAsAdmin === true;
	const storeArgs = { retailerId: actingAsAdmin ? retailer._id : undefined };
	const invoices =
		useQuery(convexQuery(api.invoices.myInvoices, storeArgs)).data ?? [];
	const instructions = useQuery(
		convexQuery(api.billing.paymentInstructions, {}),
	).data;
	const gateway = useQuery(
		convexQuery(api.subscriptionPayments.billingGatewayAvailable, storeArgs),
	).data;
	// …while billing itself is VIEW-ONLY under act-as (Zaki, 17 Sep 2026): it is
	// the seller's money and consent, and every legitimate admin billing action
	// (issue, void, mark paid, comp) already lives in Admin → Billing. Every
	// control stays visible but disabled with the reason; the self-serve
	// writes resolve the caller's own store and `setSeasonalHold` refuses
	// act-as server-side, so nothing here can reach the seller's billing.
	const ownerOnly = actingAsAdmin;
	// On founding pricing — SERVER-resolved, the only founding answer any price
	// on this page may use (z8r3fdfty4). False until the gateway read lands, so
	// every card that quotes a founding-sensitive price waits for it instead of
	// flashing list.
	const foundingPricing = gateway?.foundingPricing === true;
	const supportWa = useSupportWaNumber();

	// Back from the invoice's HitPay checkout: reconcile against HitPay's
	// status API instead of trusting the redirect (lost-webhook safety net —
	// the settle is idempotent, so racing the webhook is harmless).
	const verifyPayment = useAction(
		api.subscriptionPayments.verifyInvoicePayment,
	);
	const verifiedReturn = useRef(false);
	// True from "Subscribe" click until the HitPay redirect actually navigates
	// — the pending-invoice card holds a spinner instead of flashing the manual
	// rails, and the auto-renewal card stays hidden. Cleared by the picker on a
	// failed redirect (the page navigates away on success).
	const [redirecting, setRedirecting] = useState(false);
	// The mirror-image window on the way BACK: landing from HitPay, the charge
	// (auto-renew attach) or webhook (Pay-now) settles a beat later than the
	// page loads — quick hands could pay the still-pending invoice again. Hold
	// the pay rails on a spinner until the invoice flips (the card unmounts) or
	// a 15s cap passes, so a DECLINED charge re-exposes the payment options
	// instead of hiding them forever. Cleared early when the attach reconcile
	// reports the seller abandoned setup.
	const [confirmingReturn, setConfirmingReturn] = useState(
		billingReturn !== undefined,
	);
	useEffect(() => {
		if (!confirmingReturn) return;
		const timer = setTimeout(() => setConfirmingReturn(false), 15_000);
		return () => clearTimeout(timer);
	}, [confirmingReturn]);
	// Back from HitPay restores this page with `redirecting` still latched —
	// every way to pay would stay hidden behind a spinner. See the hook.
	useResetOnBfcache(
		useCallback(() => {
			setRedirecting(false);
			setConfirmingReturn(false);
		}, []),
	);
	useEffect(() => {
		if (billingReturn !== "paid" || verifiedReturn.current) return;
		verifiedReturn.current = true;
		void (async () => {
			try {
				const result = await verifyPayment({});
				if (result.settled) {
					toast.success("Payment received — your plan is active", {
						description: "A receipt is on its way to your inbox.",
					});
				} else {
					// The server already answered: nothing settled (abandoned
					// checkout, or a decline). Hand the pay options straight back
					// instead of making them wait out the cap — the timer is the
					// fallback for "no answer", not for "answered no".
					setConfirmingReturn(false);
				}
			} catch {
				// The webhook usually settles it anyway; the invoice list is reactive.
			} finally {
				onBillingReturnHandled?.();
			}
		})();
	}, [billingReturn, verifyPayment, onBillingReturnHandled]);

	// A Kedaipal admin on their OWN store runs the app for free and is never on a
	// tier — no trial, plan, cap or invoice applies. Mirror the shell chrome (which
	// swaps the trial/past-due nag for an "Admin" badge and hides the subscription
	// banner) by replacing the plan/usage/renew UI here with a plain admin note.
	// While acting-as a seller we keep the seller's real plan fully visible —
	// white-glove support needs to SEE it — view-only, never actionable
	// (billing is the seller's money; see `ownerOnly`). See docs/admin-console.md.
	const adminOwnAccount = isAdmin && !retailer.actingAsAdmin;

	const pending = invoices.find((i) => i.status === "pending");
	const history = invoices.filter((i) => i.status !== "pending");
	const now = Date.now();

	// Annual billing is offered here rather than on /pricing: manual billing has
	// no self-serve checkout, so a public annual price would be a dead-end CTA,
	// while a year paid by one transfer is exactly what these rails already do
	// well. See src/lib/annual-billing.ts + docs/pricing.md. Held back until the
	// gateway read lands — its quote is founding-sensitive.
	const annualOffer = gateway
		? resolveAnnualOffer({
				subscription: sub,
				invoices,
				now,
				founding: foundingPricing,
				adminOwnAccount,
			})
		: ({ kind: "hidden" } as const);
	// Founding Members stay on Founding Pro — named as such wherever the plan is.
	const planLabel =
		foundingPricing && (sub?.plan ?? "pro") === FOUNDING_PLAN
			? "Founding Pro"
			: PLAN_LABEL[sub?.plan ?? "pro"];

	const freePeriod = freePeriodState(sub, now);
	const held = sub?.status === "on_hold" || sub?.held === true;
	const statusLine = (() => {
		if (!sub) return "Active";
		if (sub.status === "trialing") {
			// Start-when-you-sell: free until the first order or day 15; then
			// the first invoice (pending card below) is the clock.
			if (freePeriod.kind === "ended")
				return "Free period over · first invoice due";
			if (freePeriod.kind === "free")
				return freePeriod.daysLeft <= 5
					? `Free · ${freePeriod.daysLeft} day${freePeriod.daysLeft === 1 ? "" : "s"} left`
					: "Free · until your first order";
		}
		if (sub.status === "on_hold")
			return `On hold${sub.heldAt ? ` · since ${formatShortDate(sub.heldAt)}` : ""}`;
		if (sub.status === "past_due") return "Past due";
		if (sub.status === "cancelled") return "Cancelled";
		// The lapsed-but-not-yet-renewed window: access is still on, so the tier
		// is still "Active", but quoting the expiry would name a date that has
		// already gone by.
		if (isRenewing(sub, now)) return "Active · renewing";
		if (sub.currentPeriodEnd)
			return `Active · expires ${formatShortDate(sub.currentPeriodEnd)}`;
		return "Active";
	})();

	const hasPayDetails =
		instructions &&
		(instructions.bankAccountNumber ||
			instructions.duitnowId ||
			instructions.qrUrl);

	// Monthly order meter vs the plan's SOFT cap (hidden for comped accounts and
	// unlimited caps). `ordersThisMonth` rides on the retailer payload.
	const orderCap = sub?.caps?.orderCap;
	const capMeter =
		!sub?.comped &&
		orderCap !== undefined &&
		orderCap > 0 &&
		!isUnlimited(orderCap) &&
		retailer.ordersThisMonth !== undefined
			? {
					used: retailer.ordersThisMonth,
					cap: orderCap,
					near:
						retailer.ordersThisMonth >=
						Math.ceil(orderCap * ORDER_CAP_WARN_RATIO),
					over: retailer.ordersThisMonth >= orderCap,
				}
			: null;

	return (
		<div className="flex flex-col gap-6 pt-2">
			{/* Said once, first, so every disabled control below has its why. */}
			{actingAsAdmin ? (
				<section className="flex items-start gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-5 dark:border-indigo-900 dark:bg-indigo-950/40 lg:p-6">
					<Eye className="mt-0.5 size-5 shrink-0 text-indigo-600 dark:text-indigo-300" />
					<div>
						<p className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
							View-only billing
						</p>
						<p className="mt-1 text-xs text-indigo-800/80 dark:text-indigo-300/80">
							You're acting as {retailer.storeName}. Their plan, prices and
							invoices show exactly as they see them, but billing is the owner's
							— nothing here can be changed from act-as. To issue, void or mark
							an invoice paid, use Admin → Billing.
						</p>
					</div>
				</section>
			) : null}
			{retailer.isFoundingMember ? (
				<FoundingRibbon
					rank={retailer.foundingMemberRank}
					// undefined = the server hasn't answered yet, which is NOT the same
					// as "nothing is wrong" — see the ribbon's `pending` branch.
					pending={gateway === undefined}
					revoked={gateway?.foundingBenefitsRevoked === true}
					lapsed={gateway?.foundingPricingLapsed === true}
					endsAt={gateway?.foundingBenefitsEndAt}
				/>
			) : null}

			{/* Admins aren't on a plan — show a plain account note instead of the
			    tier/status/usage/renew apparatus. */}
			{adminOwnAccount ? (
				<section className="flex items-start gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-5 dark:border-indigo-900 dark:bg-indigo-950/40 lg:p-6">
					<ShieldCheck className="mt-0.5 size-5 shrink-0 text-indigo-600 dark:text-indigo-300" />
					<div>
						<p className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
							Admin account
						</p>
						<p className="mt-1 text-xs text-indigo-800/80 dark:text-indigo-300/80">
							Kedaipal admins aren't on a subscription plan — no trial, tier or
							invoices to settle. Your store runs free. Seller billing lives in
							the Admin console.
						</p>
					</div>
				</section>
			) : (
				/* Current plan */
				<section className="flex flex-col gap-3 rounded-2xl border border-input bg-background p-5 lg:p-6">
					<div className="flex items-center justify-between gap-3">
						<div>
							<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
								Current plan
							</p>
							<p className="mt-1 text-lg font-semibold">{planLabel}</p>
						</div>
						<span
							className={`rounded-full px-2.5 py-1 text-xs font-medium ${
								sub?.status === "past_due"
									? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
									: sub?.status === "trialing"
										? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
										: held
											? "border border-accent/20 bg-accent/10 text-accent"
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
					{held ? (
						<p className="text-xs text-muted-foreground">
							{HOLD_LABEL} — ordering is paused. Your {planLabel} plan comes
							back with one tap below.
						</p>
					) : null}
					{freePeriod.kind === "free" ? (
						<p className="text-xs text-muted-foreground">
							You're free until your first live order, or day 15 — whichever
							comes first. Your first invoice arrives then, with 14 days to pay;
							your storefront stays live throughout.
						</p>
					) : null}

					{/* Monthly order usage vs the plan's SOFT cap. The cap never blocks
				    orders — passing it just escalates the upgrade nudge. */}
					{capMeter ? (
						<div className="flex flex-col gap-1.5 border-t border-border pt-4">
							<div className="flex items-baseline justify-between text-xs">
								<span className="font-semibold uppercase tracking-wide text-muted-foreground">
									Orders this month
								</span>
								<span
									className={`font-medium tabular-nums ${
										capMeter.over
											? "text-red-600 dark:text-red-400"
											: capMeter.near
												? "text-amber-700 dark:text-amber-400"
												: "text-muted-foreground"
									}`}
								>
									{capMeter.used} / {capMeter.cap}
								</span>
							</div>
							<div className="h-1.5 overflow-hidden rounded-full bg-muted">
								<div
									className={`h-full rounded-full transition-all ${
										capMeter.over
											? "bg-red-500"
											: capMeter.near
												? "bg-amber-500"
												: "bg-accent"
									}`}
									style={{
										width: `${Math.min(100, Math.round((capMeter.used / capMeter.cap) * 100))}%`,
									}}
								/>
							</div>
							<p className="text-[11px] text-muted-foreground">
								{capMeter.over
									? "You're past your plan's included orders — everything keeps working, but this is the sign to upgrade."
									: "Included orders on your plan. Going over never blocks an order."}
							</p>
						</div>
					) : null}

					{/* Starter never sees the annual card (ANNUAL_OFFER_PLANS is Pro
					    only), so the constraint is explained here rather than left as
					    an unexplained absence — "why can't I?" is exactly the question
					    a silent gap produces. The upgrade ACTION itself now lives in
					    the plan-change card below (it used to hand off to Arif on
					    WhatsApp; tier changes are self-serve since 86eyb6z4r). */}
					{sub?.plan === "starter" && sub.status === "active" ? (
						<p className="border-t border-border pt-4 text-xs text-muted-foreground">
							Want 200 orders/month, the customer database and the order inbox?
							Move up to Pro below — which can also be billed annually, with two
							months free. We don't offer annual on Starter: you shouldn't pay a
							year upfront before the shop has proven itself.
						</p>
					) : null}
				</section>
			)}

			{/* Change tier (86eyb6z4r) — a plan decision, so it sits directly under
			    the current-plan card and above the payment mechanics. Only an ACTIVE
			    paid subscription can be "changed"; everyone else is CHOOSING a plan,
			    which is the picker's job further down. A PAUSED seller sees the
			    resume switch below instead — you change tier on a running plan,
			    not on a hold. */}
			{!adminOwnAccount &&
			!sub?.comped &&
			sub &&
			sub.status === "active" &&
			gateway?.payNow ? (
				<PlanChangeCard
					id={SPOTLIGHT_ANCHOR.plan_change.anchor}
					highlight={ring(SPOTLIGHT_ANCHOR.plan_change.anchor)}
					sub={sub}
					currency={gateway.renewalCurrency}
					foundingPricing={gateway.foundingPricing}
					ownerOnly={ownerOnly}
					openInvoiceNumber={pending?.invoiceNumber}
				/>
			) : null}

			{/* Off-Season Hold (z8r3fday24) — pausing the whole subscription, a
			    different decision from changing tier, so it sits under it: the
			    common move first, the seasonal one after. Every real paid seller
			    sees it (discoverable where billing lives); the card itself decides
			    which of its four states to render. */}
			{!adminOwnAccount && sub && !sub.comped ? (
				<SeasonalHoldCard
					id={SPOTLIGHT_ANCHOR.seasonal_hold.anchor}
					highlight={ring(SPOTLIGHT_ANCHOR.seasonal_hold.anchor)}
					retailerId={retailer._id}
					country={retailer.country}
					sub={sub}
					pendingKind={pending ? (pending.kind ?? "plan") : undefined}
					ownerOnly={ownerOnly}
				/>
			) : null}

			{/* Annual billing — a plan decision, so it sits with the plan and above
			    the payment mechanics. Renders nothing for a seller it doesn't
			    apply to (see resolveAnnualOffer). */}
			<AnnualBillingCard
				id={SPOTLIGHT_ANCHOR.annual_billing.anchor}
				highlight={ring(SPOTLIGHT_ANCHOR.annual_billing.anchor)}
				state={annualOffer}
				slug={retailer.slug}
				supportWa={supportWa}
				founding={foundingPricing}
				ownerOnly={ownerOnly}
			/>

			{/* Pending invoice + how to pay */}
			{pending ? (
				<section className="flex flex-col gap-4 rounded-2xl border border-input bg-background p-5 lg:p-6">
					<div className="flex items-baseline justify-between gap-3">
						<div>
							<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
								{pending.kind === "hold"
									? `Amount due · ${HOLD_LABEL}`
									: pending.origin === "free_period_end"
										? "Your first invoice"
										: "Amount due"}
							</p>
							<p className="mt-1 text-2xl font-bold tabular-nums">
								{formatPrice(pending.total, pending.currency)}
							</p>
						</div>
						<div className="text-right">
							<p className="text-xs text-muted-foreground">Invoice</p>
							<p className="font-mono text-sm">{pending.invoiceNumber}</p>
							<p className="mt-1 text-xs text-muted-foreground">
								Due {formatShortDate(pending.dueDate)}
							</p>
							<InvoiceDownloadButton
								invoiceId={pending._id}
								label="Download PDF"
								className="mt-2"
							/>
						</div>
					</div>
					{pending.foundingDiscount ? (
						<p className="text-xs text-emerald-700 dark:text-emerald-400">
							Includes your Founding Member discount of{" "}
							{formatPrice(pending.foundingDiscount, pending.currency)}.
						</p>
					) : null}
					{pending.kind === "hold" ? (
						<p className="text-xs text-muted-foreground">
							One month of {HOLD_LABEL} — ordering stays paused, everything else
							stays live. Resume your plan from the card above whenever your
							season is back.
						</p>
					) : null}
					{/* Switch tier before paying (z8r3fday24): machine-issued plan
					    invoices only — the first invoice, or a self-serve pick. The
					    server refuses admin-issued and hold invoices too, and a
					    Founding Member's move off Founding Pro (they have no other
					    tier). Waits for the gateway read: the quoted price is
					    founding-sensitive. */}
					{gateway &&
					(pending.kind ?? "plan") === "plan" &&
					(pending.origin === "free_period_end" ||
						pending.origin === "self_serve") &&
					(pending.plan === "pro" || pending.plan === "starter") &&
					!foundingPlanLocked(
						pending.plan === "pro" ? "starter" : "pro",
						foundingPricing,
					) ? (
						<FirstInvoiceSwitch
							invoicePlan={pending.plan}
							currency={pending.currency === "SGD" ? "SGD" : "MYR"}
							founding={foundingPricing}
							ownerOnly={ownerOnly}
						/>
					) : null}

					<div className="border-t border-border pt-4">
						{/* Mid-subscribe (the picker just created this invoice and the
						    HitPay redirect is loading): a beat where the fallback rails
						    would flash and invite a manual payment before the seller
						    even SEES the HitPay page. Hold the section on a spinner —
						    if the redirect fails, the toast fires and this unwinds to
						    the normal payment options. */}
						{redirecting || confirmingReturn ? (
							<div className="flex items-center gap-2.5 py-2 text-sm text-muted-foreground">
								<Loader2 className="size-4 animate-spin" />
								{redirecting
									? "Taking you to HitPay's secure payment page…"
									: "Confirming your payment…"}
							</div>
						) : (
							<>
								<p className="text-sm font-medium">How to pay</p>
								{/* Online first (86eyb6z4r): card/banking/eWallet on HitPay's
						    hosted page, auto-confirmed — the manual rails stay below. */}
								{pending.gatewayPayment?.url ? (
									<div className="mt-2">
										<ActionLink
											href={pending.gatewayPayment.url}
											disabled={ownerOnly}
											className="inline-flex h-11 w-fit items-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-700"
										>
											<CreditCard className="size-4" />
											Pay online now
										</ActionLink>
										<p className="mt-1.5 text-xs text-muted-foreground">
											Confirmed automatically — no need to message us after.
										</p>
									</div>
								) : null}
								{pending.currency !== "MYR" ? (
									// Cross-border invoice (e.g. SGD): the configured MY bank/DuitNow
									// rails can't settle it, so never show them here — mirrors the
									// invoice PDF and email.
									<p className="mt-2 text-sm text-muted-foreground">
										We'll confirm payment details with you on WhatsApp — quote{" "}
										<span className="font-mono">{pending.invoiceNumber}</span>{" "}
										as your payment reference.
									</p>
								) : hasPayDetails ? (
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
								<ActionLink
									href={buildWaContactLink(
										`Hi, I've paid invoice ${pending.invoiceNumber} for my Kedaipal store (/${retailer.slug}).`,
										supportWa,
									)}
									external
									disabled={ownerOnly}
									className="mt-4 inline-flex h-10 w-fit items-center gap-1.5 rounded-lg bg-foreground px-4 text-sm font-medium text-background"
								>
									<ExternalLink className="size-4" />
									I've paid — notify us
								</ActionLink>
								{ownerOnly ? (
									<div className="mt-2">
										<OwnerOnlyNote />
									</div>
								) : null}
							</>
						)}
					</div>
				</section>
			) : null}

			{/* No invoice yet, but they need to act. With the payment gateway
			    configured this is the SELF-SERVE plan picker (86eyb6z4r) — pick a
			    plan, get an invoice with a Pay-now button, done. Without it, the
			    manual "message us" flow renders exactly as before. */}
			{!adminOwnAccount &&
			!pending &&
			!sub?.comped &&
			(sub?.status === "trialing" ||
				sub?.status === "past_due" ||
				sub?.status === "cancelled") ? (
				gateway?.payNow ? (
					<div className="flex flex-col gap-2">
						{freePeriod.kind === "free" ? (
							<p className="px-1 text-xs text-muted-foreground">
								No rush — your first invoice arrives with your first live order,
								or on day 15. Pick a plan now only if you'd rather start today.
							</p>
						) : null}
						<PlanPickerCard
							sub={sub}
							currency={gateway.currency}
							renewing={sub.status !== "trialing"}
							foundingPricing={gateway.foundingPricing}
							foundingPricingLapsed={gateway.foundingPricingLapsed}
							foundingBenefitsRevoked={gateway.foundingBenefitsRevoked}
							ownerOnly={ownerOnly}
							onRedirectingChange={setRedirecting}
						/>
					</div>
				) : (
					<section className="flex flex-col gap-3 rounded-2xl border border-input bg-background p-5 lg:p-6">
						<div>
							<p className="text-sm font-medium">
								{sub.status === "trialing"
									? "Want to start your plan now?"
									: "Renew your subscription"}
							</p>
							<p className="mt-1 text-xs text-muted-foreground">
								{freePeriod.kind === "free"
									? "No rush — your first invoice arrives with your first live order, or on day 15. To start today instead, message us on WhatsApp and we'll send your invoice."
									: "Message us on WhatsApp and we'll send your invoice. Your plan activates once payment lands."}
							</p>
						</div>
						<ActionLink
							href={buildWaContactLink(
								sub.status === "trialing"
									? `Hi, I'd like to choose a plan for my Kedaipal store (/${retailer.slug}).`
									: `Hi, I'd like to renew my Kedaipal subscription for my store (/${retailer.slug}).`,
								supportWa,
							)}
							external
							disabled={ownerOnly}
							className="inline-flex h-10 w-fit items-center gap-1.5 rounded-lg bg-foreground px-4 text-sm font-medium text-background"
						>
							<ExternalLink className="size-4" />
							Message us
						</ActionLink>
						{ownerOnly ? <OwnerOnlyNote /> : null}
					</section>
				)
			) : null}

			{/* Auto-renewal (86eyb6z4r) — a MANAGEMENT surface, not an enrolment
			    one (Zaki, 11 Sep): new subscribers are enrolled by the plan
			    picker's subscribe flow itself, so pre-subscription this card
			    would just be a second, confusing door. It renders only when
			    there's something to manage: a method attached (incl. failing),
			    a half-finished setup to resume, or an ACTIVE seller who came in
			    on the manual rail and can opt in. */}
			{!adminOwnAccount &&
			!redirecting &&
			!sub?.comped &&
			sub &&
			gateway?.autoRenew &&
			(sub.autoRenew !== undefined ||
				sub.autoRenewSetupPending === true ||
				sub.status === "active" ||
				// A seller holding an open bill — past_due mid-dunning, or a
				// trial whose subscribe redirect failed — has no plan picker
				// (it hides behind `!pending`) and would otherwise have NO way
				// to reach auto-renewal at all. Theirs is exactly the store
				// applyMethodAttached's heal path exists for.
				pending !== undefined) ? (
				<AutoRenewalCard
					id={SPOTLIGHT_ANCHOR.auto_renewal.anchor}
					highlight={ring(SPOTLIGHT_ANCHOR.auto_renewal.anchor)}
					sub={sub}
					methods={gateway.methods}
					renewal={gateway.nextRenewal}
					pendingCharge={
						pending
							? { amount: pending.total, currency: pending.currency }
							: undefined
					}
					founding={gateway.foundingPricing}
					ownerOnly={ownerOnly}
					returnFromSetup={billingReturn === "autorenew"}
					onReturnHandled={(attached) => {
						// Setup abandoned → nothing will charge; re-expose the pay
						// options right away instead of riding out the 15s cap.
						if (attached === false) setConfirmingReturn(false);
						onBillingReturnHandled?.();
					}}
				/>
			) : null}

			{/* History */}
			{history.length > 0 ? (
				<section
					id={SPOTLIGHT_ANCHOR.invoice_history.anchor}
					data-fix-highlight={
						ring(SPOTLIGHT_ANCHOR.invoice_history.anchor) ?? undefined
					}
					className={`flex flex-col gap-2 rounded-2xl border bg-background p-5 scroll-mt-24 lg:p-6 ${highlightRingClass(ring(SPOTLIGHT_ANCHOR.invoice_history.anchor))}`}
				>
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
											? formatShortDate(inv.markedPaidAt)
											: inv.voidedAt
												? formatShortDate(inv.voidedAt)
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
									{/* No documents for a voided (cancelled-in-error) invoice.
									    A PAID invoice carries two: the bill (kept for the
									    seller's records) and the payment receipt — proof of
									    payment for their books (z8r3fdcrzj). */}
									{inv.status !== "void" ? (
										<InvoiceDownloadButton
											invoiceId={inv._id}
											label=""
											size="icon"
											variant="ghost"
											className="size-8"
										/>
									) : null}
									{inv.status === "paid" ? (
										<InvoiceDownloadButton
											invoiceId={inv._id}
											kind="receipt"
											label=""
											size="icon"
											variant="ghost"
											className="size-8"
										/>
									) : null}
								</div>
							</li>
						))}
					</ul>
				</section>
			) : null}

			{/* Always-on billing support — shown to every retailer regardless of plan,
			    tier, or subscription status, so they can always reach us about
			    anything billing-related. */}
			<section className="flex flex-col gap-3 rounded-2xl border border-input bg-background p-5 lg:p-6">
				<div className="flex items-start gap-3">
					<LifeBuoy className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
					<div>
						<p className="text-sm font-medium">Questions about billing?</p>
						<p className="mt-1 text-xs text-muted-foreground">
							We're here to help with invoices, plans, payments, or anything
							else on your account.
						</p>
					</div>
				</div>
				<div className="flex flex-col gap-2 sm:flex-row">
					<a
						href={buildWaContactLink(
							`Hi, I have a billing question about my Kedaipal store (/${retailer.slug}).`,
							supportWa,
						)}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex h-11 w-fit items-center gap-1.5 rounded-lg bg-foreground px-4 text-sm font-medium text-background"
					>
						<MessageCircle className="size-4" />
						Contact support on WhatsApp
					</a>
					<a
						href={`mailto:${LEGAL_CONTACT_EMAIL}?subject=${encodeURIComponent(
							`Billing question — /${retailer.slug}`,
						)}`}
						className="inline-flex h-11 w-fit items-center gap-1.5 rounded-lg border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
					>
						<Mail className="size-4" />
						Email us
					</a>
				</div>
			</section>
		</div>
	);
}

/**
 * A billing CTA that leaves the page — HitPay's checkout, or a WhatsApp
 * message to us about the seller's bill. Billing is view-only under admin
 * act-as, so there it renders as the same control, disabled: never a live
 * link that pays or claims a payment on the seller's behalf.
 */
/**
 * The founding ribbon — ONE control, three tones, because all three say the
 * same thing (where this member's founding price stands) and a second stacked
 * box about the same subject is noise, not emphasis:
 *
 *  - **amber, "locked in"** — benefits live, nothing due;
 *  - **red, "ends on {date}"** — inside the last 14 days (z8r3fdfyw5). This is
 *    the T-14 warning: the price is about to be taken, so the tone escalates
 *    and the copy carries the DATE and the fact that renewing later won't undo
 *    it. The renew affordance is the picker/Pay-now immediately below — one
 *    renew button on the page, not two;
 *  - **muted, "has ended"** — revoked for good. Never says "renew to keep your
 *    founding price": paying no longer brings it back, and the lapsed-but-not-
 *    yet-revoked wording would be a promise the server won't honour.
 *
 * Every tone repeats that the RANK AND BADGE ARE KEPT. That is the standing
 * promise (agreement 86exq9kz9 + this ribbon's own copy since 3 Sep), and the
 * one sentence a member losing their discount most needs to still be true.
 * `revoked`, `lapsed` and `endsAt` are all SERVER-resolved
 * (`billingGatewayAvailable`) — deriving founding state client-side is the bug
 * z8r3fdfty4 closed.
 *
 * **The fourth state is `pending`, and it exists because its absence was a lie.**
 * The retailer doc resolves before the gateway query, so while the latter is
 * `undefined` all three flags read `false` and this fell through to the amber
 * "your 30% discount is locked in" — told to a member whose discount had ENDED,
 * on every single page load (measured at ~310ms on localhost, and a seller on
 * mobile data reads for longer than that). The rank is known from the retailer
 * doc and is true in every state, so the title still renders; only the CLAIM
 * waits for the server, behind a skeleton line that holds the same height and
 * keeps the ribbon from jumping.
 */
function FoundingRibbon({
	rank,
	pending,
	revoked,
	lapsed,
	endsAt,
}: {
	rank?: number;
	pending: boolean;
	revoked: boolean;
	lapsed: boolean;
	endsAt?: number;
}) {
	const endingSoon =
		!pending &&
		!revoked &&
		endsAt !== undefined &&
		endsAt - Date.now() <= FOUNDING_BENEFIT_WARNING_MS;
	const muted = pending || revoked;
	const tone = muted
		? "border-border bg-muted/50"
		: endingSoon
			? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
			: "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40";
	const iconTone = muted
		? "text-muted-foreground"
		: endingSoon
			? "text-red-600 dark:text-red-400"
			: "text-amber-600";
	const titleTone = muted
		? "text-foreground"
		: endingSoon
			? "text-red-900 dark:text-red-200"
			: "text-amber-900 dark:text-amber-200";
	const bodyTone = revoked
		? "text-muted-foreground"
		: endingSoon
			? "text-red-800/90 dark:text-red-300/90"
			: "text-amber-800/80 dark:text-amber-300/80";

	return (
		<div
			className={`flex items-start gap-3 rounded-2xl border p-4 ${tone}`}
			role={endingSoon ? "alert" : undefined}
		>
			<Award className={`mt-0.5 size-6 shrink-0 ${iconTone}`} />
			<div className="min-w-0">
				<p className={`text-sm font-semibold ${titleTone}`}>
					Founding Member #{rank} of 10
					{pending
						? null
						: endingSoon && endsAt !== undefined
							? ` · founding price ends ${formatShortDate(endsAt)}`
							: revoked
								? " · founding price ended"
								: null}
				</p>
				{pending ? (
					<div
						className="mt-1.5 h-3 w-48 max-w-full animate-pulse rounded bg-muted-foreground/20"
						aria-hidden="true"
					/>
				) : (
					<p className={`mt-0.5 text-xs ${bodyTone}`}>
						{revoked ? (
							<>
								Your subscription stayed unrenewed past the 3-month window, so
								your founding price has ended and every plan is open to you
								again at the standard prices.{" "}
								<strong className="font-semibold text-foreground">
									Your rank and badge stay yours, permanently
								</strong>{" "}
								— your storefront is unchanged. Think this is wrong? Message us.
							</>
						) : endingSoon && endsAt !== undefined ? (
							<>
								Your subscription hasn't renewed, so your 30% founding price
								ends on{" "}
								<strong className="font-semibold">
									{formatShortDate(endsAt)}
								</strong>
								. Renew below before then and you keep it — after that date your
								plan bills at the standard price, and renewing later won't bring
								the discount back. Your rank and badge are yours for good either
								way.
							</>
						) : lapsed ? (
							"Your rank and badge are yours for good. Your founding price lapsed after more than 3 months without an active subscription, so new bills are at the standard price."
						) : (
							"Your 30% discount is locked in — thank you for backing Kedaipal early. It stays yours as long as your subscription doesn't lapse for more than 3 months; your rank and badge are permanent either way."
						)}
					</p>
				)}
			</div>
		</div>
	);
}

function ActionLink({
	href,
	disabled,
	external = false,
	className,
	children,
}: {
	href: string;
	disabled: boolean;
	/** Opens in a new tab (WhatsApp); HitPay's checkout replaces this page. */
	external?: boolean;
	className: string;
	children: ReactNode;
}) {
	if (disabled)
		return (
			<button
				type="button"
				disabled
				className={`${className} disabled:cursor-not-allowed disabled:opacity-50`}
			>
				{children}
			</button>
		);
	return (
		<a
			href={href}
			className={className}
			{...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
		>
			{children}
		</a>
	);
}
