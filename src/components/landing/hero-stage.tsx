import { useInView, useReducedMotion } from "framer-motion";
import { BarChart3, Home, Inbox, QrCode, Truck } from "lucide-react";
import { useRef } from "react";
import { useBeatLoop } from "../../hooks/useBeatLoop";
import { cn } from "../../lib/utils";
import { m } from "../../paraglide/messages";
import { WhatsAppIcon } from "../dashboard/brand-icons";

/**
 * The hero's before/after motion stage (landing v2, z8r3fdegej — design
 * approved 12 Sep 2026). A navy 16:9 stage under the hero copy: on the left a
 * WhatsApp inbox with orders buried under climbing unread chats and a
 * "Missed · RM 181" stamp; on the right the Kedaipal Orders inbox, where the
 * same order walks Pending → Buyer marked paid → Confirmed · Paid → Shipped ·
 * J&T with a toast per step. RM 181 is the best seller's real average ticket
 * (COMPANY_STATE, 8 Sep) — one missed order costs more than the subscription.
 *
 * CSS only, on purpose (Lighthouse AC — no video, no 3D, no framer springs):
 * a beat counter flips classes and `transition-*` does the rest; a keyed
 * remount replays the `kp-pop` keyframe on the badge, stamp and toast.
 * `useInView` + the hidden-tab guard in `useBeatLoop` stop the clock
 * off-screen; reduced motion renders the FINAL frame as a still.
 *
 * Everything inside the stage is sized in container-query units off the
 * stage's own width/height (`@container` + `cqw`/`cqh`), so the composition
 * scales with the stage instead of overflowing it at `md` (the phone must sit
 * fully inside the frame at 390 and 1280 — verified by screenshot, not
 * assumed). Below `md` the stage is 3:4 and shows the Kedaipal inbox only, at
 * roughly 2.5× the desktop scale so the type stays legible, with the mint
 * "After" pill centred above the phone.
 *
 * The mock is decorative (`aria-hidden`); `hero_stage_alt` is the
 * machine-readable copy of what it shows.
 */

/** Beat holds, ms: pending → buyer paid → confirmed → shipped → hold. */
const BEATS = [1500, 1700, 1700, 2600, 500] as const;

/** Unread count on the WhatsApp side, per beat — it only ever climbs. */
const UNREAD = [12, 27, 43, 61, 61] as const;

/** Real dashboard status-badge colours (`status-badge.tsx`), light values —
 *  the phone screen is a light surface in both page themes. */
const STATUS = [
	{ label: () => m.hero_after_status_1(), className: "bg-orange-100 text-orange-800" },
	{ label: () => m.hero_after_status_2(), className: "bg-amber-100 text-amber-800" },
	{ label: () => m.hero_after_status_3(), className: "bg-blue-100 text-blue-800" },
	{ label: () => m.hero_after_status_4(), className: "bg-purple-100 text-purple-800" },
] as const;

const TOASTS = [null, () => m.hero_after_toast_2(), () => m.hero_after_toast_3(), () => m.hero_after_toast_4()] as const;

const CHATS = [
	{ name: () => m.hero_before_name_1(), msg: () => m.hero_before_msg_1(), time: "09:41", buried: true },
	{ name: () => m.hero_before_name_2(), msg: () => m.hero_before_msg_2(), time: "09:38" },
	{ name: () => m.hero_before_name_3(), msg: () => m.hero_before_msg_3(), time: "09:15" },
	{ name: () => m.hero_before_name_4(), msg: () => m.hero_before_msg_4(), time: "08:52" },
] as const;

function initials(name: string): string {
	return name.trim().slice(0, 1).toUpperCase();
}

