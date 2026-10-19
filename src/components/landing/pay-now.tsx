import { Check, ShieldCheck } from "lucide-react";
import { cn } from "../../lib/utils";
import { m } from "../../paraglide/messages";
import { AppImage } from "../ui/app-image";
import { PaneLabel, TapRing } from "./payment-handshake";

/**
 * "Pay now" — phase 02 of the seller-flow walkthrough (19 Oct 2026, Arif:
 * "showcase our payment provider flow as well"). The buyer pays ONLINE
 * through the seller's own HitPay account and the order confirms itself:
 * no screenshot, no "dah transfer?", no tap on the seller's side. Acted out
 * as the real order page runs it (`track.$token.tsx`): the Pay now button
 * names the amount, the line under it promises the order confirms
 * automatically, and "Paid by bank transfer instead?" stays as the door to
 * the handshake — which is the walkthrough's NEXT phase, for the buyers who
 * still transfer.
 *
 * HitPay's checkout is a hosted page the buyer is sent to; here it is a sheet
 * sliding up the phone with the real rails as tiles (the marks from
 * `payment-methods.ts`), DuitNow QR chosen, then the QR to scan. Both panes
 * are fixed-height boxes so no beat moves the page, and the first beat IS a
 * state. The seller's card copy is the dashboard's own: "Paid online via
 * HitPay" (`app.orders.$shortId.tsx`).
 */

/** Beat holds, ms: idle → tap Pay now → HitPay checkout → scan the QR → paid. */
export const PAYNOW_BEATS = [1200, 800, 1600, 1600, 2800] as const;
/** The beat both sides read paid (the reduced-motion still). */
export const PAID_BEAT = 4;

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

