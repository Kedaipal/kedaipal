import { useInView, useReducedMotion } from "framer-motion";
import { BarChart3, Home, Inbox, QrCode, Truck } from "lucide-react";
import { useRef } from "react";
import { useBeatLoop } from "../../hooks/useBeatLoop";
import { cn } from "../../lib/utils";
import { m } from "../../paraglide/messages";
import { WhatsAppIcon } from "../dashboard/brand-icons";

/**
 * The hero's before/after motion stage (landing v2, z8r3fdegej — design
 * approved 12 Sep 2026). A navy 16:9 stage under the hero copy that acts out
 * one order twice:
 *
 * LEFT — WhatsApp alone. Aina's order sits at the top of the inbox; then a
 * school group and a supplier chat arrive above it, the unread count climbs
 * (12 → 27 → 43 → 61), her row sinks and dims, and a "Missed · RM 181" stamp
 * slams down on it. RM 181 is the best seller's real average ticket
 * (COMPANY_STATE, 8 Sep): one buried order costs more than the subscription.
 *
 * RIGHT — Kedaipal. The same order hands across the gap (a chip arcs from the
 * chat into the inbox), lands as a card, and walks Pending → Buyer marked
 * paid → Confirmed · Paid → Shipped · J&T with a toast per step, in the
 * dashboard's own `status-badge.tsx` colours over `bottom-nav.tsx` tabs.
 *
 * Six beats, then a short fade and the loop restarts. CSS only, on purpose
 * (Lighthouse AC — no video, no 3D, no per-frame JS): `useBeatLoop` flips a
 * beat index, keyed remounts replay the `kp-*` keyframes, `transition-*`
 * classes handle the rest. `useInView` + the hidden-tab guard stop the clock
 * off-screen; reduced motion renders the FINAL frame as a still.
 *
 * Everything inside the stage is sized in `em` off a root font-size set in
 * container-query units, so the composition scales with the stage instead of
 * overflowing it at `md` — the phone sits fully inside the frame at 390 and
 * 1280 (verified by screenshot). Below `md` the stage is 3:4 and shows the
 * Kedaipal inbox only, ~2.5× the desktop scale, mint "After" pill centred
 * above it; the chat side and the hand-off are desktop-only.
 *
 * Decorative (`aria-hidden`); `hero_stage_alt` is the machine-readable copy.
 */

/** Beat holds, ms: baseline → order arrives → paid → confirmed → shipped → fade. */
const BEATS = [1400, 1700, 1700, 1700, 2400, 420] as const;
const LAST_STORY_BEAT = 4;
const RESET_BEAT = 5;

/** Unread count on the WhatsApp side, per beat — it only ever climbs. */
const UNREAD = [12, 27, 43, 61, 61, 61] as const;

/** Real dashboard status-badge colours (`status-badge.tsx`), light values —
 *  the phone screen is a light surface in both page themes. Index = beat - 1. */
const STATUS = [
	{
		label: () => m.hero_after_status_1(),
		className: "bg-orange-100 text-orange-800",
	},
	{
		label: () => m.hero_after_status_2(),
		className: "bg-amber-100 text-amber-800",
	},
	{
		label: () => m.hero_after_status_3(),
		className: "bg-blue-100 text-blue-800",
	},
	{
		label: () => m.hero_after_status_4(),
		className: "bg-purple-100 text-purple-800",
	},
] as const;

const TOASTS = [
	() => m.hero_after_toast_1(),
	() => m.hero_after_toast_2(),
	() => m.hero_after_toast_3(),
	() => m.hero_after_toast_4(),
] as const;

interface Chat {
	name: () => string;
	msg: () => string;
	time: string;
	order?: boolean;
	group?: boolean;
}

/** The inbox at rest — Aina's order is the newest thing in it. */
const BASE_CHATS: readonly Chat[] = [
	{
		name: () => m.hero_before_name_1(),
		msg: () => m.hero_before_msg_1(),
		time: "09:41",
		order: true,
	},
	{
		name: () => m.hero_before_name_2(),
		msg: () => m.hero_before_msg_2(),
		time: "09:38",
	},
	{
		name: () => m.hero_before_name_3(),
		msg: () => m.hero_before_msg_3(),
		time: "09:15",
	},
	{
		name: () => m.hero_before_name_4(),
		msg: () => m.hero_before_msg_4(),
		time: "08:52",
	},
];

