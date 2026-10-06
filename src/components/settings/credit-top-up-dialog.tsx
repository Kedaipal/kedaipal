import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
	Check,
	CheckCircle2,
	Clock,
	Eye,
	Info,
	Loader2,
	MessageCircle,
	TriangleAlert,
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
import type { Id } from "../../../convex/_generated/dataModel";
import { CREDIT_LOCK_ENABLED } from "../../../convex/lib/credits";
import { useStoreRole } from "../../hooks/usePermission";
import { useResetOnBfcache } from "../../hooks/useResetOnBfcache";
import { useSupportWaNumber } from "../../hooks/useSupportWaNumber";
import { buildWaContactLink } from "../../lib/contact";
import { afterTopUpLine, packOffers, wholePrice } from "../../lib/credit-packs";
import type { TopUpParam } from "../../lib/credit-top-up";
import {
	convexErrorMessage,
	formatPrice,
	formatShortDate,
} from "../../lib/format";
import { trackEvent } from "../../lib/ga-events";
import { leavePageTo } from "../../lib/leave-page";
import { TERMS_ANCHOR } from "../../lib/legal";
import { cn } from "../../lib/utils";
import { NeedsAccessNote } from "../app/owner-only-note";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";
import { Skeleton } from "../ui/skeleton";
import { CreditReceiptButton } from "./credit-receipt-button";

type TopUpOptions = NonNullable<
	FunctionReturnType<typeof api.creditPurchases.topUpOptions>
>;
type Balance = NonNullable<FunctionReturnType<typeof api.credits.getBalance>>;
type LatestPurchase = NonNullable<
	FunctionReturnType<typeof api.creditPurchases.latestPurchase>
>;
type Pack = TopUpOptions["packs"][number];

/** What the dialog shows: the pack picker, or the way back from HitPay. */
type View = "closed" | "picker" | "return";

/**
 * Settings → Billing → "Top up credits" (Credits T2, z8r3fdf8ht). A seller —
 * or a teammate holding credits WRITE — picks a pack, pays on HitPay's page
 * (Kedaipal's own account, never a saved card) and comes back here to see the
 * credits land. Opened by `?topup=1` (every "Top up" button links there) and
 * reopened by `?topup=return` from HitPay; see `src/lib/credit-top-up.ts`.
 *
 * Mounted by the settings route BESIDE the billing tab's AreaGate, not inside
 * it: a teammate can hold credits write without billing read, and the gate
 * would otherwise hide the only place they can buy.
 *
 * Every state is designed, never a dead end: loading, can't buy (the reason +
 * the way out), view-only (a teammate without the grant, an admin acting-as),
 * online top-ups unavailable, opening HitPay, and — on the way back —
 * confirming, paid, not received yet, expired and flagged. Order counts only:
 * never a money balance, a fee or a percentage.
 */
