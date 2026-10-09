import { Clock, type LucideIcon, Scissors } from "lucide-react";
import { useEffect, useState } from "react";
import {
	type CountdownStage,
	countdownStage,
	formatTimeLeft,
} from "../../lib/countdown";
import { cn } from "../../lib/utils";

/**
 * The house countdown (z8r3fdr60v): a strip of receipt paper being cut along
 * its dotted line, right to left. Scissors ride the cut; behind them the paper
 * falls open above and below, and the countdown printed down the middle is
 * crisp on the sealed half and a split, smudged ghost of itself in the wake.
 *
 * Replaces the 3px progress hairline it shipped as, which read as a border
 * rather than a timer (Zaki, 8 Oct). Chosen over an envelope-tear variant
 * because "cut along the dotted line" is literally what a promotion is, and
 * it speaks the receipt language the checkout ticket already uses
 * (`checkout-summary` — bg-card, dashed border rules, mono figures).
 *
 * **A live countdown is ALWAYS the page's top band** (`CountdownBand`, below)
 * — never an inline panel element, never two treatments for one idea. Mounts:
 * the claim checkout (`ClaimTimerBar`), the storefront checkout and the
 * product page (z8r3fdcw72). Deliberately NOT the product card — at ~180px
 * wide the blades and the ghost text turn to mush, so the card keeps its
 * compact image overlay, which also keeps card heights uniform.
 *
 * Presentational only. It ticks its own clock for the display and calls
 * `onExpired` when the deadline passes, but the server is always the
 * authority on whether the window is still open (`orderClaims.commit` judges
 * expiry; `orders.create` re-resolves promo prices).
 */

/** Paper falling open behind the blades: a wedge that widens as it travels. */
const WEDGE_CUTTING =
	"polygon(0 50%, 18% 46%, 38% 42%, 62% 38%, 82% 35%, 100% 32%, 100% 68%, 82% 65%, 62% 62%, 38% 58%, 18% 54%)";
/** Fully cut: both halves hang open across the whole strip. */
const WEDGE_DONE =
	"polygon(0 42%, 18% 39%, 38% 36%, 62% 34%, 82% 33%, 100% 32%, 100% 68%, 82% 67%, 62% 66%, 38% 64%, 18% 61%, 0 58%)";

/** Figures + icon colour per stage, on the fixed-dark paper (see the
 * `--countdown-*` comment in styles.css for why the surface never flips). */
const STAGE_TONE: Record<CountdownStage, string> = {
	ok: "text-countdown-ok",
	low: "text-countdown-low",
	critical: "text-countdown-critical",
};

/** The perforation runs the SAME ramp as the figures, a touch dimmer — it is a
 * rule, not text, and two colours for one state would read as two signals. */
const STAGE_DASH: Record<CountdownStage, string> = {
	ok: "border-countdown-ok/55",
	low: "border-countdown-low/70",
	critical: "border-countdown-critical/70",
};

const ANIMATE =
	"transition-all duration-1000 ease-linear motion-reduce:transition-none";

function StripRow({
	icon: Icon,
	label,
	digits,
	toneClass,
}: {
	icon: LucideIcon;
	label: string;
	digits: string;
	toneClass?: string;
}) {
	return (
		<>
			<Icon className={cn("size-3.5 shrink-0", toneClass)} aria-hidden />
			<span className="text-[13px] font-medium">{label}</span>
			<span
				className={cn("font-mono text-sm font-bold tabular-nums", toneClass)}
				aria-live="off"
			>
				{digits}
			</span>
		</>
	);
}

