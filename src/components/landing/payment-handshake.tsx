import { useInView, useReducedMotion } from "framer-motion";
import { Check, Download, ImagePlus } from "lucide-react";
import { useRef } from "react";
import { useBeatLoop } from "../../hooks/useBeatLoop";
import { cn } from "../../lib/utils";
import { m } from "../../paraglide/messages";
import { WhatsAppIcon } from "../dashboard/brand-icons";
import { FadeIn } from "./fade-in";
import { Eyebrow } from "./landing-ui";

/**
 * "The payment handshake" — the landing section for universal pain #2
 * (chasing "dah transfer" screenshots). Left: claim + proof bullets.
 * Right: the flow ACTED OUT on loop, as it really runs since 4 Aug 2026
 * (docs/one-message-per-order.md, docs/payment-handshake.md): the buyer is
 * never messaged after checkout — they pay from **How to pay** on their order
 * page, tap **I've paid**, attach the (mandatory, z8r3fdnpxf) screenshot and
 * submit; the seller's order flips to an amber **Payment claimed** card with
 * the screenshot and reference (plus a WhatsApp to the SELLER on Pro), taps
 * **Mark payment received**, and both sides flip to green — the buyer's page
 * live, receipt PDF on it, no WhatsApp sent. The previous mock told the
 * pre-August story (a chat bubble, a "✅ Payment received" message and a
 * receipt link that no longer exist), corrected on the 15 Oct 2026 canvas
 * (artboard 4 + M4).
 *
 * Two panes, buyer phone beside the seller's order card, side by side from a
 * 30rem-wide column and stacked below it (a 390 phone can't hold both at a
 * legible size). CSS only, like the hero stage: `useBeatLoop` flips a beat
 * index, keyed remounts replay the `kp-*` keyframes, `transition-*` classes
 * do the rest. The clock only runs on a visible tab with the mock in view;
 * reduced motion renders the LAST story beat as a still. Every pane has a
 * fixed height so beats never shift the page (the buried-chats lesson), and
 * the frame is never blank on beat 0 — the first beat IS a state. The mock is
 * decorative (`aria-hidden`); the copy column carries the content.
 */

/**
 * Beat holds, ms, on the M4 timeline: idle → tap "I've paid" (1.2 s) → the
 * screenshot lands (2.0 s) → Submit (3.2 s) → the seller taps (5.0 s) → both
 * sides flip (5.6 s) → fade (7.5 s), 8 s a loop.
 */
export const HANDSHAKE_BEATS = [1200, 800, 1200, 1800, 600, 1900, 500] as const;
/** The beat both sides read "Payment received" (the reduced-motion still). */
export const RECEIVED_BEAT = 5;
const RESET_BEAT = 6;

type BuyerState = "pay" | "waiting" | "received";
type SellerState = "unpaid" | "claimed" | "received";

function buyerStateAt(beat: number): BuyerState {
	if (beat >= RECEIVED_BEAT) return "received";
	if (beat >= 3) return "waiting";
	return "pay";
}

function sellerStateAt(beat: number): SellerState {
	if (beat >= RECEIVED_BEAT) return "received";
	if (beat >= 3) return "claimed";
	return "unpaid";
}

/** A simulated tap: the button presses and a ring blooms off it. */
function TapRing() {
	return (
		<span
			aria-hidden
			className="animate-kp-ring pointer-events-none absolute inset-0 rounded-full border-2 border-accent"
		/>
	);
}

/** The buyer's bank-transfer screenshot, as a thumbnail. */
function ProofThumb({ className }: { className?: string }) {
	return (
		<span
			className={cn(
				"flex shrink-0 flex-col items-center justify-end rounded-[0.4em] border border-emerald-300 bg-gradient-to-b from-emerald-50 to-emerald-200 pb-[0.3em] text-[0.7em] font-bold text-emerald-800",
				className,
			)}
		>
			{m.handshake_amount()}
		</span>
	);
}

function PaneLabel({ children }: { children: string }) {
	return (
		<span className="text-[0.8em] font-bold uppercase tracking-[0.1em] text-slate-500">
			{children}
		</span>
	);
}

