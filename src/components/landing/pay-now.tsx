import { BadgeCheck, Check, HandCoins, Lock } from "lucide-react";
import { cn } from "../../lib/utils";
import { m } from "../../paraglide/messages";
import { AppImage } from "../ui/app-image";
import { PaneLabel, TapRing } from "./payment-handshake";

/**
 * "Pay now" — phase 02 of the seller-flow walkthrough (19 Oct 2026, Arif:
 * "showcase our payment provider flow as well"). The buyer pays ONLINE
 * through the seller's own HitPay account and the order confirms itself:
 * no screenshot, no "dah transfer?", no tap on the seller's side.
 *
 * Acted out as the product actually runs it, state for state, because the
 * first cut invented a flow and Arif caught it ("the mockup is wrong"):
 *
 * - HitPay's checkout is a HOSTED PAGE the buyer is sent to, not a sheet in
 *   the order page (`docs/hitpay-gateway.md`). So the phone leaves for it
 *   and comes back — "Opening secure checkout…", the page, the QR, then
 *   "Confirming your payment…" / "Checking with HitPay — this usually takes
 *   a few seconds." on the return, exactly `track.$token.tsx`'s states.
 * - A HitPay store withholds its bank details (86eye9xd4), so there is NO
 *   "paid by bank transfer instead?" door here — that story is phase 03.
 * - The buyer's card is the real one: "Payment Unpaid" (amber) →
 *   "Payment Confirmed" (emerald) with "Paid via DuitNow" and the HitPay
 *   reference both sides quote. The seller's card is the dashboard's own
 *   payment section (`app.orders.$shortId.tsx`): "The customer hasn't
 *   tapped I've paid yet…" + "Mark payment received", then "Payment
 *   received · Paid online via HitPay just now · DuitNow · Ref …".
 * - The rails are named as `describeGatewayMethods` names them.
 *
 * Both panes are fixed-height boxes so no beat moves the page, and the
 * first beat IS a state.
 */

/**
 * Beat holds, ms: the order page → tap Pay now (opening) → HitPay's page →
 * the QR scanned → back, confirming → confirmed on both sides.
 */
export const PAYNOW_BEATS = [1400, 900, 1600, 1500, 1200, 2800] as const;
/** The beat both sides read paid (the reduced-motion still). */
export const PAID_BEAT = 5;

const OPENING_BEAT = 1;
const HOSTED_BEATS: readonly number[] = [2, 3];
const SCAN_BEAT = 3;
const CONFIRMING_BEAT = 4;

const METHODS = [
	{
		id: "duitnow",
		src: "/img/payment/duitnow.svg",
		label: m.paynow_method_duitnow,
	},
	{ id: "fpx", src: "/img/payment/fpx.svg", label: m.paynow_method_fpx },
	{
		id: "touchngo",
		src: "/img/payment/touchngo.svg",
		label: m.paynow_method_tng,
	},
	{ id: "visa", src: "/img/payment/visa.svg", label: m.paynow_method_card },
] as const;

function StatusPill({ paid, pop }: { paid: boolean; pop: boolean }) {
	return (
		<span
			key={paid ? "confirmed" : "pending"}
			className={cn(
				"whitespace-nowrap rounded-full px-[0.8em] py-[0.3em] text-[0.8em] font-semibold",
				paid ? "bg-blue-100 text-blue-800" : "bg-orange-100 text-orange-800",
				pop && "animate-kp-pop",
			)}
		>
			{paid ? m.handshake_seller_confirmed() : m.hero_after_status_1()}
		</span>
	);
}

function Spinner() {
	return (
		<span
			aria-hidden
			className="size-[0.9em] shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
		/>
	);
}