function BeforeCard({ step }: { step: number }) {
	const unread = UNREAD[step] ?? UNREAD[UNREAD.length - 1];
	const missed = step >= 2;
	return (
		<div className="relative">
			<span className="absolute -top-[1.6em] left-0 z-10 rounded-full bg-white px-[1em] py-[0.45em] text-[0.8em] font-bold uppercase tracking-wider text-slate-800 shadow-md">
				{m.hero_before_label()}
			</span>
			<div className="w-[36cqw] rotate-[-2deg] overflow-hidden rounded-[1.4em] bg-white text-left text-slate-800 shadow-2xl">
				<div className="flex items-center justify-between bg-[#075E54] px-[1.2em] py-[0.9em] text-white">
					<span className="flex items-center gap-[0.5em] text-[1.05em] font-bold">
						<WhatsAppIcon className="size-[1.2em]" />
						{m.hero_before_inbox()}
					</span>
					<span
						key={unread}
						className="animate-kp-pop rounded-full bg-red-500 px-[0.7em] py-[0.15em] text-[0.8em] font-bold text-white"
					>
						{unread} {m.hero_before_unread()}
					</span>
				</div>
				<ul className="divide-y divide-slate-100">
					{CHATS.map((chat) => (
						<li key={chat.time} className="flex items-center gap-[0.8em] px-[1.1em] py-[0.8em]">
							<span className="flex size-[2.4em] shrink-0 items-center justify-center rounded-full bg-slate-200 text-[0.9em] font-bold text-slate-600">
								{initials(chat.name())}
							</span>
							<span className="flex min-w-0 grow flex-col">
								<span className="flex items-baseline justify-between gap-[0.5em]">
									<span className="truncate text-[0.95em] font-semibold">{chat.name()}</span>
									<span className="shrink-0 text-[0.7em] text-slate-400">{chat.time}</span>
								</span>
								<span className="truncate text-[0.85em] text-slate-500">{chat.msg()}</span>
							</span>
							<span className="size-[0.6em] shrink-0 rounded-full bg-[#25D366]" />
						</li>
					))}
				</ul>
			</div>
			{missed ? (
				<span
					key="missed"
					className="animate-kp-pop absolute -right-[1.5em] bottom-[2.2em] rotate-[-6deg] rounded-[0.6em] bg-destructive px-[0.9em] py-[0.45em] text-[0.85em] font-bold uppercase tracking-wider text-destructive-foreground shadow-lg"
				>
					{m.hero_before_missed()}
				</span>
			) : null}
		</div>
	);
}