/** What buries it — one per beat, newest on top. */
const INCOMING: readonly Chat[] = [
	{
		name: () => m.hero_before_name_5(),
		msg: () => m.hero_before_msg_5(),
		time: "now",
		group: true,
	},
	{
		name: () => m.hero_before_name_6(),
		msg: () => m.hero_before_msg_6(),
		time: "now",
	},
];

function initials(name: string): string {
	return name.trim().slice(0, 1).toUpperCase();
}

/** How many incoming chats are on screen at a beat (0, 1, 2, 2, 2). */
function arrivals(beat: number): number {
	return Math.min(Math.max(beat, 0), INCOMING.length);
}

function ChatRow({
	chat,
	buried,
	arrived,
}: {
	chat: Chat;
	buried: boolean;
	arrived: boolean;
}) {
	return (
		<li
			className={cn(
				"flex items-center gap-[0.8em] overflow-hidden px-[1.1em] py-[0.8em] transition-opacity duration-500 motion-reduce:transition-none",
				arrived && "animate-kp-row-in",
				buried && "opacity-50",
			)}
		>
			<span
				className={cn(
					"flex size-[2.4em] shrink-0 items-center justify-center rounded-full text-[0.9em] font-bold",
					chat.group
						? "bg-emerald-100 text-emerald-700"
						: "bg-slate-200 text-slate-600",
				)}
			>
				{initials(chat.name())}
			</span>
			<span className="flex min-w-0 grow flex-col">
				<span className="flex items-baseline justify-between gap-[0.5em]">
					<span className="truncate text-[0.95em] font-semibold">
						{chat.name()}
					</span>
					<span className="shrink-0 text-[0.7em] text-slate-400">
						{chat.time}
					</span>
				</span>
				<span className="truncate text-[0.85em] text-slate-500">
					{chat.msg()}
				</span>
			</span>
			<span className="size-[0.6em] shrink-0 rounded-full bg-[#25D366]" />
		</li>
	);
}

function BeforeCard({ beat, still }: { beat: number; still: boolean }) {
	const unread = UNREAD[Math.min(beat, UNREAD.length - 1)];
	const count = still ? INCOMING.length : arrivals(beat);
	const rows = [...INCOMING.slice(0, count), ...BASE_CHATS];
	const buried = still || beat >= 2;
	const missed = still || beat >= 3;
	return (
		<div className="relative">
			<span className="absolute -top-[1.6em] left-0 z-10 rounded-full bg-white px-[1em] py-[0.45em] text-[0.8em] font-bold uppercase tracking-wider text-slate-800 shadow-md">
				{m.hero_before_label()}
			</span>
			{/* Fixed height: as chats arrive at the top, the bottom of the list
			    falls out of the frame — that IS the burying. */}
			<div className="h-[19.5em] w-[36cqw] rotate-[-2deg] overflow-hidden rounded-[1.4em] bg-white text-left text-slate-800 shadow-2xl">
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
					{rows.map((chat, i) => (
						<ChatRow
							key={chat.time + chat.name()}
							chat={chat}
							buried={buried && Boolean(chat.order)}
							// Only the newest arrival animates; the rest are already there.
							arrived={!still && i === 0 && count > 0 && beat === count}
						/>
					))}
				</ul>
			</div>
			{missed ? (
				<span
					key="missed"
					className={cn(
						"absolute -right-[1.5em] top-[11.4em] rounded-[0.6em] bg-destructive px-[0.9em] py-[0.45em] text-[0.85em] font-bold uppercase tracking-wider text-destructive-foreground shadow-lg",
						still ? "rotate-[-6deg]" : "animate-kp-stamp",
					)}
				>
					{m.hero_before_missed()}
				</span>
			) : null}
		</div>
	);
}