export function CreditTopUpDialog({
	retailer,
	request,
	onRequestHandled,
}: {
	retailer: { _id: Id<"retailers">; slug: string; actingAsAdmin?: boolean };
	/** `?topup=` from the URL — consumed once, then `onRequestHandled`
	 * strips it. */
	request: TopUpParam | undefined;
	onRequestHandled: () => void;
}) {
	const [view, setView] = useState<View>("closed");
	// A request opens the dialog ONCE; the param is stripped straight away, so
	// a refresh or a shared link never replays it — and the next "Top up" tap
	// is a real change of URL, which opens it again. (`onRequestHandled` is a
	// stable callback from the route; the early return makes a re-run a no-op.)
	useEffect(() => {
		if (!request) return;
		setView(request === "return" ? "return" : "picker");
		onRequestHandled();
	}, [request, onRequestHandled]);

	const open = view !== "closed";
	const actingAs = retailer.actingAsAdmin === true;
	// Act-as reads name the seller's store (the billing tab's posture);
	// omitted, the server answers for the store the caller operates.
	const storeArgs = { retailerId: actingAs ? retailer._id : undefined };
	const options = useQuery(
		convexQuery(api.creditPurchases.topUpOptions, open ? storeArgs : "skip"),
	).data;
	const balance = useQuery(
		convexQuery(api.credits.getBalance, open ? storeArgs : "skip"),
	).data;
	const latest = useQuery(
		convexQuery(
			api.creditPurchases.latestPurchase,
			view === "return" ? {} : "skip",
		),
	).data;

	// Back from HitPay: ask it whether the payment landed rather than trusting
	// the trip (the lost-webhook safety net). The purchase row is reactive, so
	// the dialog then simply shows whatever it becomes — no polling.
	const verify = useAction(api.creditPurchases.verifyCreditPurchase);
	const verifyStarted = useRef(false);
	const [verifyDone, setVerifyDone] = useState(false);
	useEffect(() => {
		if (view !== "return" || verifyStarted.current) return;
		verifyStarted.current = true;
		void verify({})
			.catch(() => {
				// The webhook usually settles it anyway; the row is reactive.
			})
			.finally(() => setVerifyDone(true));
	}, [view, verify]);

	const close = () => setView("closed");
	// Nothing recent to confirm (a days-old bookmark of the return URL):
	// fall through to the picker rather than a confirmation of nothing.
	const showReturn = view === "return" && latest !== null;

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) close();
			}}
		>
			<DialogContent className="sm:max-w-lg">
				{showReturn ? (
					<ReturnView
						latest={latest}
						verifyDone={verifyDone}
						balance={balance}
						slug={retailer.slug}
						onClose={close}
						onPickAgain={() => setView("picker")}
					/>
				) : (
					<PickerView
						retailerId={actingAs ? retailer._id : undefined}
						slug={retailer.slug}
						options={options}
						balance={balance}
						onClose={close}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}

// ---------------------------------------------------------------------------
// The picker
// ---------------------------------------------------------------------------

function PickerView({
	retailerId,
	slug,
	options,
	balance,
	onClose,
}: {
	/** Set only under admin act-as — the server then refuses, view-only. */
	retailerId: Id<"retailers"> | undefined;
	slug: string;
	options: TopUpOptions | null | undefined;
	balance: Balance | null | undefined;
	onClose: () => void;
}) {
	const createTopUp = useAction(api.creditPurchases.createTopUp);
	const supportWa = useSupportWaNumber();
	const [picked, setPicked] = useState<string | null>(null);
	const [phase, setPhase] = useState<"idle" | "opening">("idle");
	// Back from HitPay by the Back button restores this page with `opening`
	// still latched — the Buy button would spin forever. See the hook.
	useResetOnBfcache(useCallback(() => setPhase("idle"), []));

	const header = (
		<DialogHeader>
			<DialogTitle>Top up credits</DialogTitle>
			<DialogDescription>
				1 credit = 1 order. Bought credits kick in once your monthly credits run
				out, and carry over for 12 months — nothing goes to waste.
			</DialogDescription>
		</DialogHeader>
	);

	if (options === undefined || balance === undefined)
		return (
			<>
				{header}
				<div className="flex flex-col gap-3" aria-busy="true">
					<Skeleton className="h-16 w-full rounded-xl" />
					<div className="grid grid-cols-2 gap-3 pt-2.5">
						<Skeleton className="h-36 w-full rounded-2xl" />
						<Skeleton className="h-36 w-full rounded-2xl" />
					</div>
				</div>
				<DialogFooter>
					<Button variant="outline" className="tap-target" onClick={onClose}>
						Cancel
					</Button>
				</DialogFooter>
			</>
		);

	// No credits access at all (a teammate without the grant): the note IS
	// the surface — the same posture as the settings AreaGate.
	if (options === null || balance === null)
		return (
			<>
				{header}
				<NeedsAccessNote area="credits" level="read" />
				<DialogFooter>
					<Button variant="outline" className="tap-target" onClick={onClose}>
						Close
					</Button>
				</DialogFooter>
			</>
		);

	// Derived, not stored: the default is the first (smallest) pack, and a
	// pick the options no longer carry can never be what Buy sends.
	const pack: Pack | undefined =
		options.packs.find((p) => p.id === picked) ?? options.packs[0];
	const offers = packOffers(options.packs);
	const canBuy =
		options.available &&
		options.refusal === null &&
		options.viewOnly === null &&
		pack !== undefined;

	async function buy() {
		if (!canBuy || !pack || phase !== "idle") return;
		setPhase("opening");
		trackEvent("credits_topup_started", {
			pack_id: pack.id,
			value: pack.priceMinor / 100,
			currency: pack.currency,
		});
		try {
			const { url } = await createTopUp({
				packId: pack.id,
				...(retailerId ? { retailerId } : {}),
			});
			// Stay on "opening" through the navigation — HitPay's page replaces
			// this one; the bfcache reset re-arms Buy if they come Back.
			leavePageTo(url);
		} catch (err) {
			toast.error(convexErrorMessage(err));
			setPhase("idle");
		}
	}

	if (!options.available)
		return (
			<>
				{header}
				<BalanceStrip balance={balance} />
				<Notice icon={<Info className="size-4" />}>
					Buying credits online isn't available right now. Message us on
					WhatsApp and we'll help you top up.
				</Notice>
				<DialogFooter>
					<Button variant="outline" className="tap-target" onClick={onClose}>
						Close
					</Button>
					<Button asChild className="tap-target">
						<a
							href={buildWaContactLink(
								`Hi, I'd like to top up credits for my Kedaipal store (/${slug}).`,
								supportWa,
							)}
							target="_blank"
							rel="noopener noreferrer"
						>
							<MessageCircle className="size-4" />
							Message us on WhatsApp
						</a>
					</Button>
				</DialogFooter>
			</>
		);

	return (
		<>
			{header}
			<BalanceStrip balance={balance} />

			{options.viewOnly === "acting_as_admin" ? (
				<Notice icon={<Eye className="size-4" />}>
					View-only while you're acting as this store — the owner buys their own
					credits. Admins add credits with an adjustment instead.
				</Notice>
			) : null}
			{options.refusal !== null && options.refusalMessage ? (
				<Notice icon={<Info className="size-4" />} tone="strong">
					<p>{options.refusalMessage}</p>
					{options.viewOnly === null ? (
						<RefusalWayOut options={options} onClose={onClose} />
					) : null}
				</Notice>
			) : null}
			{options.viewOnly === "no_write" ? (
				<NeedsAccessNote area="credits" level="write" />
			) : null}

			{/* The packs read like the /pricing cards — credits as the headline,
			    then the price, what a credit costs in each, and exactly what the
			    bigger pack saves. Native radios: arrow keys move the choice. */}
			<fieldset className="min-w-0">
				<legend className="sr-only">Choose a credit pack</legend>
				<div className="grid grid-cols-2 gap-3 pt-2.5">
					{offers.map((p) => {
						const selected = p.id === pack?.id;
						const on = selected && canBuy;
						const disabled = !canBuy || phase !== "idle";
						// One sentence for a screen reader — the card's figures are
						// separate blocks that would otherwise run together.
						const spoken = [
							`${p.credits} credits for ${wholePrice(p.priceMinor, p.currency)}`,
							`${wholePrice(p.perCreditMinor, p.currency)} per credit`,
							p.saving
								? `save ${wholePrice(p.saving.minor, p.currency)}`
								: null,
							p.bestValue ? "best value" : null,
							"lasts 12 months",
						]
							.filter(Boolean)
							.join(", ");
						return (
							<label
								key={p.id}
								className={cn(
									"relative flex min-w-0 flex-col rounded-2xl border p-4 pt-5 transition-[border-color,box-shadow,background-color] has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
									disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
									on
										? "border-accent bg-accent/5 shadow-md ring-1 ring-accent"
										: "border-border bg-card shadow-sm",
									!disabled && !on && "hover:border-foreground/30",
								)}
							>
								<input
									type="radio"
									name="credit-pack"
									value={p.id}
									checked={selected}
									disabled={disabled}
									onChange={() => setPicked(p.id)}
									aria-label={spoken}
									className="sr-only"
								/>
								<span className="flex items-baseline gap-1 pr-6">
									<span className="text-3xl font-bold tracking-tight tabular-nums">
										{p.credits}
									</span>
									<span className="text-sm text-muted-foreground">credits</span>
								</span>
								<span className="mt-3 text-lg font-semibold tabular-nums">
									{wholePrice(p.priceMinor, p.currency)}
								</span>
								<span className="text-xs text-muted-foreground tabular-nums">
									{wholePrice(p.perCreditMinor, p.currency)} per credit
								</span>
								{p.saving ? (
									<span className="mt-2.5 w-fit rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent-emphasis">
										Save {wholePrice(p.saving.minor, p.currency)}
										{p.saving.versus
											? ` vs ${p.saving.versus.count} × ${p.saving.versus.credits}`
											: ""}
									</span>
								) : null}
								<span className="mt-auto flex items-center gap-1.5 pt-3 text-xs text-muted-foreground">
									<Check
										className="size-3.5 shrink-0 text-accent"
										aria-hidden
									/>
									Lasts 12 months
								</span>
								{/* After the figures in the DOM, so the radio's name
								    starts with the credits it buys. */}
								{p.bestValue ? (
									<span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rotate-2 whitespace-nowrap rounded-md bg-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent-foreground shadow-sm">
										Best value
									</span>
								) : null}
								<span
									aria-hidden
									className={cn(
										"absolute right-3 top-3 flex size-5 items-center justify-center rounded-full border",
										on
											? "border-accent bg-accent text-accent-foreground"
											: "border-border bg-background",
									)}
								>
									{on ? <Check className="size-3.5" /> : null}
								</span>
							</label>
						);
					})}
				</div>
			</fieldset>

			{canBuy && pack ? (
				<p aria-live="polite" className="text-sm font-medium tabular-nums">
					{afterTopUpLine(balance.total, pack.credits)}
					{/* Out of credits now, above zero after: say the lock lifts
					    (T3) — the moment it's paid, not after a refresh. Gated on
					    CREDIT_LOCK_ENABLED because this reads off the BALANCE, not
					    off `locked`: with the lock switched off it promised an
					    unlock to a store that was never locked, on the checkout
					    line. `afterTopUpLine` above already says the true and
					    sufficient thing ("Covers the 15 owed and leaves 35 orders"). */}
					{CREDIT_LOCK_ENABLED &&
					balance.total <= 0 &&
					balance.total + pack.credits > 0 &&
					balance.lockExempt === null
						? " Your store unlocks as soon as it's paid."
						: null}
				</p>
			) : null}

			{options.upgradeHint ? (
				<p className="text-xs text-muted-foreground">
					Topping up every month? {options.upgradeHint.planLabel} includes{" "}
					{options.upgradeHint.monthlyCredits} orders a month, which works out
					cheaper for steady volume.
				</p>
			) : null}

			{/* An Enterprise store's cheaper route (T6): its contract's block
			    rate, said where credits are bought. A block is invoiced by hand,
			    so the owner asks for one in a chat; anyone else is told whose
			    call it is. */}
			{options.contractBlock ? (
				<ContractBlockLine
					block={options.contractBlock}
					canAsk={options.viewOnly === null && !options.buyerIsMember}
					askUrl={buildWaContactLink(
						`Hi Arif, we'd like an overage block of ${options.contractBlock.credits.toLocaleString("en")} credits for kedaipal.com/${slug}.`,
						supportWa,
					)}
				/>
			) : null}

			<p className="text-xs text-muted-foreground">
				Credits are non-refundable and not redeemable for cash.{" "}
				<a
					href={`/terms#${TERMS_ANCHOR.credits}`}
					target="_blank"
					rel="noopener noreferrer"
					className="font-medium text-foreground underline underline-offset-2"
				>
					Credits terms
				</a>
			</p>

			{canBuy ? (
				phase === "opening" ? (
					<p
						aria-live="polite"
						className="flex items-center gap-2 text-xs text-muted-foreground"
					>
						<Loader2 className="size-3.5 animate-spin" />
						Opening HitPay's secure payment page…
					</p>
				) : (
					<p className="text-xs text-muted-foreground">
						{options.buyerIsMember
							? "You'll pay on HitPay's secure page with your own card or e-wallet — the store owner is emailed a receipt."
							: "You'll pay on HitPay's secure page, and your credits land the moment it's confirmed."}
					</p>
				)
			) : null}

			<DialogFooter>
				<Button variant="outline" className="tap-target" onClick={onClose}>
					Cancel
				</Button>
				<Button
					className="tap-target"
					disabled={!canBuy}
					isLoading={phase === "opening"}
					onClick={buy}
				>
					{pack
						? `Buy ${pack.credits} credits · ${formatPrice(pack.priceMinor, pack.currency)}`
						: "Buy credits"}
				</Button>
			</DialogFooter>
		</>
	);
}

/** The contract's overage block beside the packs (Credits T6). An overage
 * rate of zero is a deal that includes its blocks — said as such, never as a
 * price of nothing. */
function ContractBlockLine({
	block,
	canAsk,
	askUrl,
}: {
	block: NonNullable<TopUpOptions["contractBlock"]>;
	canAsk: boolean;
	askUrl: string;
}) {
	const size = block.credits.toLocaleString("en");
	return (
		<p className="text-xs text-muted-foreground">
			{block.ratePerCreditMinor > 0 ? (
				<>
					Buying often? Your Enterprise contract prices credits at{" "}
					{wholePrice(block.ratePerCreditMinor, block.currency)} each, in blocks
					of {size} ({wholePrice(block.priceMinor, block.currency)} a block).
				</>
			) : (
				<>Your Enterprise contract includes blocks of {size} credits.</>
			)}{" "}
			{canAsk ? (
				<a
					href={askUrl}
					target="_blank"
					rel="noopener noreferrer"
					className="font-medium text-foreground underline underline-offset-2"
				>
					Ask us for a block
				</a>
			) : (
				"The store owner asks us for one."
			)}
		</p>
	);
}

/** The one thing a refused OWNER can do about it. A teammate gets the copy
 * only — every way out is a billing write, which is the owner's. */
function RefusalWayOut({
	options,
	onClose,
}: {
	options: TopUpOptions;
	onClose: () => void;
}) {
	const role = useStoreRole();
	if (role === "member") return null;
	const refusal = options.refusal;
	if (refusal === "past_due" && options.pendingInvoice?.payNowUrl)
		return (
			<Button asChild variant="outline" className="tap-target mt-2 w-fit">
				<a href={options.pendingInvoice.payNowUrl}>
					Pay {options.pendingInvoice.invoiceNumber}
				</a>
			</Button>
		);
	const label =
		refusal === "past_due"
			? "View the invoice"
			: refusal === "on_hold"
				? "Resume your plan"
				: refusal === "trialing" || refusal === "cancelled"
					? "Choose a plan"
					: // admin_store / sponsored: nothing is wrong, so no way out.
						null;
	if (!label) return null;
	// The billing tab under this dialog carries the invoice, the plan picker
	// and the resume switch — closing IS the way there.
	return (
		<Button
			variant="outline"
			className="tap-target mt-2 w-fit"
			onClick={onClose}
		>
			{label}
		</Button>
	);
}

// ---------------------------------------------------------------------------
// Back from HitPay
// ---------------------------------------------------------------------------

type ReturnState =
	| "confirming"
	| "paid"
	| "not_yet"
	| "expired"
	| "flagged"
	| "failed";

function returnState(
	latest: LatestPurchase | undefined,
	verifyDone: boolean,
): ReturnState {
	if (latest === undefined) return "confirming";
	if (latest.status === "paid") return "paid";
	if (latest.issue !== null) return "flagged";
	if (latest.status === "expired") return "expired";
	if (latest.status === "failed") return "failed";
	return verifyDone ? "not_yet" : "confirming";
}

function ReturnView({
	latest,
	verifyDone,
	balance,
	slug,
	onClose,
	onPickAgain,
}: {
	latest: LatestPurchase | undefined;
	verifyDone: boolean;
	balance: Balance | null | undefined;
	slug: string;
	onClose: () => void;
	onPickAgain: () => void;
}) {
	const isMember = useStoreRole() === "member";
	const supportWa = useSupportWaNumber();
	const state = returnState(latest, verifyDone);

	if (state === "confirming" || latest === undefined)
		return (
			<>
				<DialogHeader>
					<DialogTitle>Confirming your payment…</DialogTitle>
					<DialogDescription>
						This takes a few seconds — keep this open.
					</DialogDescription>
				</DialogHeader>
				<div
					aria-live="polite"
					className="flex items-center justify-center gap-2.5 py-6 text-sm text-muted-foreground"
				>
					<Loader2 className="size-5 animate-spin" />
					Checking with HitPay
				</div>
			</>
		);

	if (state === "paid")
		return (
			<>
				<DialogHeader>
					<StateIcon tone="success">
						<CheckCircle2 className="size-6" />
					</StateIcon>
					<DialogTitle>{latest.credits} credits added</DialogTitle>
					<DialogDescription>
						{balance
							? `You now have ${ordersLabel(balance.total)}.`
							: "They're on your store now, ready for your next orders."}
					</DialogDescription>
				</DialogHeader>
				<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-xl border border-border bg-muted/40 p-4 text-sm">
					<dt className="text-muted-foreground">Paid</dt>
					<dd className="text-right tabular-nums">
						{formatPrice(latest.amountMinor, latest.currency)}
					</dd>
					<dt className="text-muted-foreground">Paid with</dt>
					<dd className="text-right">
						{latest.paymentMethodLabel ?? "Online payment"}
					</dd>
					{latest.expiresAt !== null ? (
						<>
							<dt className="text-muted-foreground">Valid until</dt>
							<dd className="text-right">
								{formatShortDate(latest.expiresAt)}
							</dd>
						</>
					) : null}
					<dt className="text-muted-foreground">Receipt</dt>
					<dd className="truncate text-right font-mono text-xs leading-5">
						{latest.purchaseNumber}
					</dd>
				</dl>
				<p className="text-xs text-muted-foreground">
					{isMember
						? "A receipt is on its way to you, and the store owner gets one too."
						: "A receipt is on its way to your billing email."}
				</p>
				<DialogFooter>
					<CreditReceiptButton
						purchaseId={latest._id}
						label="Download receipt"
						variant="outline"
						size="default"
					/>
					<Button className="tap-target" onClick={onClose}>
						Done
					</Button>
				</DialogFooter>
			</>
		);

	if (state === "flagged")
		return (
			<>
				<DialogHeader>
					<StateIcon tone="warning">
						<TriangleAlert className="size-6" />
					</StateIcon>
					<DialogTitle>We've flagged this payment</DialogTitle>
					<DialogDescription>
						{latest.issue === "late_payment"
							? "Your payment reached us after this checkout had closed, so the credits weren't added automatically. We'll add them or refund you — message us if you'd like it sorted sooner."
							: "This payment didn't match the pack you picked, so the credits weren't added automatically. We'll sort it out — message us if you have questions."}
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="outline" className="tap-target" onClick={onClose}>
						Close
					</Button>
					<Button asChild className="tap-target">
						<a
							href={buildWaContactLink(
								`Hi, my credit top-up ${latest.purchaseNumber} for /${slug} needs sorting out.`,
								supportWa,
							)}
							target="_blank"
							rel="noopener noreferrer"
						>
							<MessageCircle className="size-4" />
							Message us
						</a>
					</Button>
				</DialogFooter>
			</>
		);

	const copy: Record<
		"not_yet" | "expired" | "failed",
		{ title: string; body: string; again: string }
	> = {
		not_yet: {
			title: "We haven't received this payment yet",
			body: `If you finished paying, your ${latest.credits} credits land here automatically in a minute or two, and we'll email the receipt — you can close this. If you backed out, nothing was charged.`,
			again: "Start a new top-up",
		},
		expired: {
			title: "This checkout expired",
			body: "Nothing was charged — a checkout stays open for 24 hours. Start a new top-up whenever you're ready.",
			again: "Start a new top-up",
		},
		failed: {
			title: "We couldn't open the payment page",
			body: "Nothing was charged. Try again in a moment.",
			again: "Try again",
		},
	};
	const { title, body, again } = copy[state];
	return (
		<>
			<DialogHeader>
				<StateIcon tone="muted">
					<Clock className="size-6" />
				</StateIcon>
				<DialogTitle>{title}</DialogTitle>
				<DialogDescription>{body}</DialogDescription>
			</DialogHeader>
			<DialogFooter>
				<Button variant="outline" className="tap-target" onClick={onClose}>
					Close
				</Button>
				<Button className="tap-target" onClick={onPickAgain}>
					{again}
				</Button>
			</DialogFooter>
		</>
	);
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** "37 orders left" / "15 orders owed" — order counts, never money. */
function ordersLabel(total: number): string {
	const n = Math.abs(total);
	const noun = n === 1 ? "order" : "orders";
	return total < 0 ? `${n} ${noun} owed` : `${n} ${noun} left`;
}

/** What the seller is topping up: the total the meter shows, and always the
 * two balances it's made of — monthly credits (used first, reset on the 1st)
 * and bought credits (used next, kept 12 months) — in the meter's words. */
function BalanceStrip({ balance }: { balance: Balance }) {
	const owed = balance.total < 0;
	return (
		<div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3">
			<p className="text-xs text-muted-foreground">You have</p>
			<div className="min-w-0 text-right">
				<p
					className={cn(
						"text-base font-semibold tabular-nums",
						owed && "text-destructive",
					)}
				>
					{ordersLabel(balance.total)}
				</p>
				<p className="text-xs text-muted-foreground tabular-nums">
					{balance.plan < 0
						? `${-balance.plan} owed on monthly`
						: `${balance.plan} monthly`}{" "}
					· {balance.purchased} bought
				</p>
			</div>
		</div>
	);
}

/** An in-place explanation — the same muted card as NeedsAccessNote, so a
 * disabled control's reason looks like every other one in the app. `strong`
 * for the one message the seller must read (why they can't buy). */
function Notice({
	icon,
	tone = "muted",
	children,
}: {
	icon: ReactNode;
	tone?: "muted" | "strong";
	children: ReactNode;
}) {
	return (
		<div
			className={cn(
				"flex items-start gap-2.5 rounded-xl border border-border bg-muted/50 p-3",
				tone === "strong" ? "text-foreground" : "text-muted-foreground",
			)}
		>
			<span className="mt-0.5 shrink-0" aria-hidden>
				{icon}
			</span>
			<div className="min-w-0 text-xs leading-relaxed">{children}</div>
		</div>
	);
}

function StateIcon({
	tone,
	children,
}: {
	tone: "success" | "warning" | "muted";
	children: ReactNode;
}) {
	return (
		<span
			aria-hidden
			className={cn(
				"flex size-11 items-center justify-center rounded-full",
				tone === "success" && "bg-accent/10 text-accent-emphasis",
				tone === "warning" && "bg-destructive/10 text-destructive",
				tone === "muted" && "bg-muted text-muted-foreground",
			)}
		>
			{children}
		</span>
	);
}
