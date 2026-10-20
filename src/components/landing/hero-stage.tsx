import { useInView, useReducedMotion } from "framer-motion";
import { BarChart3, Home, Inbox, QrCode, Truck, Zap } from "lucide-react";
import { useRef } from "react";
import { useBeatLoop } from "../../hooks/useBeatLoop";
import { cn } from "../../lib/utils";
import { m } from "../../paraglide/messages";
import { WhatsAppIcon } from "../dashboard/brand-icons";

/**
 * The hero's before/after motion stage (landing v2, z8r3fdegej — design
 * approved 12 Sep 2026; sixth beat + phone strip from the 15 Oct 2026 canvas,
 * artboards 1–2 / M1–M2). A navy 16:9 stage under the hero copy that acts out
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
 * dashboard's own `status-badge.tsx` colours over `bottom-nav.tsx` tabs. Then
 * the SELL-MORE beat: Mira's flash-sale order lands above Aina's with its
 * "Flash sale −20%" source tag, "New · 1" flips to "New · 2", and the toast
 * reads the sale's live count — the page's one sentence about promotions,
 * flash sales and vouchers, acted rather than listed.
 *
 * Six story beats, then a short fade and the loop restarts. CSS only, on
 * purpose (Lighthouse AC — no video, no 3D, no per-frame JS): `useBeatLoop`
 * flips a beat index, keyed remounts replay the `kp-*` keyframes,
 * `transition-*` classes handle the rest. `useInView` + the hidden-tab guard
 * stop the clock off-screen; reduced motion renders the FINAL frame as a
 * still.
 *
 * Everything inside the stage is sized in `em` off a root font-size set in
 * container-query units, so the composition scales with the stage instead of
 * overflowing it at `md` — the phone sits fully inside the frame at 390 and
 * 1280 (verified by screenshot). On desktop the Before card and the phone
 * stand at ONE height, bottoms on the stage floor, a fixed gap between them,
 * each label centred directly above its card. Below `md` the stage is 3:4:
 * a compact Before STRIP (the unread count, Aina's row, the stamp) sits above
 * the phone, so the page's argument survives on a phone instead of shipping
 * the After half alone. The chat list and the hand-off are desktop-only.
 *
 * Decorative (`aria-hidden`); `hero_stage_alt` is the machine-readable copy.
 */

/** Beat holds, ms: baseline → order arrives → paid → confirmed → shipped → flash sale → fade. */
export const HERO_BEATS = [1400, 1700, 1700, 1700, 2400, 2000, 420] as const;
const LAST_STORY_BEAT = 5;
const RESET_BEAT = 6;
/** The beat Mira's flash-sale order lands (`hero-stage.test.tsx` drives to it). */
export const FLASH_BEAT = 5;

/** Unread count on the WhatsApp side, per beat — it only ever climbs. */
const UNREAD = [12, 27, 43, 61, 61, 61, 61] as const;

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
	() => m.hero_after_toast_5(),
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

/** How many incoming chats are on screen at a beat (0, 1, 2, 2, 2, …). */
function arrivals(beat: number): number {
	return Math.min(Math.max(beat, 0), INCOMING.length);
}