function BuyerPhone({ beat, still }: { beat: number; still: boolean }) {
	const state = still ? "received" : buyerStateAt(beat);
	const sheetOpen = !still && (beat === 1 || beat === 2);
	const attached = still || beat >= 2;
	const tapPaid = !still && beat === 1;
	const tapSubmit = !still && beat === 3;
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

				{/* The state area is a fixed box so the three states never resize
				    the phone. Only the current one is mounted; its mount pops it. */}
				<div className="relative mt-[1em] h-[20em]">
					{state === "pay" ? (
						<div key="pay" className={cn("flex flex-col gap-[0.8em]", pop)}>
							<span className="text-[1.05em] font-bold">
								{m.handshake_how_to_pay()}
							</span>
							<div className="flex items-center justify-between gap-[0.6em] rounded-[1.1em] border border-slate-200 bg-white px-[1em] py-[0.9em]">
								<span className="flex flex-col">
									<span className="text-[1em] font-semibold">
										{m.handshake_bank_name()}
									</span>
									<span className="text-[0.9em] text-slate-500">
										{m.handshake_bank_account()}
									</span>
								</span>
								<span className="rounded-full border border-slate-200 px-[0.8em] py-[0.35em] text-[0.8em] font-bold">
									{m.handshake_copy()}
								</span>
							</div>
							<div className="flex items-center justify-between gap-[0.6em] rounded-[1.1em] border border-slate-200 bg-white px-[1em] py-[0.9em]">
								<span className="flex items-center gap-[0.7em]">
									<span
										aria-hidden
										className="size-[2.4em] rounded-[0.5em] bg-slate-900 [background-image:repeating-linear-gradient(90deg,transparent_0_0.3em,white_0.3em_0.6em),repeating-linear-gradient(0deg,transparent_0_0.3em,white_0.3em_0.6em)]"
									/>
									<span className="text-[1em] font-semibold">
										{m.handshake_qr()}
									</span>
								</span>
								<span className="rounded-full border border-slate-200 px-[0.8em] py-[0.35em] text-[0.8em] font-bold">
									{m.handshake_save_qr()}
								</span>
							</div>
							<span className="text-[0.85em] leading-snug text-slate-500">
								{m.handshake_reference_hint()}
							</span>
							<span
								className={cn(
									"relative mt-[0.3em] flex h-[3.6em] items-center justify-center rounded-full bg-accent text-[1.1em] font-bold text-accent-foreground",
									tapPaid && "animate-kp-press",
								)}
							>
								{tapPaid ? <TapRing /> : null}
								{m.handshake_ive_paid()}
							</span>
						</div>
					) : null}

					{state === "waiting" ? (
						<div key="waiting" className={cn("flex flex-col gap-[0.8em]", pop)}>
							<div className="rounded-[1.1em] border border-amber-300 bg-amber-50 p-[1em]">
								<span className="block text-[1.05em] font-bold text-amber-800">
									{m.handshake_buyer_waiting_title()}
								</span>
								<span className="mt-[0.3em] block text-[0.9em] leading-snug text-amber-900/80">
									{m.handshake_buyer_waiting_body()}
								</span>
							</div>
							<div className="flex items-center gap-[0.8em] rounded-[1.1em] border border-slate-200 bg-white px-[1em] py-[0.9em]">
								<ProofThumb className="h-[4em] w-[3em]" />
								<span className="flex flex-col text-[0.9em] text-slate-500">
									{m.handshake_buyer_proof_line()}
									<span className="font-semibold text-accent-emphasis">
										{m.handshake_buyer_add_another()}
									</span>
								</span>
							</div>
						</div>
					) : null}

					{state === "received" ? (
						<div
							key="received"
							className={cn("flex flex-col gap-[0.8em]", pop)}
						>
							<div className="rounded-[1.1em] border border-emerald-300 bg-emerald-50 p-[1em]">
								<span className="flex items-center gap-[0.4em] text-[1.05em] font-bold text-emerald-800">
									<Check className="size-[1em] shrink-0" strokeWidth={3} />
									{m.handshake_buyer_received_title()}
								</span>
								<span className="mt-[0.3em] block text-[0.9em] leading-snug text-emerald-900/80">
									{m.handshake_buyer_received_body()}
								</span>
							</div>
							<span className="flex h-[3.4em] items-center justify-center gap-[0.5em] rounded-full border border-slate-200 bg-white text-[1em] font-bold">
								<Download className="size-[1.1em]" />
								{m.handshake_buyer_receipt()}
							</span>
							<span className="text-[0.9em] text-slate-500">
								{m.handshake_buyer_status()}
							</span>
						</div>
					) : null}
				</div>

				{/* The "I've paid" sheet — screenshot first, submit held until it has
				    landed (docs/payment-handshake.md §Proof is mandatory). Slides up
				    on the tap, down on submit (the press plays first, so the close
				    waits 200 ms). */}
				<div
					className={cn(
						"absolute inset-x-0 bottom-0 flex flex-col gap-[0.8em] rounded-t-[1.6em] bg-white p-[1.2em] shadow-[0_-12px_30px_hsl(222_47%_11%_/_0.18)] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
						sheetOpen ? "translate-y-0" : "translate-y-[105%] delay-200",
					)}
				>
					<span className="h-[0.4em] w-[3.2em] self-center rounded-full bg-slate-200" />
					<span className="text-[1.1em] font-bold">
						{m.handshake_ive_paid()}
					</span>
					<div className="h-[7em]">
						{attached ? (
							<div
								key="attached"
								className={cn(
									"flex h-full items-center gap-[1em] rounded-[1.1em] border border-slate-200 p-[0.8em]",
									!still && "animate-kp-pop",
								)}
							>
								<ProofThumb className="h-[5.2em] w-[3.8em]" />
								<span className="flex flex-col gap-[0.2em] text-[0.95em]">
									<span className="font-semibold">
										{m.handshake_sheet_attached()}
									</span>
									<span className="font-semibold text-accent-emphasis">
										{m.handshake_sheet_replace()}
									</span>
								</span>
							</div>
						) : (
							<div className="flex h-full flex-col items-center justify-center gap-[0.3em] rounded-[1.1em] border-2 border-dashed border-slate-300 p-[0.6em] text-center text-[0.9em] text-slate-500">
								<ImagePlus className="size-[1.4em] text-slate-400" />
								<span className="font-bold text-slate-800">
									{m.handshake_sheet_attach_title()}
								</span>
								<span>{m.handshake_sheet_attach_hint()}</span>
							</div>
						)}
					</div>
					<div className="flex flex-col gap-[0.2em] rounded-[0.9em] border border-slate-200 px-[1em] py-[0.7em]">
						<span className="text-[0.8em] text-slate-500">
							{m.handshake_sheet_reference_label()}
						</span>
						<span className="text-[1em] font-semibold">
							{m.handshake_order_id()}
						</span>
					</div>
					{attached ? (
						<span
							className={cn(
								"relative flex h-[3.4em] items-center justify-center rounded-full bg-accent text-[1.1em] font-bold text-accent-foreground",
								tapSubmit && "animate-kp-press",
							)}
						>
							{tapSubmit ? <TapRing /> : null}
							{m.handshake_sheet_submit()}
						</span>
					) : (
						// Disabled-with-reason, the real sheet's rule: the submit says
						// why it is held, beside it, before the tap.
						<span className="flex h-[3.4em] items-center justify-center rounded-full bg-slate-100 px-[1em] text-center text-[0.9em] font-bold leading-tight text-slate-400">
							{m.handshake_sheet_submit_blocked()}
						</span>
					)}
				</div>
			</div>
		</div>
	);
}

