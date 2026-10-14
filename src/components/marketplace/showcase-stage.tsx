import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Check, Link as LinkIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PublicShowcase } from "../../../convex/showcases";
import {
	PILE_FAN_MAX,
	type ShowcaseTicketData,
	showcasePath,
	showcaseThemeClass,
	showcaseTimeFacts,
	splitStage,
} from "../../lib/showcase";
import { cn } from "../../lib/utils";
import { storeInitials } from "../storefront/storefront-header";
import { AppImage } from "../ui/app-image";
import { ShowcaseArt } from "./showcase-art";
import { ShowcaseTicket } from "./showcase-ticket";

/**
 * A showcase on /stores (z8r3fdr6mv) — the D7 "stage": the showcase's own
 * dark ground, its title and time chip, and its stores as tear-off tickets.
 *
 * - On a phone the tickets swipe in a rail (the next one peeks, dots say how
 *   many), with "See all N →" to the focused view.
 * - From `lg` the title stands left and the tickets stand on a 2-column grid
 *   beside it; past five, the rest become a fanned PILE of real tickets in
 *   the sixth cell — honest about the count, and still the same ticket.
 * - `focused` (`/stores?showcase=`) is the booth-QR landing: the same banner
 *   with EVERY ticket laid out, and a way back to the full directory.
 *
 * The showcase never auto-rotates and showcases never swipe between each
 * other: each already owns a sideways rail, and a carousel inside a carousel
 * fights the thumb. Several live at once STACK — the first in admin order
 * gets this stage, the rest a `ShowcaseBand`.
 */