function AfterPhone({ beat, still }: { beat: number; still: boolean }) {
	const stage = still
		? STATUS.length
		: Math.min(Math.max(beat, 0), STATUS.length);
	const status = stage > 0 ? STATUS[stage - 1] : null;
	const toast = stage > 0 ? TOASTS[stage - 1] : null;
	const shipped = stage === STATUS.length;
	return (
		<div className="relative">
			<span className="absolute -top-[1.6em] left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-accent px-[1em] py-[0.45em] text-[0.8em] font-bold uppercase tracking-wider text-accent-foreground shadow-md md:left-0 md:translate-x-0">
				{m.hero_after_label()}
			</span>
			{/* Device shell — the same body the old hero phone wore, scaled in em. */}
			<div className="relative w-[19em] rounded-[2.6em] bg-slate-950 p-[0.55em] shadow-[0_44px_80px_-24px_hsl(222_47%_11%_/_0.5)] ring-1 ring-white/15">
				<div className="relative flex h-[36em] flex-col overflow-hidden rounded-[2.1em] bg-slate-50 text-left text-slate-800">
					<div className="flex items-center justify-between px-[1.4em] pt-[0.8em] text-[0.7em] font-semibold">
						<span>9:41</span>
						<span className="absolute left-1/2 top-[0.7em] h-[1.5em] w-[5.5em] -translate-x-1/2 rounded-full bg-slate-950" />
						<span>●●●</span>
					</div>
					<div className="mt-[1.1em] flex items-end justify-between px-[1.2em]">
						<span className="flex flex-col">
							<span className="text-[0.65em] font-medium text-slate-500">
								{m.hero_after_store()}
							</span>
							<span className="text-[1.25em] font-bold leading-tight tracking-tight">
								{m.hero_after_inbox()}
							</span>
						</span>
						<span className="flex size-[2em] items-center justify-center rounded-full bg-accent text-[0.7em] font-bold text-accent-foreground">
							KA
						</span>
					</div>
					<div className="mt-[0.8em] flex gap-[0.4em] overflow-hidden px-[1.2em] text-[0.62em] font-semibold">
						<span className="whitespace-nowrap rounded-full bg-slate-900 px-[1em] py-[0.4em] text-white">
							{m.hero_after_chip_all()}
						</span>
						{[
							m.hero_after_chip_new(),
							m.hero_after_chip_progress(),
							m.hero_after_chip_done(),
						].map((chip) => (
							<span
								key={chip}
								className="whitespace-nowrap rounded-full border border-slate-200 bg-white px-[1em] py-[0.4em] text-slate-600"
							>
								{chip}
							</span>
						))}
					</div>
					{/* The live order card. Its slot opens from 0fr → 1fr when the order
					    lands, so the settled rows below slide down instead of jumping. */}
					<div
						className={cn(
							"grid transition-[grid-template-rows] duration-500 ease-out motion-reduce:transition-none",
							stage > 0
								? "[grid-template-rows:1fr]"
								: "[grid-template-rows:0fr]",
						)}
					>
						<div className="min-h-0 overflow-hidden">
							<div
								className={cn(
									"mx-[1em] mt-[0.9em] rounded-[1em] border-2 border-accent/60 bg-white p-[0.9em] shadow-sm",
									stage > 0 && !still && "animate-kp-card-in",
								)}
							>
								<div className="flex items-start justify-between gap-[0.6em]">
									<span className="min-w-0 truncate text-[0.9em] font-semibold">
										{m.hero_after_order()}
									</span>
									<span className="shrink-0 whitespace-nowrap text-[0.9em] font-bold">
										{m.hero_after_amount()}
									</span>
								</div>
								<span className="mt-[0.15em] block truncate text-[0.7em] text-slate-500">
									{m.hero_after_order_meta()}
								</span>
								<div className="mt-[0.7em] flex h-[1.8em] items-center justify-between">
									{status ? (
										<span
											key={status.label()}
											className={cn(
												"inline-block rounded-full px-[0.8em] py-[0.3em] text-[0.72em] font-semibold",
												status.className,
												!still && "animate-kp-pop",
											)}
										>
											{status.label()}
										</span>
									) : null}
									{shipped ? (
										<Truck
											className={cn(
												"size-[1.1em] text-purple-700",
												!still && "animate-kp-drive",
											)}
										/>
									) : (
										<WhatsAppIcon className="size-[1.1em] text-[#25D366]" />
									)}
								</div>
							</div>
						</div>
					</div>
					{(
						[
							[
								m.hero_after_row_2_title(),
								m.hero_after_row_2_meta(),
								m.hero_after_row_2_amount(),
								m.hero_after_row_2_status(),
							],
							[
								m.hero_after_row_3_title(),
								m.hero_after_row_3_meta(),
								m.hero_after_row_3_amount(),
								m.hero_after_row_3_status(),
							],
						] as const
					).map(([title, meta, amount, rowStatus]) => (
						<div
							key={title}
							className="mx-[1em] mt-[0.6em] rounded-[1em] border border-slate-200 bg-white p-[0.9em]"
						>
							<div className="flex items-start justify-between gap-[0.6em]">
								<span className="min-w-0 truncate text-[0.9em] font-semibold">
									{title}
								</span>
								<span className="shrink-0 whitespace-nowrap text-[0.9em] font-bold">
									{amount}
								</span>
							</div>
							<span className="mt-[0.15em] block truncate text-[0.7em] text-slate-500">
								{meta}
							</span>
							<span className="mt-[0.6em] inline-block rounded-full bg-blue-100 px-[0.8em] py-[0.3em] text-[0.72em] font-semibold text-blue-800">
								{rowStatus}
							</span>
						</div>
					))}
					{/* Toast — one per beat, slides up from the bottom edge of the list. */}
					<div className="pointer-events-none absolute inset-x-[1em] top-[21.5em] flex justify-center">
						{toast ? (
							<span
								key={toast()}
								className={cn(
									"flex items-center gap-[0.5em] rounded-full bg-slate-900 px-[1em] py-[0.55em] text-[0.75em] font-semibold text-white shadow-lg",
									!still && "animate-kp-toast-in",
								)}
							>
								<span className="size-[0.5em] rounded-full bg-accent" />
								{toast()}
							</span>
						) : null}
					</div>
					{/* Tab labels stay English in every locale on purpose: this is a
					    picture of the real dashboard, which ships English-only, and a
					    translated mock would promise a UI the seller won't get. */}
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
								className={cn(
									"flex flex-col items-center gap-[0.3em]",
									active && "text-accent-emphasis",
								)}
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
	// Reduced motion: the last story beat, as a still.
	const still = Boolean(shouldReduceMotion);
	const storyBeat = still ? LAST_STORY_BEAT : beat;
	const resetting = !still && beat === RESET_BEAT;

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
				{/* The design's dotted grid, and a soft mint glow. */}
				<div
					aria-hidden
					className="pointer-events-none absolute inset-0 [background-image:radial-gradient(hsl(0_0%_100%/0.07)_1px,transparent_1px)] [background-size:2.2cqw_2.2cqw]"
				/>
				<div
					aria-hidden
					className="pointer-events-none absolute -left-[10%] top-[10%] size-[55cqw] rounded-full bg-accent/10 blur-3xl md:size-[40cqw]"
				/>
				<div
					className={cn(
						"absolute inset-0 flex items-start justify-center pt-[15cqw] text-left transition-opacity duration-300 motion-reduce:transition-none md:items-center md:justify-center md:gap-[5cqw] md:pt-0",
						resetting ? "opacity-0" : "opacity-100",
					)}
				>
					<div className="hidden text-[1.25cqw] md:mt-[3cqw] md:block">
						<BeforeCard beat={storyBeat} still={still} />
					</div>
					<div className="text-[3.6cqw] md:text-[1.3cqw]">
						<AfterPhone beat={storyBeat} still={still} />
					</div>
				</div>
				{/* The hand-off: the order leaves the chat and arcs into the inbox on
				    the beat it arrives. Desktop only — there is no chat side on a phone. */}
				{!still && beat === 1 ? (
					<span
						key="handoff"
						className="animate-kp-handoff pointer-events-none absolute left-[33cqw] top-[52cqh] hidden items-center gap-[0.5em] rounded-full bg-white px-[1em] py-[0.5em] text-[1.1cqw] font-bold text-slate-900 shadow-2xl md:flex"
					>
						<span className="size-[0.6em] rounded-full bg-accent" />
						{m.hero_after_order()} · {m.hero_after_amount()}
					</span>
				) : null}
			</div>
		</div>
	);
}