function BuyerPhone({ beat, still }: { beat: number; still: boolean }) {
	const paid = still || beat >= PAID_BEAT;
	const tapPay = !still && beat === 1;
	const sheetOpen = !still && (beat === 2 || beat === 3);
	const scanning = beat === 3;
	const pop = still ? "" : "animate-kp-card-in";

	return (
		<div className="relative mx-auto w-[25em] max-w-full shrink-0 rounded-[2.6em] bg-slate-950 p-[0.55em] shadow-[0_30px_60px_-24px_hsl(222_47%_11%_/_0.5)] ring-1 ring-white/15">
			<div className="relative flex h-[32em] flex-col overflow-hidden rounded-[2.1em] bg-slate-50 p-[1.2em] text-left text-slate-800">
				<span className="absolute left-1/2 top-[0.7em] h-[1.4em] w-[6em] -translate-x-1/2 rounded-full bg-slate-950" />
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

				{/* Fixed box: the two states never resize the phone. */}
				<div className="relative mt-[1em] h-[20em]">
					{paid ? (
						<div key="paid" className={cn("flex flex-col gap-[0.8em]", pop)}>
							<div className="rounded-[1.1em] border border-emerald-300 bg-emerald-50 p-[1em]">
								<span className="flex items-center gap-[0.4em] text-[1.05em] font-bold text-emerald-800">
									<Check className="size-[1em] shrink-0" strokeWidth={3} />
									{m.paynow_paid_title({ amount: m.handshake_amount() })}
								</span>
								<span className="mt-[0.3em] block text-[0.9em] leading-snug text-emerald-900/80">
									{m.paynow_paid_body()}
								</span>
							</div>
							<span className="flex h-[3.4em] items-center justify-center gap-[0.5em] rounded-full border border-slate-200 bg-white text-[1em] font-bold">
								{m.handshake_buyer_receipt()}
							</span>
							<span className="text-[0.9em] text-slate-500">
								{m.handshake_buyer_status()}
							</span>
						</div>
					) : (
						<div key="pay" className={cn("flex flex-col gap-[0.8em]", pop)}>
							<span
								className={cn(
									"relative flex h-[3.6em] items-center justify-center rounded-full bg-accent text-[1.1em] font-bold text-accent-foreground",
									tapPay && "animate-kp-press",
								)}
							>
								{tapPay ? <TapRing /> : null}
								{m.paynow_pay_now({ amount: m.handshake_amount() })}
							</span>
							<span className="text-[0.85em] leading-snug text-slate-500">
								{m.paynow_pay_sub()}
							</span>
							<span className="text-[0.85em] font-semibold underline underline-offset-2">
								{m.paynow_transfer_instead()}
							</span>
							<span className="mt-auto flex items-center gap-[0.5em] text-[0.8em] text-slate-500">
								<ShieldCheck className="size-[1em] shrink-0 text-accent" />
								{m.paynow_powered()}
							</span>
						</div>
					)}
				</div>

				{/* HitPay's checkout, as a sheet: the rails as tiles, DuitNow chosen,
				    then the QR. Slides up on the tap, down on paid; a still has no
				    tap, so it has no sheet. */}
				{still ? null : (
					<div
						className={cn(
							"absolute inset-x-0 bottom-0 flex flex-col gap-[0.8em] rounded-t-[1.6em] bg-white p-[1.2em] shadow-[0_-12px_30px_hsl(222_47%_11%_/_0.18)] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
							sheetOpen ? "translate-y-0" : "translate-y-[105%] delay-200",
						)}
					>
						<span className="h-[0.4em] w-[3.2em] self-center rounded-full bg-slate-200" />
						<span className="flex items-center justify-between gap-[0.5em]">
							<span className="flex items-center gap-[0.5em] text-[0.8em] font-bold uppercase tracking-[0.1em] text-slate-500">
								<AppImage
									src="/img/hitpay-logo.svg"
									alt=""
									aspect="h-[1.1em] w-auto"
									fill={false}
								/>
								{m.paynow_sheet_label()}
							</span>
							<span className="text-[1em] font-bold">
								{m.paynow_sheet_pay({ amount: m.handshake_amount() })}
							</span>
						</span>
						<div className="h-[12.6em]">
							{scanning ? (
								<div
									key="scan"
									className={cn(
										"flex h-full flex-col items-center justify-center gap-[0.6em] rounded-[1.1em] border border-slate-200 p-[0.8em] text-center",
										!still && "animate-kp-pop",
									)}
								>
									<span
										aria-hidden
										className="size-[6em] rounded-[0.6em] bg-slate-900 [background-image:repeating-linear-gradient(90deg,transparent_0_0.35em,white_0.35em_0.7em),repeating-linear-gradient(0deg,transparent_0_0.35em,white_0.35em_0.7em)]"
									/>
									<span className="text-[0.95em] font-bold">
										{m.paynow_scan_title()}
									</span>
									<span className="text-[0.85em] text-slate-500">
										{m.paynow_scan_body()}
									</span>
								</div>
							) : (
								<div className="grid h-full grid-cols-2 gap-[0.6em]">
									{METHODS.map((method, i) => (
										<span
											key={method.id}
											className={cn(
												"flex flex-col items-start justify-between rounded-[1.1em] border-2 p-[0.8em] text-[0.85em] font-semibold",
												i === 0
													? "border-accent bg-accent/[0.06]"
													: "border-slate-200 bg-white",
											)}
										>
											<AppImage
												src={method.src}
												alt=""
												aspect="h-[1.6em] w-auto"
												fill={false}
											/>
											{method.label()}
										</span>
									))}
								</div>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

function SellerCard({ beat, still }: { beat: number; still: boolean }) {
	const paid = still || beat >= PAID_BEAT;
	const pop = still ? "" : "animate-kp-card-in";

	return (
		<div className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-[1.8em] border border-border bg-card p-[1.4em] text-left shadow-xl shadow-primary/10 @[30rem]:self-stretch">
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
					<span
						key={paid ? "confirmed" : "pending"}
						className={cn(
							"whitespace-nowrap rounded-full px-[0.8em] py-[0.3em] text-[0.8em] font-semibold",
							paid
								? "bg-blue-100 text-blue-800"
								: "bg-orange-100 text-orange-800",
							paid && !still && "animate-kp-pop",
						)}
					>
						{paid
							? m.handshake_seller_confirmed()
							: m.handshake_seller_pending()}
					</span>
				</span>
			</div>

			<div className="relative mt-[1.2em] h-[20.5em]">
				{paid ? (
					<div key="paid" className={cn("flex flex-col gap-[0.9em]", pop)}>
						<div className="flex flex-col gap-[0.7em] rounded-[1.1em] border border-emerald-300 bg-emerald-50 p-[1em] dark:bg-emerald-950/30">
							<div className="flex items-center justify-between gap-[0.5em]">
								<span className="flex items-center gap-[0.35em] rounded-full bg-emerald-100 px-[0.8em] py-[0.3em] text-[0.9em] font-bold text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300">
									<Check className="size-[1em]" strokeWidth={3} />
									{m.paynow_seller_paid()}
								</span>
								<span className="text-[0.8em] text-emerald-800 dark:text-emerald-300">
									{m.paynow_seller_paid_meta()}
								</span>
							</div>
							<span className="text-[0.9em] leading-snug text-emerald-900/80 dark:text-emerald-200/80">
								{m.paynow_seller_body()}
							</span>
							<span className="text-[0.9em] leading-snug text-emerald-900/80 dark:text-emerald-200/80">
								{m.handshake_seller_receipt_line()}
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
					<div key="unpaid" className={cn("flex flex-col gap-[0.9em]", pop)}>
						<div className="rounded-[1.1em] border border-border bg-muted/50 p-[1em]">
							<span className="block text-[1em] font-bold text-muted-foreground">
								{m.handshake_seller_unpaid_title()}
							</span>
							<span className="mt-[0.3em] block text-[0.9em] leading-snug text-muted-foreground">
								{m.paynow_seller_waiting()}
							</span>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

/**
 * The two panes, beat passed in — the walkthrough owns the clock and the
 * decorative frame. Same container rules as `HandshakePanes`.
 */
export function PayNowPanes({ beat, still }: { beat: number; still: boolean }) {
	const storyBeat = still ? PAID_BEAT : beat;
	return (
		<div className="@container w-full">
			<div className="flex flex-col items-stretch gap-[1.6em] text-[10px] @[30rem]:flex-row @[30rem]:items-end @[30rem]:gap-[2.4em] @[30rem]:text-[clamp(8.5px,1.85cqw,11px)]">
				<BuyerPhone beat={storyBeat} still={still} />
				<SellerCard beat={storyBeat} still={still} />
			</div>
		</div>
	);
}