function SellerCard({ beat, still }: { beat: number; still: boolean }) {
	const state = still ? "received" : sellerStateAt(beat);
	const tapMark = !still && beat === 4;
	// The Pro seller alert rides the claim beat only: it drops in with the
	// claim and lifts off as the seller reaches for the button.
	const alert = !still && beat === 3;
	const pop = still ? "" : "animate-kp-card-in";
	const confirmed = state === "received";

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
					{/* Real dashboard status-badge colours (`status-badge.tsx`). */}
					<span
						key={confirmed ? "confirmed" : "pending"}
						className={cn(
							"whitespace-nowrap rounded-full px-[0.8em] py-[0.3em] text-[0.8em] font-semibold",
							confirmed
								? "bg-blue-100 text-blue-800"
								: "bg-orange-100 text-orange-800",
							confirmed && !still && "animate-kp-pop",
						)}
					>
						{confirmed
							? m.handshake_seller_confirmed()
							: m.handshake_seller_pending()}
					</span>
				</span>
			</div>

			{/* Fixed box, same reason as the phone's. */}
			<div className="relative mt-[1.2em] h-[20.5em]">
				{state === "unpaid" ? (
					<div key="unpaid" className={cn("flex flex-col gap-[0.9em]", pop)}>
						<div className="rounded-[1.1em] border border-border bg-muted/50 p-[1em]">
							<span className="block text-[1em] font-bold text-muted-foreground">
								{m.handshake_seller_unpaid_title()}
							</span>
							<span className="mt-[0.3em] block text-[0.9em] leading-snug text-muted-foreground">
								{m.handshake_seller_unpaid_body()}
							</span>
						</div>
						<div className="flex gap-[0.6em]">
							<span className="flex h-[3.2em] flex-1 items-center justify-center rounded-full border border-border text-[0.95em] font-bold">
								{m.handshake_seller_mark_received()}
							</span>
							<span className="flex h-[3.2em] items-center justify-center rounded-full border border-border px-[1em] text-[0.9em] font-semibold text-muted-foreground">
								{m.handshake_seller_send_reminder()}
							</span>
						</div>
					</div>
				) : null}

				{state === "claimed" ? (
					<div key="claimed" className={cn("flex flex-col gap-[0.9em]", pop)}>
						<div className="flex flex-col gap-[0.7em] rounded-[1.1em] border border-amber-300 bg-amber-50 p-[1em] dark:bg-amber-950/30">
							<div className="flex items-center justify-between gap-[0.5em]">
								{/* Breathes while it waits for the seller — settles once tapped. */}
								<span
									className={cn(
										"rounded-full bg-amber-100 px-[0.8em] py-[0.3em] text-[0.9em] font-bold text-amber-700 dark:bg-amber-900/60 dark:text-amber-300",
										!still && !tapMark && "animate-kp-breathe",
									)}
								>
									{m.handshake_seller_claimed()}
								</span>
								<span className="text-[0.8em] text-amber-800 dark:text-amber-300">
									{m.handshake_seller_just_now()}
								</span>
							</div>
							<div className="flex gap-[0.8em]">
								<ProofThumb className="h-[6.4em] w-[4.8em]" />
								<span className="flex min-w-0 flex-col gap-[0.4em] text-[0.9em]">
									<span className="flex flex-wrap items-center gap-x-[0.4em] gap-y-[0.2em]">
										<span className="text-muted-foreground">
											{m.handshake_seller_reference()}
										</span>
										<strong>{m.handshake_order_id()}</strong>
										<span className="rounded-full border border-border bg-card px-[0.5em] py-[0.1em] text-[0.8em] font-bold">
											{m.handshake_copy()}
										</span>
									</span>
									<span>
										<span className="text-muted-foreground">
											{m.handshake_seller_method()}
										</span>{" "}
										{m.handshake_seller_method_value()}
									</span>
									<span className="leading-snug text-muted-foreground">
										{m.handshake_seller_check_bank()}
									</span>
								</span>
							</div>
						</div>
						<div className="flex gap-[0.6em]">
							<span
								className={cn(
									"relative flex h-[3.4em] flex-1 items-center justify-center rounded-full bg-accent text-[1em] font-bold text-accent-foreground",
									tapMark && "animate-kp-press",
								)}
							>
								{tapMark ? <TapRing /> : null}
								{m.handshake_seller_mark_received()}
							</span>
							<span className="flex h-[3.4em] items-center justify-center rounded-full border border-border px-[1em] text-[0.9em] font-semibold text-muted-foreground">
								{m.handshake_seller_not_received()}
							</span>
						</div>
					</div>
				) : null}

				{state === "received" ? (
					<div key="received" className={cn("flex flex-col gap-[0.9em]", pop)}>
						<div className="flex flex-col gap-[0.7em] rounded-[1.1em] border border-emerald-300 bg-emerald-50 p-[1em] dark:bg-emerald-950/30">
							<div className="flex items-center justify-between gap-[0.5em]">
								<span className="flex items-center gap-[0.35em] rounded-full bg-emerald-100 px-[0.8em] py-[0.3em] text-[0.9em] font-bold text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300">
									<Check className="size-[1em]" strokeWidth={3} />
									{m.handshake_seller_received()}
								</span>
								<span className="text-[0.8em] text-emerald-800 dark:text-emerald-300">
									{m.handshake_seller_auto_confirmed()}
								</span>
							</div>
							<div className="flex items-center gap-[0.8em] rounded-[0.9em] border border-border bg-card p-[0.7em]">
								<ProofThumb className="h-[3.6em] w-[2.8em]" />
								<span className="flex flex-col gap-[0.15em] text-[0.9em]">
									<span className="font-semibold">
										{m.handshake_seller_proof_title()}
									</span>
									<span className="text-muted-foreground">
										{m.handshake_seller_proof_meta()}
									</span>
								</span>
							</div>
							<span className="text-[0.9em] leading-snug text-emerald-900/80 dark:text-emerald-200/80">
								{m.handshake_seller_receipt_line()}
							</span>
						</div>
						{/* The point of the section, said on the frame it is true. */}
						<span
							className={cn(
								"flex items-start gap-[0.7em] rounded-[1em] bg-primary px-[1em] py-[0.8em] text-[0.9em] font-semibold leading-snug text-primary-foreground",
								!still && "animate-kp-toast-in [animation-delay:250ms]",
							)}
						>
							<span className="mt-[0.35em] size-[0.6em] shrink-0 rounded-full bg-accent" />
							{m.handshake_caption()}
						</span>
					</div>
				) : null}
			</div>

			{/* The seller's own WhatsApp alert (Pro) — the ONE message in this
			    story, and it goes to the seller, not the buyer. */}
			<div
				className={cn(
					"pointer-events-none absolute inset-x-[1.2em] top-[1em] flex items-center gap-[0.8em] rounded-[1em] bg-slate-900 px-[1em] py-[0.8em] text-[0.9em] text-white shadow-2xl ring-1 ring-white/15 transition-all duration-300 ease-out motion-reduce:transition-none",
					alert ? "translate-y-0 opacity-100" : "-translate-y-[1em] opacity-0",
				)}
			>
				<WhatsAppIcon className="size-[1.4em] shrink-0 text-[#25D366]" />
				<span className="flex min-w-0 flex-col">
					<span className="text-[0.75em] uppercase tracking-[0.08em] text-white/60">
						{m.handshake_alert_label()}
					</span>
					<span className="truncate font-semibold">
						{m.handshake_alert_body()}
					</span>
				</span>
			</div>
		</div>
	);
}