/** The real order page's payment card, beat by beat. */
function BuyerPaymentCard({ beat, still }: { beat: number; still: boolean }) {
	const paid = still || beat >= PAID_BEAT;
	const opening = !still && beat === OPENING_BEAT;
	const confirming = !still && beat === CONFIRMING_BEAT;
	// Between the tap and the confirmation the button is never live again.
	const busy = !still && beat >= OPENING_BEAT && beat < PAID_BEAT;
	const pop = still ? "" : "animate-kp-card-in";

	if (paid) {
		return (
			<div
				key="paid"
				className={cn(
					"flex flex-col gap-[0.8em] rounded-[1.1em] border border-emerald-200 bg-emerald-50 p-[1em] text-emerald-800",
					pop,
				)}
			>
				<div className="flex items-center gap-[0.7em]">
					<BadgeCheck className="size-[1.4em] shrink-0" />
					<span className="flex min-w-0 flex-1 flex-col">
						<span className="text-[0.7em] font-bold uppercase tracking-[0.12em] opacity-80">
							{m.paynow_payment_eyebrow()}
						</span>
						<span className="text-[1em] font-bold leading-tight">
							{m.paynow_buyer_confirmed()}
						</span>
					</span>
					<span className="shrink-0 text-[0.8em] opacity-80">
						{m.handshake_seller_just_now()}
					</span>
				</div>
				<div className="flex flex-col gap-[0.4em]">
					<span className="text-[0.85em] opacity-80">
						{m.paynow_buyer_paid_via()}
					</span>
					<span className="rounded-[0.6em] border border-black/5 bg-white/70 px-[0.8em] py-[0.5em]">
						<span className="flex items-center justify-between gap-[0.5em] text-[0.7em] font-semibold uppercase tracking-[0.1em] opacity-70">
							{m.paynow_ref_label()}
							<span className="normal-case tracking-normal">
								{m.handshake_copy()}
							</span>
						</span>
						<span className="block font-mono text-[0.85em] text-emerald-900">
							{m.paynow_ref_value()}
						</span>
					</span>
				</div>
				<span className="flex h-[3em] items-center justify-center rounded-full border border-emerald-300 bg-white text-[0.95em] font-bold text-emerald-900">
					{m.handshake_buyer_receipt()}
				</span>
			</div>
		);
	}

	return (
		<div
			key="unpaid"
			className={cn(
				"flex flex-col gap-[0.8em] rounded-[1.1em] border border-amber-200 bg-amber-50 p-[1em] text-amber-900",
				pop,
			)}
		>
			<div className="flex items-center gap-[0.7em]">
				<HandCoins className="size-[1.4em] shrink-0 text-amber-700" />
				<span className="flex flex-col">
					<span className="text-[0.7em] font-bold uppercase tracking-[0.12em] opacity-80">
						{m.paynow_payment_eyebrow()}
					</span>
					<span className="text-[1em] font-bold leading-tight">
						{m.paynow_buyer_unpaid()}
					</span>
				</span>
			</div>
			<span
				className={cn(
					"relative flex h-[3.4em] items-center justify-center gap-[0.6em] rounded-full text-[1.05em] font-bold",
					busy
						? "bg-accent/60 text-accent-foreground/80"
						: "bg-accent text-accent-foreground",
					opening && "animate-kp-press",
				)}
			>
				{opening ? <TapRing /> : null}
				{busy ? <Spinner /> : null}
				{confirming
					? m.paynow_confirming()
					: busy
						? m.paynow_opening()
						: m.paynow_pay_now({ amount: m.handshake_amount() })}
			</span>
			<span className="text-[0.82em] leading-snug opacity-80">
				{confirming ? m.paynow_confirming_sub() : m.paynow_pay_sub()}
			</span>
		</div>
	);
}

/**
 * HitPay's hosted checkout — a page the phone LEAVES for, so it slides in
 * from the right over the order page and slides back out on the return. A
 * still never left, so it has no page.
 */