function AfterPhone({ step }: { step: number }) {
	const status = STATUS[Math.min(step, STATUS.length - 1)];
	const toast = TOASTS[Math.min(step, TOASTS.length - 1)];
	return (
		<div className="relative">
			<span className="absolute -top-[1.6em] left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-accent px-[1em] py-[0.45em] text-[0.8em] font-bold uppercase tracking-wider text-accent-foreground shadow-md md:left-0 md:translate-x-0">
				{m.hero_after_label()}
			</span>
			{/* Device shell — the same body the old hero phone wore, scaled in em. */}
			<div className="relative w-[19em] rounded-[2.6em] bg-slate-950 p-[0.55em] shadow-[0_44px_80px_-24px_hsl(222_47%_11%_/_0.5)] ring-1 ring-white/15">
				<div className="relative flex h-[36em] flex-col overflow-hidden rounded-[2.1em] bg-slate-50 text-left text-slate-800">
					{/* Status bar + dynamic island */}
					<div className="flex items-center justify-between px-[1.4em] pt-[0.8em] text-[0.7em] font-semibold">
						<span>9:41</span>
						<span className="absolute left-1/2 top-[0.7em] h-[1.5em] w-[5.5em] -translate-x-1/2 rounded-full bg-slate-950" />
						<span>●●●</span>
					</div>
					{/* App header — the dashboard's own store line + title */}
					<div className="mt-[1.1em] flex items-end justify-between px-[1.2em]">
						<span className="flex flex-col">
							<span className="text-[0.65em] font-medium text-slate-500">{m.hero_after_store()}</span>
							<span className="text-[1.25em] font-bold leading-tight tracking-tight">{m.hero_after_inbox()}</span>
						</span>
						<span className="flex size-[2em] items-center justify-center rounded-full bg-accent text-[0.7em] font-bold text-accent-foreground">
							KA
						</span>
					</div>
					{/* Status chips — the inbox's filter row, first one active */}
					<div className="mt-[0.8em] flex gap-[0.4em] overflow-hidden px-[1.2em] text-[0.62em] font-semibold">
						<span className="whitespace-nowrap rounded-full bg-slate-900 px-[1em] py-[0.4em] text-white">
							{m.hero_after_chip_all()}
						</span>
						{[m.hero_after_chip_new(), m.hero_after_chip_progress(), m.hero_after_chip_done()].map((chip) => (
							<span key={chip} className="whitespace-nowrap rounded-full border border-slate-200 bg-white px-[1em] py-[0.4em] text-slate-600">
								{chip}
							</span>
						))}
					</div>
					{/* The live order card */}
					<div className="mx-[1em] mt-[0.9em] rounded-[1em] border-2 border-accent/60 bg-white p-[0.9em] shadow-sm">
						<div className="flex items-start justify-between gap-[0.6em]">
							<span className="min-w-0 truncate text-[0.9em] font-semibold">{m.hero_after_order()}</span>
							<span className="shrink-0 whitespace-nowrap text-[0.9em] font-bold">{m.hero_after_amount()}</span>
						</div>
						<span className="mt-[0.15em] block truncate text-[0.7em] text-slate-500">{m.hero_after_order_meta()}</span>
						<div className="mt-[0.7em] flex items-center justify-between">
							<span
								key={status.label()}
								className={cn(
									"animate-kp-pop inline-block rounded-full px-[0.8em] py-[0.3em] text-[0.72em] font-semibold",
									status.className,
								)}
							>
								{status.label()}
							</span>
							{step >= 3 ? (
								<Truck className="size-[1.1em] text-purple-700" />
							) : (
								<WhatsAppIcon className="size-[1.1em] text-[#25D366]" />
							)}
						</div>
					</div>
					{/* Two settled orders beneath it, so the inbox reads as a working
					    day and not a demo with one row. */}
					{(
						[
							[m.hero_after_row_2_title(), m.hero_after_row_2_meta(), m.hero_after_row_2_amount(), m.hero_after_row_2_status(), "bg-blue-100 text-blue-800"],
							[m.hero_after_row_3_title(), m.hero_after_row_3_meta(), m.hero_after_row_3_amount(), m.hero_after_row_3_status(), "bg-blue-100 text-blue-800"],
						] as const
					).map(([title, meta, amount, rowStatus, tone]) => (
						<div key={title} className="mx-[1em] mt-[0.6em] rounded-[1em] border border-slate-200 bg-white p-[0.9em]">
							<div className="flex items-start justify-between gap-[0.6em]">
								<span className="min-w-0 truncate text-[0.9em] font-semibold">{title}</span>
								<span className="shrink-0 whitespace-nowrap text-[0.9em] font-bold">{amount}</span>
							</div>
							<span className="mt-[0.15em] block truncate text-[0.7em] text-slate-500">{meta}</span>
							<span className={cn("mt-[0.6em] inline-block rounded-full px-[0.8em] py-[0.3em] text-[0.72em] font-semibold", tone)}>
								{rowStatus}
							</span>
						</div>
					))}
					{/* Toast */}
					<div className="pointer-events-none absolute inset-x-[1em] top-[21em] flex justify-center">
						{toast ? (
							<span
								key={toast()}
								className="animate-kp-pop flex items-center gap-[0.5em] rounded-full bg-slate-900 px-[1em] py-[0.55em] text-[0.75em] font-semibold text-white shadow-lg"
							>
								<span className="size-[0.5em] rounded-full bg-accent" />
								{toast()}
							</span>
						) : null}
					</div>
					{/* Bottom tabs — the dashboard's bottom-nav labels */}
					<div className="mt-auto flex items-center justify-around border-t border-slate-200 bg-white px-[0.5em] pb-[0.9em] pt-[0.6em] text-[0.6em] font-semibold text-slate-400">
						{(
							[
								[Home, "Home", false],
								[Inbox, "Orders", true],
								[QrCode, "Counter", false],
								[BarChart3, "Insights", false],
							] as const
						).map(([Icon, label, active]) => (
							<span
								key={label}
								className={cn("flex flex-col items-center gap-[0.3em]", active && "text-accent-emphasis")}
							>
								<Icon className="size-[1.7em]" />
								{label}
							</span>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

export function HeroStage() {
	const shouldReduceMotion = useReducedMotion();
	const stageRef = useRef<HTMLDivElement>(null);
	const inView = useInView(stageRef, { margin: "-10% 0px" });
	const beat = useBeatLoop(!shouldReduceMotion && inView, BEATS);
	// Reduced motion: the last beat, still.
	const step = shouldReduceMotion ? STATUS.length - 1 : Math.min(beat, STATUS.length - 1);

	return (
		<div ref={stageRef} className="relative">
			<p className="sr-only">{m.hero_stage_alt()}</p>
			{/* `@container` makes cqw/cqh resolve against the stage. The phone's
			    font-size is the one knob: every inner size is in em, so on a phone
			    (3:4, ~2.5× scale, inbox only) and on desktop (16:9, both halves) the
			    same markup fits its frame. */}
			<div
				aria-hidden="true"
				className="@container relative aspect-[3/4] w-full overflow-hidden rounded-[2rem] bg-primary shadow-2xl shadow-primary/25 md:aspect-video md:rounded-[2.5rem]"
			>
				<div
					aria-hidden
					className="pointer-events-none absolute -left-[10%] top-[10%] size-[55cqw] rounded-full bg-accent/10 blur-3xl md:size-[40cqw]"
				/>
				<div className="absolute inset-0 flex items-start justify-center pt-[15cqw] text-left md:items-center md:justify-center md:gap-[5cqw] md:pt-0">
					<div className="hidden text-[1.25cqw] md:mt-[3cqw] md:block">
						<BeforeCard step={step} />
					</div>
					{/* Phone: on a phone it is ~2.5× the desktop scale and its bottom is
					    clipped by the stage on purpose (inbox + toasts are the story);
					    on md+ the whole device sits inside the frame. */}
					<div className="text-[3.6cqw] md:text-[1.3cqw]">
						<AfterPhone step={step} />
					</div>
				</div>
			</div>
		</div>
	);
}