function HandshakePlay() {
	const shouldReduceMotion = useReducedMotion();
	const stageRef = useRef<HTMLDivElement>(null);
	const inView = useInView(stageRef, { margin: "-10% 0px" });
	const beat = useBeatLoop(!shouldReduceMotion && inView, HANDSHAKE_BEATS);
	const still = Boolean(shouldReduceMotion);
	const storyBeat = still ? RECEIVED_BEAT : beat;
	const resetting = !still && beat === RESET_BEAT;

	return (
		// `@container` so the panes size off the column they are given: side by
		// side with em = a slice of the width from 30rem, stacked at a fixed em
		// below it. Both panes are fixed-height, so the mock holds one height per
		// layout and the beats never move the page.
		<div ref={stageRef} aria-hidden="true" className="@container w-full">
			<div
				className={cn(
					"flex flex-col items-stretch gap-[1.6em] text-[10px] transition-opacity duration-300 motion-reduce:transition-none @[30rem]:flex-row @[30rem]:items-end @[30rem]:gap-[2.4em] @[30rem]:text-[clamp(8.5px,1.85cqw,11px)]",
					resetting ? "opacity-0" : "opacity-100",
				)}
			>
				<BuyerPhone beat={storyBeat} still={still} />
				<SellerCard beat={storyBeat} still={still} />
			</div>
		</div>
	);
}