function HostedCheckout({ beat }: { beat: number }) {
	const open = HOSTED_BEATS.includes(beat);
	const scanning = beat === SCAN_BEAT;
	return (
		<div
			className={cn(
				"absolute inset-0 flex flex-col bg-white p-[1.2em] pt-[2.6em] text-slate-800 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
				open ? "translate-x-0" : "translate-x-[105%]",
			)}
		>
			<div className="flex items-center justify-between gap-[0.5em] border-b border-slate-100 pb-[0.8em]">
				<AppImage
					src="/img/hitpay-logo.svg"
					alt=""
					aspect="h-[1.3em] w-auto"
					fill={false}
				/>
				<span className="flex items-center gap-[0.35em] text-[0.75em] font-semibold uppercase tracking-[0.1em] text-slate-500">
					<Lock className="size-[1em]" />
					{m.paynow_page_label()}
				</span>
			</div>
			<div className="mt-[1em] flex items-baseline justify-between gap-[0.5em]">
				<span className="text-[0.9em] text-slate-500">
					{m.paynow_page_paying()}
				</span>
				<span className="font-heading text-[1.3em] font-extrabold">
					{m.handshake_amount()}
				</span>
			</div>
			<div className="relative mt-[1em] flex-1">
				{scanning ? (
					<div
						key="scan"
						className="flex h-full flex-col items-center justify-center gap-[0.7em] rounded-[1.1em] border border-slate-200 p-[1em] text-center animate-kp-pop"
					>
						<span
							aria-hidden
							className="size-[7em] rounded-[0.6em] bg-slate-900 [background-image:repeating-linear-gradient(90deg,transparent_0_0.35em,white_0.35em_0.7em),repeating-linear-gradient(0deg,transparent_0_0.35em,white_0.35em_0.7em)]"
						/>
						<span className="text-[1em] font-bold">
							{m.paynow_scan_title()}
						</span>
						<span className="flex items-center gap-[0.5em] text-[0.85em] text-slate-500">
							<Spinner />
							{m.paynow_scan_body()}
						</span>
					</div>
				) : (
					<div key="methods" className="flex flex-col gap-[0.6em]">
						<span className="text-[0.75em] font-bold uppercase tracking-[0.1em] text-slate-500">
							{m.paynow_page_choose()}
						</span>
						{METHODS.map((method, i) => (
							<span
								key={method.id}
								className={cn(
									"relative flex items-center gap-[0.8em] rounded-[0.9em] border-2 px-[0.9em] py-[0.7em] text-[0.9em] font-semibold",
									i === 0
										? "border-accent bg-accent/[0.06]"
										: "border-slate-200 bg-white",
								)}
							>
								{i === 0 && open ? <TapRing /> : null}
								<AppImage
									src={method.src}
									alt=""
									aspect="h-[1.5em] w-[2.6em]"
									objectFit="contain"
									fill={false}
								/>
								{method.label()}
								{i === 0 ? (
									<Check
										className="ml-auto size-[1em] shrink-0 text-accent-emphasis"
										strokeWidth={3}
									/>
								) : null}
							</span>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

function BuyerPhone({ beat, still }: { beat: number; still: boolean }) {
	const paid = still || beat >= PAID_BEAT;
	return (
		<div className="relative mx-auto w-[25em] max-w-full shrink-0 rounded-[2.6em] bg-slate-950 p-[0.55em] shadow-[0_30px_60px_-24px_hsl(222_47%_11%_/_0.5)] ring-1 ring-white/15">
			<div className="relative flex h-[30em] flex-col overflow-hidden rounded-[2.1em] bg-slate-50 p-[1.2em] text-left text-slate-800">
				<span className="absolute left-1/2 top-[0.7em] z-10 h-[1.4em] w-[6em] -translate-x-1/2 rounded-full bg-slate-950" />
				<div className="mt-[1.6em]">
					<PaneLabel>{m.handshake_buyer_label()}</PaneLabel>
				</div>
				<div className="mt-[0.6em] flex items-baseline justify-between gap-[0.5em]">
					<span className="font-heading text-[1.4em] font-extrabold">
						{m.handshake_order_id()}
					</span>
					<span className="text-[1.2em] font-bold">{m.handshake_amount()}</span>
				</div>
				<span className="text-[0.95em] text-slate-500">
					{m.handshake_buyer_store_line()}
				</span>
				<div className="mt-[0.9em] flex items-center justify-between gap-[0.6em] rounded-[0.9em] border border-slate-200 bg-white px-[0.9em] py-[0.7em]">
					<span className="truncate text-[0.9em] font-semibold">
						{m.handshake_seller_order_meta()}
					</span>
					<StatusPill paid={paid} pop={paid && !still} />
				</div>

				{/* Fixed box: no state resizes the phone. */}
				<div className="relative mt-[0.9em] h-[16.5em]">
					<BuyerPaymentCard beat={beat} still={still} />
				</div>

				{still ? null : <HostedCheckout beat={beat} />}
			</div>
		</div>
	);
}

/** The dashboard's own payment section on the order, beat by beat. */
function SellerCard({ beat, still }: { beat: number; still: boolean }) {
	const paid = still || beat >= PAID_BEAT;
	const pop = still ? "" : "animate-kp-card-in";

	return (
		<div className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-[1.8em] border border-border bg-card p-[1.4em] text-left shadow-xl shadow-primary/10">
			<PaneLabel>{m.handshake_seller_label()}</PaneLabel>
			<div className="mt-[0.8em] flex items-start justify-between gap-[0.8em]">
				<span className="flex min-w-0 flex-col">
					<span className="font-heading text-[1.45em] font-extrabold leading-tight">
						{m.handshake_seller_order()}
					</span>
					<span className="truncate text-[0.95em] text-muted-foreground">
						{m.handshake_seller_order_meta()}
					</span>
				</span>
				<span className="flex shrink-0 flex-col items-end gap-[0.4em]">
					<span className="text-[1.2em] font-bold">{m.handshake_amount()}</span>
					<StatusPill paid={paid} pop={paid && !still} />
				</span>
			</div>

			{/* One height for both states, so the flip never moves the pane. */}
			<div className="relative mt-[1.2em] min-h-[12em]">
				{paid ? (
					<div key="paid" className={cn("flex flex-col gap-[0.9em]", pop)}>
						<div className="flex items-start gap-[0.7em] rounded-[1.1em] border border-emerald-200 bg-emerald-50/70 p-[1em] dark:border-emerald-800 dark:bg-emerald-950/40">
							<BadgeCheck className="mt-[0.1em] size-[1.3em] shrink-0 text-emerald-700 dark:text-emerald-400" />
							<span className="flex min-w-0 flex-1 flex-col gap-[0.25em]">
								<span className="text-[0.7em] font-bold uppercase tracking-[0.12em] text-emerald-800 dark:text-emerald-300">
									{m.paynow_seller_received()}
								</span>
								<span className="text-[0.95em] font-semibold leading-snug text-emerald-900 dark:text-emerald-100">
									{m.paynow_seller_paid()}
								</span>
								<span className="flex items-center justify-between gap-[0.5em] font-mono text-[0.8em] text-emerald-800/80 dark:text-emerald-300/80">
									<span className="truncate">Ref {m.paynow_ref_value()}</span>
									<span className="shrink-0 font-sans font-semibold">
										{m.handshake_copy()}
									</span>
								</span>
							</span>
						</div>
						{/* The point of the phase, said on the frame it is true. */}
						<span
							className={cn(
								"flex items-start gap-[0.7em] rounded-[1em] bg-primary px-[1em] py-[0.8em] text-[0.9em] font-semibold leading-snug text-primary-foreground",
								!still && "animate-kp-toast-in [animation-delay:250ms]",
							)}
						>
							<span className="mt-[0.35em] size-[0.6em] shrink-0 rounded-full bg-accent" />
							{m.paynow_caption()}
						</span>
					</div>
				) : (
					<div
						key="unpaid"
						className={cn(
							"flex flex-col gap-[0.8em] rounded-[1.1em] border border-border bg-card p-[1em]",
							pop,
						)}
					>
						<span className="flex items-center gap-[0.5em] text-[0.7em] font-bold uppercase tracking-[0.12em] text-muted-foreground">
							<HandCoins className="size-[1.3em] text-amber-600" />
							{m.paynow_payment_eyebrow()}
						</span>
						<span className="text-[0.9em] leading-snug text-muted-foreground">
							{m.paynow_seller_unpaid()}
						</span>
						<span className="flex h-[3em] items-center justify-center gap-[0.5em] rounded-[0.8em] bg-secondary text-[0.9em] font-semibold text-secondary-foreground">
							<BadgeCheck className="size-[1.1em]" />
							{m.handshake_seller_mark_received()}
						</span>
					</div>
				)}
			</div>
		</div>
	);
}

/**
 * The two panes, beat passed in — the walkthrough owns the clock and the
 * decorative frame. Same container rules as `HandshakePanes`; the seller
 * card is sized to its content and centred on the phone (the first cut's
 * fixed 20em box left two-thirds of the card empty).
 */
export function PayNowPanes({ beat, still }: { beat: number; still: boolean }) {
	const storyBeat = still ? PAID_BEAT : beat;
	return (
		<div className="@container w-full">
			<div className="flex flex-col items-stretch gap-[1.6em] text-[10px] @[30rem]:flex-row @[30rem]:items-center @[30rem]:gap-[2.4em] @[30rem]:text-[clamp(9px,2cqw,12px)]">
				<BuyerPhone beat={storyBeat} still={still} />
				<SellerCard beat={storyBeat} still={still} />
			</div>
		</div>
	);
}