export function ShowcaseStage({
	showcase,
	tickets,
	now,
	mode,
	railClassName,
	onBack,
	forcePhone = false,
}: {
	showcase: PublicShowcase;
	tickets: ShowcaseTicketData[];
	now: number;
	mode: "stage" | "focused";
	/** The page's shared snapping-rail classes (gutter + scroll padding). */
	railClassName: string;
	/** Focused view only: leave the showcase for the full directory. */
	onBack?: () => void;
	/** Render the phone layout whatever the viewport — the admin editor's
	 * preview is a phone-wide column on a desktop screen. */
	forcePhone?: boolean;
}) {
	const lg = (classes: string) => (forcePhone ? "" : classes);
	const facts = showcaseTimeFacts(showcase, now);
	const total = tickets.length;
	const focused = mode === "focused";
	const { shown, pile } = focused
		? { shown: tickets, pile: [] }
		: splitStage(tickets);
	const headingId = `showcase-${showcase.slug}`;

	return (
		<section
			aria-labelledby={headingId}
			className={cn(
				showcaseThemeClass(showcase.theme),
				"relative mx-3 overflow-hidden rounded-[28px] bg-showcase text-white",
				lg("lg:mx-8 lg:rounded-[32px]"),
				// The pile hangs out of its cell — the stage must not clip it.
				"[--sc-surface:var(--sc-b)]",
			)}
		>
			{showcase.coverImageUrl ? (
				<>
					<AppImage
						src={showcase.coverImageUrl}
						alt=""
						aspect="absolute inset-0 h-full w-full"
						sizes="(min-width: 1024px) 1152px, 100vw"
						objectFit="cover"
						priority
					/>
					{/* The cover is darkened whatever it is, so the title stays
					    readable — the admin editor says so beside the upload. */}
					<span
						aria-hidden
						className="absolute inset-0 bg-[linear-gradient(180deg,var(--sc-a)_0%,transparent_55%,var(--sc-b)_100%)] opacity-90"
					/>
				</>
			) : (
				<ShowcaseArt
					theme={showcase.theme}
					className={cn(
						"absolute inset-x-0 top-0 h-[230px] w-full",
						lg("lg:h-full lg:w-[460px]"),
					)}
				/>
			)}

			<div
				className={cn(
					"relative flex flex-col",
					focused
						? lg("lg:px-10 lg:pt-10")
						: lg(
								"lg:grid lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-9 lg:px-10 lg:py-10",
							),
				)}
			>
				<div
					className={cn(
						"flex flex-col gap-2.5 px-5 pt-5",
						lg("lg:px-0 lg:pt-0"),
					)}
				>
					{focused ? (
						<button
							type="button"
							onClick={onBack}
							className="tap-target -ml-2 inline-flex w-fit items-center gap-1.5 rounded-full px-2 text-[13px] font-bold text-[var(--sc-accent)] hover:bg-white/10"
						>
							<ArrowLeft aria-hidden className="size-4" />
							All stores
						</button>
					) : null}
					<div className="flex flex-wrap gap-1.5">
						<span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--sc-accent)]/45 bg-[var(--sc-accent)]/15 px-2.5 py-1 text-[11px] font-bold text-[var(--sc-accent)] lg:text-xs">
							<span
								aria-hidden
								className="size-1.5 rounded-full bg-[var(--sc-accent)] shadow-[0_0_0_3px_var(--sc-accent)] [--tw-shadow-color:color-mix(in_oklab,var(--sc-accent)_25%,transparent)]"
							/>
							<span suppressHydrationWarning>{facts.live}</span>
						</span>
						{facts.range ? (
							<span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-[var(--sc-text-soft)] lg:text-xs">
								{facts.range}
							</span>
						) : null}
					</div>
					<h2
						id={headingId}
						className={cn(
							"font-heading font-black leading-[1.02] tracking-[-0.025em]",
							focused
								? cn("mt-2 text-[31px]", lg("lg:text-[44px]"))
								: cn(
										"mt-[62px] max-w-[260px] text-[31px]",
										lg("lg:mt-1 lg:max-w-none lg:text-[44px]"),
									),
						)}
					>
						{showcase.title}
					</h2>
					{showcase.tagline ? (
						<p className="max-w-[300px] text-[13.5px] leading-relaxed text-[var(--sc-text-soft)] lg:max-w-none lg:text-[15px]">
							{showcase.tagline}
						</p>
					) : null}
					{focused || total === 0 || forcePhone ? null : (
						<div className="mt-1 hidden gap-2.5 lg:flex">
							<Link
								to="/stores"
								search={{ showcase: showcase.slug }}
								className="tap-target inline-flex items-center gap-1.5 rounded-xl bg-[var(--sc-accent)] px-4 text-[13.5px] font-extrabold text-[var(--sc-accent-fg)] hover:brightness-105"
							>
								See all {total} {total === 1 ? "store" : "stores"}
								<ArrowRight aria-hidden className="size-4" />
							</Link>
							<CopyShowcaseLink slug={showcase.slug} />
						</div>
					)}
					{focused ? (
						<div className="mt-1 flex items-center gap-3 text-[13px] text-[var(--sc-text-soft)]">
							<span>
								{total} {total === 1 ? "store" : "stores"}
							</span>
							<CopyShowcaseLink slug={showcase.slug} />
						</div>
					) : null}
				</div>

				{focused ? (
					<ul className="mt-5 grid grid-cols-1 gap-x-5 gap-y-6 px-5 pb-6 sm:grid-cols-2 lg:mt-7 lg:grid-cols-3 lg:px-0 lg:pb-10">
						{tickets.map((ticket) => (
							<li key={ticket.card.slug}>
								<ShowcaseTicket ticket={ticket} now={now} />
							</li>
						))}
					</ul>
				) : (
					<>
						{/* Phone: the rail. */}
						<ul
							className={cn(
								railClassName,
								"mt-5 gap-3 pb-3 pt-2",
								lg("lg:hidden"),
							)}
						>
							{tickets.map((ticket) => (
								<li
									key={ticket.card.slug}
									className="w-[280px] shrink-0 snap-start"
								>
									<ShowcaseTicket ticket={ticket} now={now} />
								</li>
							))}
						</ul>
						{total > 1 ? (
							<RailDots count={total} className={lg("lg:hidden")} />
						) : null}
						<div
							className={cn(
								"flex items-center justify-between px-5 pb-3.5 pt-1",
								lg("lg:hidden"),
							)}
						>
							<span className="text-xs text-white/60">
								{total} {total === 1 ? "store" : "stores"}
							</span>
							<Link
								to="/stores"
								search={{ showcase: showcase.slug }}
								className="tap-target inline-flex items-center gap-1 text-[13px] font-bold text-[var(--sc-accent)]"
							>
								See all {total}
								<ArrowRight aria-hidden className="size-3.5" />
							</Link>
						</div>

						{/* Desktop: the grid, and the pile. */}
						<ul
							className={cn(
								"hidden content-center gap-x-5 gap-y-[22px]",
								lg("lg:grid lg:grid-cols-2"),
							)}
						>
							{shown.map((ticket) => (
								<li key={ticket.card.slug}>
									<ShowcaseTicket ticket={ticket} now={now} />
								</li>
							))}
							{pile.length > 0 ? (
								<li>
									<TicketPile
										pile={pile}
										total={total}
										slug={showcase.slug}
										now={now}
									/>
								</li>
							) : null}
						</ul>
					</>
				)}
			</div>
		</section>
	);
}