export function PaymentHandshake() {
	const points = [
		m.handshake_point_1(),
		m.handshake_point_2(),
		m.handshake_point_3(),
	];

	return (
		<section aria-labelledby="handshake-heading" className="bg-background">
			<div className="mx-auto max-w-6xl px-5 py-20 md:px-8 md:py-32">
				{/* The mock column gets the wider half: two panes need the room, and
				    the copy column reads fine at 45%. */}
				<div className="grid items-center gap-12 md:grid-cols-[0.9fr_1.1fr] md:gap-12 lg:gap-16">
					<FadeIn>
						<Eyebrow>{m.handshake_label()}</Eyebrow>
						<h2
							id="handshake-heading"
							className="mt-4 text-3xl font-bold leading-[1.08] md:text-5xl"
							style={{ letterSpacing: "-0.02em" }}
						>
							{m.handshake_heading()}
						</h2>
						<p className="mt-4 text-base leading-relaxed text-muted-foreground md:text-lg">
							{m.handshake_body_1()}{" "}
							<strong className="font-semibold text-foreground">
								{m.handshake_body_strong()}
							</strong>{" "}
							{m.handshake_body_2()}
						</p>
						<ul className="mt-7 space-y-3.5">
							{points.map((point) => (
								<li
									key={point}
									className="flex gap-3 text-[15px] leading-relaxed text-foreground/80"
								>
									<Check className="mt-0.5 size-4 shrink-0 text-accent" />
									{point}
								</li>
							))}
						</ul>
						<p className="mt-6 text-[13px] text-muted-foreground">
							{m.handshake_note()}
						</p>
					</FadeIn>

					<FadeIn delay={0.15}>
						<HandshakePlay />
					</FadeIn>
				</div>
			</div>
		</section>
	);
}