/** The Before side's own clock: its story ends at the stamp (beat 3). */
function unreadAt(beat: number): number {
	return UNREAD[Math.min(beat, UNREAD.length - 1)];
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

function StageLabel({
	tone,
	children,
}: {
	tone: "before" | "after";
	children: string;
}) {
	return (
		<span
			className={cn(
				"z-10 whitespace-nowrap rounded-full px-[1em] py-[0.45em] text-[0.8em] font-bold uppercase tracking-wider shadow-md",
				tone === "before"
					? "bg-white text-slate-800"
					: "bg-accent text-accent-foreground",
			)}
		>
			{children}
		</span>
	);
}

function UnreadBadge({
	unread,
	className,
}: {
	unread: number;
	className?: string;
}) {
	return (
		<span
			key={unread}
			className={cn(
				"animate-kp-pop rounded-full bg-red-500 px-[0.7em] py-[0.15em] text-[0.8em] font-bold text-white",
				className,
			)}
		>
			{unread} {m.hero_before_unread()}
		</span>
	);
}

function MissedStamp({
	still,
	className,
}: {
	still: boolean;
	className?: string;
}) {
	return (
		<span
			key="missed"
			className={cn(
				"rounded-[0.6em] bg-destructive px-[0.9em] py-[0.45em] text-[0.85em] font-bold uppercase tracking-wider text-destructive-foreground shadow-lg",
				still ? "rotate-[-6deg]" : "animate-kp-stamp",
				className,
			)}
		>
			{m.hero_before_missed()}
		</span>
	);
}

/** Desktop: the whole WhatsApp inbox, one height with the phone beside it. */
function BeforeCard({ beat, still }: { beat: number; still: boolean }) {
	const unread = unreadAt(beat);
	const count = still ? INCOMING.length : arrivals(beat);
	const rows = [...INCOMING.slice(0, count), ...BASE_CHATS];
	const buried = still || beat >= 2;
	const missed = still || beat >= 3;
	return (
		<div className="flex flex-col items-center gap-[1em]">
			<StageLabel tone="before">{m.hero_before_label()}</StageLabel>
			{/* The same height as the phone shell beside it (36em screen + bezel),
			    standing on the stage floor; the stage's rounded corners clip the
			    bottom edge, which is the design's cut-off. */}
			<div className="relative h-[37.1em] w-[32em]">
				<div className="h-full overflow-hidden rounded-t-[1.6em] bg-white text-left text-slate-800 shadow-2xl">
					<div className="flex items-center justify-between bg-[#075E54] px-[1.2em] py-[0.9em] text-white">
						<span className="flex items-center gap-[0.5em] text-[1.05em] font-bold">
							<WhatsAppIcon className="size-[1.2em]" />
							{m.hero_before_inbox()}
						</span>
						<UnreadBadge unread={unread} />
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
					<MissedStamp
						still={still}
						className="absolute -right-[1.5em] top-[14.2em]"
					/>
				) : null}
			</div>
		</div>
	);
}

/**
 * Phone: the Before side compressed to what carries the argument — the
 * climbing unread count, Aina's row going quiet, the stamp — so the page
 * doesn't ship the After half alone below `md`.
 */
function BeforeStrip({ beat, still }: { beat: number; still: boolean }) {
	const unread = unreadAt(beat);
	const buried = still || beat >= 2;
	const missed = still || beat >= 3;
	const aina = BASE_CHATS[0];
	return (
		<div className="relative flex w-full flex-col gap-[0.8em] rounded-[1.4em] border border-white/15 bg-white/[0.07] px-[1.1em] py-[0.9em] text-left">
			<div className="flex items-center justify-between gap-[0.6em]">
				<StageLabel tone="before">{m.hero_before_label()}</StageLabel>
				<UnreadBadge unread={unread} />
			</div>
			<div
				className={cn(
					"flex items-center gap-[0.8em] transition-opacity duration-500 motion-reduce:transition-none",
					buried && "opacity-50",
				)}
			>
				<span className="flex size-[2.4em] shrink-0 items-center justify-center rounded-full bg-slate-200 text-[0.9em] font-bold text-slate-600">
					{initials(aina.name())}
				</span>
				<span className="flex min-w-0 grow flex-col text-white">
					<span className="truncate text-[0.95em] font-semibold">
						{aina.name()}
					</span>
					<span className="truncate text-[0.85em] text-white/70">
						{aina.msg()}
					</span>
				</span>
			</div>
			{missed ? (
				// One red pulse as it lands (box-shadow, no layout) — the stamp is
				// the strip's whole point, so it gets the one flourish.
				<MissedStamp
					still={still}
					className={cn(
						"absolute bottom-[0.6em] right-[1em]",
						!still && "animate-kp-pulse-red",
					)}
				/>
			) : null}
		</div>
	);
}

/** One settled order row under the live card. */
function OrderRow({
	title,
	meta,
	amount,
	status,
	className,
}: {
	title: string;
	meta: string;
	amount: string;
	status: string;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"mx-[1em] rounded-[1em] border border-slate-200 bg-white p-[0.9em]",
				className,
			)}
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
				{status}
			</span>
		</div>
	);
}

/**
 * The Kedaipal half of the stage: the orders inbox on a phone. Exported for
 * the seller-flow walkthrough (phase 01), which passes its own beat and
 * drops the label — the frame there already says which side this is.
 */