/**
 * The rest of the showcase's tickets, as a fanned pile in the grid's last
 * cell: real tickets (same component, same data), so the count is honest and
 * every one is still a store you can open. Hover or focus opens the fan;
 * each ticket is its own link, and the badge on top leads to the focused
 * view. Under the top ticket they are inert until the fan opens, so a stray
 * click on the stack lands on the visible store or the badge, never on a
 * hidden one. Past `PILE_FAN_MAX` the fan stops growing and the badge
 * carries the number.
 */
function TicketPile({
	pile,
	total,
	slug,
	now,
}: {
	pile: ShowcaseTicketData[];
	total: number;
	slug: string;
	now: number;
}) {
	const [open, setOpen] = useState(false);
	const fanned = pile.slice(0, PILE_FAN_MAX);
	// Spread so the TOP ticket is the last in DOM order (painted on top), and
	// the bottom tilts furthest left. Three tickets: -7°, -2°, +3° at rest.
	const n = fanned.length;
	const topIndex = n - 1;
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: a hover/focus container for the fan; every interactive child is a real link
		<div
			className="relative h-[132px]"
			onMouseEnter={() => setOpen(true)}
			onMouseLeave={() => setOpen(false)}
			onFocus={() => setOpen(true)}
			onBlur={(e) => {
				if (!e.currentTarget.contains(e.relatedTarget as Node | null))
					setOpen(false);
			}}
		>
			{fanned.map((ticket, i) => {
				const fromTop = topIndex - i;
				const restRot = 3 - fromTop * 5;
				const openRot = 7 - fromTop * 9;
				const restX = 6 - fromTop * 10;
				const openX = 20 - fromTop * 27;
				const isTop = i === topIndex;
				return (
					<div
						key={ticket.card.slug}
						className="absolute inset-x-0 top-0 origin-[50%_120%] transition-transform duration-300 ease-out motion-reduce:transition-none"
						style={{
							transform: `rotate(${open ? openRot : restRot}deg) translate(${open ? openX : restX}px, ${open ? -fromTop * 6 : -fromTop * 2}px)`,
							zIndex: i,
							opacity: isTop || open ? 1 : 0.94,
						}}
					>
						<ShowcaseTicket ticket={ticket} now={now} inert={!isTop && !open} />
					</div>
				);
			})}
			{/* Anchored to the CELL, not the top ticket, so it never sits on a
			    store's name whichever way the fan is tilted. */}
			<Link
				to="/stores"
				search={{ showcase: slug }}
				className="tap-target absolute -right-2 -top-4 z-20 inline-flex items-center gap-1 rounded-full bg-[var(--sc-accent)] px-3 py-1.5 text-xs font-extrabold text-[var(--sc-accent-fg)] shadow-[0_6px_16px_-6px_rgb(0_0_0/0.6)] hover:brightness-105"
			>
				+{pile.length} more · See all {total}
				<ArrowRight aria-hidden className="size-3.5" />
			</Link>
		</div>
	);
}

/** The rail's position dots — one per ticket, the active one a short bar.
 * Decorative (`aria-hidden`): the rail itself is the list. */
function RailDots({ count, className }: { count: number; className?: string }) {
	// No JS scroll tracking: the first dot is always the bar. The dots say
	// "there are N, swipe", which is all they need to; a live scroll-spy would
	// cost an effect per showcase for a cosmetic.
	return (
		<div
			aria-hidden
			className={cn("flex justify-center gap-1.5 pt-1", className)}
		>
			{Array.from({ length: Math.min(count, 12) }, (_, i) => (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: purely positional, never reordered
					key={i}
					className={cn(
						"h-1.5 rounded-full",
						i === 0 ? "w-[18px] bg-[var(--sc-accent)]" : "w-1.5 bg-white/30",
					)}
				/>
			))}
		</div>
	);
}