export function CountdownStrip({
	expiresAt,
	totalMs,
	label,
	icon = Clock,
	onExpired,
	className,
}: {
	expiresAt: number;
	/** The whole window, so the stage thresholds have a denominator. */
	totalMs: number;
	label: string;
	icon?: LucideIcon;
	onExpired?: () => void;
	className?: string;
}) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);
	const remaining = expiresAt - now;
	useEffect(() => {
		if (remaining <= 0) onExpired?.();
	}, [remaining, onExpired]);

	// A malformed/absent window resolves to "no time left" rather than a NaN
	// width React would drop (which would render a fully SEALED strip — the
	// opposite of the truth for a claim whose deadline we can't compute).
	const total = totalMs > 0 ? totalMs : 0;
	const sealed = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
	const cut = 1 - sealed;
	const stage = countdownStage(remaining, total);
	const done = remaining <= 0 || sealed === 0;
	const cutPct = `${(cut * 100).toFixed(1)}%`;
	const sealedPct = `${(sealed * 100).toFixed(1)}%`;
	// The HUMAN format, not the raw m:ss primitive: a promotion can run for a
	// day, and a band reading "638:31" tells a buyer nothing (seen live). The
	// product card already spoke this way, so the two surfaces now agree.
	const digits = formatTimeLeft(remaining);

	// The GHOST's digits keep the stage colour; its label does not. By the
	// final minute the fill is nearly gone, so a red that lives only in the
	// paper is a red nobody sees — the clock is the one thing still on screen,
	// and it has to carry the warning (Zaki, 9 Oct). The label stays grey so
	// the wake still reads as smudged print rather than as a second live row.
	// The wake has to stay READABLE — "a bit dirty and distorted", not erased.
	// Rendered for real, a 2px split read as TWO washed-out lines and the final
	// minute (the one that matters) had no legible clock at all. What cut paper
	// actually does is MISREGISTER the print: the halves slide a hair apart and
	// sideways, so the word stays one word. Hence ±1px and a 2° shear.
	//
	// The opacity is HIGH on purpose. Half-opacity was tuned when the paper was
	// white and the ink dark, where fading read as a smudge; on the dark band
	// the same figure is light ink on near-black and fading reads as GONE —
	// rendered side by side, the final minute's red clock was all but invisible
	// (z8r3fdr60v, second visual pass). Misregistering print doesn't thin the
	// ink, so the dirt comes from the offset, the shear and the blur, never
	// from transparency.
	const ghostBase =
		"pointer-events-none absolute inset-0 flex items-center justify-center gap-2 whitespace-nowrap text-countdown-ink";
	// Inline, not `blur-[0.3px]`: Tailwind v4 emits NOTHING for a sub-pixel
	// arbitrary blur (verified against a real build — the class compiled away
	// silently), so the smudge has to be set as a style to exist at all.
	const SMUDGE = "blur(0.3px)";

	return (
		<div
			className={cn(
				// h-10, not h-14: as a page-top band this sits directly under the store
				// header, and at 56px it read as a second header rather than a strip
				// of tape across one (Zaki, 9 Oct). 40px is the announcement-bar
				// height — subordinate at a glance, still a 44px-safe tap area is
				// not needed because nothing in here is tappable.
				"relative h-10 overflow-hidden rounded-xl bg-countdown-paper text-countdown-ink ring-1 ring-white/10",
				className,
			)}
		>
			{/* Paper fallen open behind the blades — the time already cut away. */}
			<div
				data-testid="countdown-cut"
				data-stage={stage}
				className={cn(
					// The opening is a VOID, not the page showing through: on paper
					// this dark the literal reading (a white gap) would be a bright
					// wedge growing across the chrome, louder than the figures it is
					// supposed to be revealing. Plain black at 35% keeps the band one
					// object and lets the blades and the dash carry the motion.
					"absolute inset-y-0 right-0 bg-black/35 shadow-[inset_0_1px_5px_rgba(0,0,0,0.45)]",
					ANIMATE,
				)}
				style={{
					width: done ? "100%" : cutPct,
					clipPath: done ? WEDGE_DONE : WEDGE_CUTTING,
				}}
				aria-hidden
			/>
			{/* Perforation + blades share ONE inset track, so they meet by
			    construction at every value instead of by two formulas that have
			    to be kept in agreement. The 12px inset is what keeps the 20px
			    icon inside the strip at both ends of its run — centring it on a
			    raw percentage hangs half the blades outside, and the strip's
			    `overflow-hidden` then shears them off (worst in the final
			    seconds, the one moment it is being watched). */}
			<div className="pointer-events-none absolute inset-y-0 left-3 right-3">
				{done ? null : (
					<div
						className={cn(
							"absolute left-0 top-[calc(50%-1px)] border-t-2 border-dashed",
							STAGE_DASH[stage],
							ANIMATE,
						)}
						style={{ right: `calc(100% - ${sealedPct} + 11px)` }}
						aria-hidden
					/>
				)}
				<div
					data-testid="countdown-blades"
					className={cn(
						"absolute top-1/2 -translate-x-1/2 -translate-y-1/2",
						ANIMATE,
					)}
					style={{ left: done ? "0%" : sealedPct }}
					aria-hidden
				>
					<Scissors
						className={cn(
							"size-5 -scale-x-100",
							done ? "text-countdown-ink/50" : "text-countdown-ink",
						)}
					/>
				</div>
			</div>
			{/* Crisp on the sealed half — the one layer screen readers get. */}
			{done ? null : (
				<div
					data-testid="countdown-print"
					className={cn(
						"absolute inset-0 flex items-center justify-center gap-2 whitespace-nowrap",
						ANIMATE,
					)}
					style={{ clipPath: `inset(0 ${cutPct} 0 0)` }}
				>
					<StripRow
						icon={icon}
						label={label}
						digits={digits}
						toneClass={STAGE_TONE[stage]}
					/>
				</div>
			)}
			{/* Ghosts: the same print, split and smudged by the cut. Decorative. */}
			<div
				className={cn(
					ghostBase,
					"-translate-y-[1px] -translate-x-[0.5px] skew-x-[-2deg]",
					ANIMATE,
				)}
				style={{
					clipPath: done ? "inset(0 0 50% 0)" : `inset(0 0 50% ${sealedPct})`,
					opacity: 0.88,
					filter: SMUDGE,
				}}
				aria-hidden
			>
				<StripRow
					icon={icon}
					label={label}
					digits={digits}
					toneClass={STAGE_TONE[stage]}
				/>
			</div>
			<div
				className={cn(
					ghostBase,
					"translate-y-[1px] translate-x-[0.5px] skew-x-[2deg]",
					ANIMATE,
				)}
				style={{
					clipPath: done ? "inset(50% 0 0 0)" : `inset(50% 0 0 ${sealedPct})`,
					opacity: 0.82,
					filter: SMUDGE,
				}}
				aria-hidden
			>
				<StripRow
					icon={icon}
					label={label}
					digits={digits}
					toneClass={STAGE_TONE[stage]}
				/>
			</div>
		</div>
	);
}

/**
 * The SLB's one and only placement: a full-bleed sticky band at the top of the
 * page, directly under the store header (Zaki, 8 Oct — "always at top, header
 * kind of thing, so it's consistent on whichever page uses it").
 *
 * Deliberately NOT an inline card inside a panel. A countdown that is a page
 * banner on one screen and a widget inside a box on the next is two patterns
 * for one idea; the band also means the clock stays on screen while the buyer
 * scrolls through a long checkout, which is the whole point of a deadline.
 *
 * Full-bleed and square-cornered so it reads as chrome rather than content —
 * and on a wide viewport the dotted line runs the whole way, which is exactly
 * what a long receipt being cut should look like.
 */
export function CountdownBand({
	expiresAt,
	totalMs,
	label,
	icon,
	onExpired,
}: {
	expiresAt: number;
	totalMs: number;
	label: string;
	icon?: LucideIcon;
	onExpired?: () => void;
}) {
	return (
		<div className="sticky top-0 z-40">
			<CountdownStrip
				expiresAt={expiresAt}
				totalMs={totalMs}
				label={label}
				icon={icon}
				onExpired={onExpired}
				className="rounded-none ring-0 shadow-[0_1px_8px_rgba(15,23,42,0.18)]"
			/>
		</div>
	);
}