export function AfterPhone({
	beat,
	still,
	showLabel = true,
}: {
	beat: number;
	still: boolean;
	showLabel?: boolean;
}) {
	const stage = still
		? STATUS.length
		: Math.min(Math.max(beat, 0), STATUS.length);
	const status = stage > 0 ? STATUS[stage - 1] : null;
	const flash = still || beat >= FLASH_BEAT;
	// The toast follows the newest thing on screen: Aina's step, then the sale.
	const toastIndex = flash ? TOASTS.length : stage;
	const toast = toastIndex > 0 ? TOASTS[toastIndex - 1] : null;
	const shipped = stage === STATUS.length;
	const newCount = flash ? m.hero_after_chip_new_2() : m.hero_after_chip_new();
	return (
		// On a phone the shell takes whatever height the stage has left below the
		// strip and runs off its bottom edge (the canvas's cut-off phone), so the
		// toast above the tab bar is always inside the frame; on desktop it is a
		// whole phone at a fixed height beside the chat list.
		<div className="flex min-h-0 flex-1 flex-col items-center gap-[1em] md:flex-none">
			{showLabel ? (
				<StageLabel tone="after">{m.hero_after_label()}</StageLabel>
			) : null}
			{/* Device shell — the same body the old hero phone wore, scaled in em. */}
			<div className="relative flex min-h-0 w-[19em] flex-1 flex-col rounded-t-[2.6em] bg-slate-950 p-[0.55em] pb-0 shadow-[0_44px_80px_-24px_hsl(222_47%_11%_/_0.5)] ring-1 ring-white/15 md:flex-none md:rounded-[2.6em] md:pb-[0.55em]">
				<div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-[2.1em] bg-slate-50 text-left text-slate-800 md:h-[36em] md:flex-none md:rounded-[2.1em]">
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
						{/* "New · 1" → "New · 2" the moment Mira's order lands. */}
						<span
							key={newCount}
							className={cn(
								"whitespace-nowrap rounded-full border border-slate-200 bg-white px-[1em] py-[0.4em] text-slate-600",
								flash && !still && "animate-kp-pop",
							)}
						>
							{newCount}
						</span>
						{[m.hero_after_chip_progress(), m.hero_after_chip_done()].map(
							(chip) => (
								<span
									key={chip}
									className="whitespace-nowrap rounded-full border border-slate-200 bg-white px-[1em] py-[0.4em] text-slate-600"
								>
									{chip}
								</span>
							),
						)}
					</div>
					{/* The list clips under the tab bar: as cards land on top, the
					    settled rows at the bottom fall out of view — a real inbox. */}
					<div className="relative min-h-0 flex-1 overflow-hidden">
						{/* Mira's flash-sale order: its slot opens from 0fr → 1fr, so the
						    rows below slide down instead of jumping. */}
						<div
							className={cn(
								"grid transition-[grid-template-rows] duration-500 ease-out motion-reduce:transition-none",
								flash ? "[grid-template-rows:1fr]" : "[grid-template-rows:0fr]",
							)}
						>
							<div className="min-h-0 overflow-hidden">
								{/* Mounted only once it lands: a hidden card would still read
								    "Pending" to the DOM (and the tests) on beat 0. */}
								{flash ? (
									<div
										className={cn(
											"mx-[1em] mt-[0.9em] rounded-[1em] border-2 border-accent/60 bg-white p-[0.9em] shadow-sm",
											!still && "animate-kp-card-in",
										)}
									>
										<div className="flex items-start justify-between gap-[0.6em]">
											<span className="min-w-0 truncate text-[0.9em] font-semibold">
												{m.hero_after_flash_order()}
											</span>
											<span className="shrink-0 whitespace-nowrap text-[0.9em] font-bold">
												{m.hero_after_flash_amount()}
											</span>
										</div>
										<span className="mt-[0.15em] block truncate text-[0.7em] text-slate-500">
											{m.hero_after_flash_meta()}
										</span>
										<div className="mt-[0.7em] flex h-[1.8em] items-center justify-between gap-[0.4em]">
											<span className="flex min-w-0 items-center gap-[0.4em]">
												<span className="inline-block whitespace-nowrap rounded-full bg-orange-100 px-[0.8em] py-[0.3em] text-[0.72em] font-semibold text-orange-800">
													{m.hero_after_status_1()}
												</span>
												{/* The order's source tag, as the inbox prints it. */}
												<span className="inline-flex items-center gap-[0.25em] whitespace-nowrap rounded-full border border-accent/40 bg-accent/10 px-[0.6em] py-[0.25em] text-[0.68em] font-bold text-accent-emphasis">
													<Zap className="size-[1em]" strokeWidth={3} />
													{m.hero_after_flash_tag()}
												</span>
											</span>
											<WhatsAppIcon className="size-[1.1em] shrink-0 text-[#25D366]" />
										</div>
									</div>
								) : null}
							</div>
						</div>
						{/* Aina's live order card. Same opening slot. */}
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
										"mx-[1em] mt-[0.9em] rounded-[1em] border-2 bg-white p-[0.9em] shadow-sm",
										flash ? "border-slate-200" : "border-accent/60",
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
						<OrderRow
							className="mt-[0.6em]"
							title={m.hero_after_row_2_title()}
							meta={m.hero_after_row_2_meta()}
							amount={m.hero_after_row_2_amount()}
							status={m.hero_after_row_2_status()}
						/>
						<OrderRow
							className="mt-[0.6em]"
							title={m.hero_after_row_3_title()}
							meta={m.hero_after_row_3_meta()}
							amount={m.hero_after_row_3_amount()}
							status={m.hero_after_row_3_status()}
						/>
						{/* Toast — one per beat, slides up over the list's bottom edge. */}
						<div className="pointer-events-none absolute inset-x-[1em] bottom-[0.8em] flex justify-center">
							{toast ? (
								<span
									key={toast()}
									className={cn(
										"flex max-w-full items-center gap-[0.5em] rounded-[1.2em] bg-slate-900 px-[1em] py-[0.55em] text-center text-[0.75em] font-semibold leading-snug text-white shadow-lg",
										!still && "animate-kp-toast-in",
									)}
								>
									<span className="size-[0.5em] shrink-0 rounded-full bg-accent" />
									<span>{toast()}</span>
								</span>
							) : null}
						</div>
					</div>
					{/* Tab labels stay English in every locale on purpose: this is a
					    picture of the real dashboard, which ships English-only, and a
					    translated mock would promise a UI the seller won't get. */}
					<div className="flex shrink-0 items-center justify-around border-t border-slate-200 bg-white px-[0.5em] pb-[0.9em] pt-[0.6em] text-[0.6em] font-semibold text-slate-400">
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
	const beat = useBeatLoop(!shouldReduceMotion && inView, HERO_BEATS);
	// Reduced motion: the last story beat, as a still.
	const still = Boolean(shouldReduceMotion);
	const storyBeat = still ? LAST_STORY_BEAT : beat;
	const resetting = !still && beat === RESET_BEAT;

	return (
		<div ref={stageRef} className="relative">
			<p className="sr-only">{m.hero_stage_alt()}</p>
			{/* `@container` makes cqw/cqh resolve against the stage. The phone's
			    font-size is the one knob: every inner size is in em, so on a phone
			    (3:4, strip + phone) and on desktop (16:9, both halves) the same
			    markup fits its frame. */}
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
				{/* Phone: strip, then the After pill, then the phone, top-aligned in
				    one column. Desktop: the two cards stand on the stage floor at one
				    height with a fixed gap, labels centred above each. */}
				<div
					className={cn(
						"absolute inset-0 flex flex-col items-center gap-[3.5cqw] px-[5cqw] pt-[5cqw] text-left transition-opacity duration-300 motion-reduce:transition-none md:flex-row md:items-end md:justify-center md:gap-[6.5cqw] md:px-0 md:pt-0",
						resetting ? "opacity-0" : "opacity-100",
					)}
				>
					<div className="hidden text-[1.3cqw] md:block">
						<BeforeCard beat={storyBeat} still={still} />
					</div>
					<div className="w-full text-[3cqw] md:hidden">
						<BeforeStrip beat={storyBeat} still={still} />
					</div>
					<div className="flex min-h-0 flex-1 flex-col text-[3cqw] md:flex-none md:text-[1.3cqw]">
						<AfterPhone beat={storyBeat} still={still} />
					</div>
				</div>
				{/* The hand-off: the order leaves the chat and arcs into the inbox on
				    the beat it arrives. Desktop only — there is no chat list on a phone. */}
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