/**
 * Copy the `/stores?showcase=` link — the booth QR's URL and the one to paste
 * in a WhatsApp group. Reports what it copied, not a bare tick.
 */
export function CopyShowcaseLink({
	slug,
	className,
}: {
	slug: string;
	className?: string;
}) {
	const [copied, setCopied] = useState(false);
	const timer = useRef<number | null>(null);
	useEffect(
		() => () => {
			if (timer.current !== null) window.clearTimeout(timer.current);
		},
		[],
	);
	async function copy() {
		try {
			await navigator.clipboard.writeText(
				`${window.location.origin}${showcasePath(slug)}`,
			);
			setCopied(true);
			if (timer.current !== null) window.clearTimeout(timer.current);
			timer.current = window.setTimeout(() => setCopied(false), 2000);
		} catch {
			// Clipboard blocked — the address bar still carries the link.
		}
	}
	return (
		<button
			type="button"
			onClick={copy}
			className={cn(
				"tap-target inline-flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-3.5 text-[13px] font-bold text-white hover:bg-white/15",
				className,
			)}
		>
			{copied ? (
				<Check aria-hidden className="size-4" />
			) : (
				<LinkIcon aria-hidden className="size-4" />
			)}
			{copied ? "Link copied" : "Copy link"}
		</button>
	);
}

/**
 * A showcase that is live at the same time as the one on the stage: a
 * compact band under it — title, when it ends, a strip of its store tiles
 * and the door to its focused view — so a second event never fights the
 * first for the same screen (stack, don't carousel).
 */
export function ShowcaseBand({
	showcase,
	tickets,
	now,
}: {
	showcase: PublicShowcase;
	tickets: ShowcaseTicketData[];
	now: number;
}) {
	const facts = showcaseTimeFacts(showcase, now);
	const total = tickets.length;
	const faces = tickets.slice(0, 4);
	const rest = total - faces.length;
	return (
		<Link
			to="/stores"
			search={{ showcase: showcase.slug }}
			className={cn(
				showcaseThemeClass(showcase.theme),
				"relative mx-3 flex items-center gap-4 overflow-hidden rounded-[22px] bg-showcase px-4 py-3.5 text-white transition-[translate] hover:-translate-y-0.5 motion-reduce:transition-none lg:mx-8 lg:px-6 lg:py-4",
			)}
		>
			<span className="flex min-w-0 grow flex-col gap-1">
				<span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[var(--sc-accent)]">
					<span
						aria-hidden
						className="size-1.5 rounded-full bg-[var(--sc-accent)]"
					/>
					<span suppressHydrationWarning>Also on · {facts.live}</span>
				</span>
				<span className="truncate font-heading text-[19px] font-black tracking-[-0.02em] lg:text-[22px]">
					{showcase.title}
				</span>
				<span className="flex items-center gap-2 text-xs text-[var(--sc-text-soft)]">
					<span className="flex pl-2">
						{faces.map((t) => (
							<span
								key={t.card.slug}
								className="-ml-2 flex size-7 items-center justify-center overflow-hidden rounded-[9px] border-2 border-[var(--sc-b)] bg-primary font-heading text-[10px] font-extrabold text-primary-foreground"
							>
								{t.card.logoUrl ? (
									<AppImage
										src={t.card.logoUrl}
										alt=""
										aspect="size-full"
										sizes="28px"
										objectFit="contain"
										className="bg-background"
									/>
								) : (
									storeInitials(t.card.storeName)
								)}
							</span>
						))}
						{rest > 0 ? (
							<span className="-ml-2 flex size-7 items-center justify-center rounded-[9px] border-2 border-[var(--sc-b)] bg-white/15 text-[10px] font-bold">
								+{rest}
							</span>
						) : null}
					</span>
					<span>
						{total} {total === 1 ? "store" : "stores"}
					</span>
				</span>
			</span>
			<span className="tap-target inline-flex shrink-0 items-center gap-1 text-[13px] font-bold text-[var(--sc-accent)]">
				See all
				<ArrowRight aria-hidden className="size-3.5" />
			</span>
		</Link>
	);
}
