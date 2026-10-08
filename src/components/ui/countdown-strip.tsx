import { Clock, type LucideIcon, Scissors } from "lucide-react";
import { useEffect, useState } from "react";
import {
	type CountdownStage,
	countdownStage,
	formatCountdown,
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

/** Figures + icon colour per stage. `accent-emphasis` and `amber-700`, not the
 * raw tokens: this text sits on white paper, where `--accent` and amber-400
 * both fail contrast (see the token comment in styles.css). */
const STAGE_TONE: Record<CountdownStage, string> = {
	ok: "text-accent-emphasis",
	low: "text-amber-700",
	critical: "text-red-700",
};

/** The perforation itself can afford the brighter tokens — it is a rule, not text. */
const STAGE_DASH: Record<CountdownStage, string> = {
	ok: "border-border",
	low: "border-amber-500/70",
	critical: "border-destructive/70",
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
	const digits = formatCountdown(remaining);

	// The wake has to stay READABLE — "a bit dirty and distorted", not erased.
	// Rendered for real, a 2px split read as TWO washed-out lines and the final
	// minute (the one that matters) had no legible clock at all. What cut paper
	// actually does is MISREGISTER the print: the halves slide a hair apart and
	// sideways, so the word stays one word. Hence ±1px, a 2° shear and a
	// foreground-derived grey rather than muted-foreground, which was too faint
	// to read against the opening.
	const ghostBase =
		"pointer-events-none absolute inset-0 flex items-center justify-center gap-2 whitespace-nowrap text-foreground";
	// Inline, not `blur-[0.3px]`: Tailwind v4 emits NOTHING for a sub-pixel
	// arbitrary blur (verified against a real build — the class compiled away
	// silently), so the smudge has to be set as a style to exist at all.
	const SMUDGE = "blur(0.3px)";

	return (
		<div
			className={cn(
				"relative h-14 overflow-hidden rounded-xl bg-card ring-1 ring-border/40",
				className,
			)}
		>
			{/* Paper fallen open behind the blades — the time already cut away. */}
			<div
				data-testid="countdown-cut"
				data-stage={stage}
				className={cn(
					// Derived from --foreground so it stays a cool recess in both
					// themes; plain `bg-muted` was within a hair of `bg-card` and the
					// opening read as nothing at all.
					"absolute inset-y-0 right-0 bg-foreground/[0.13] shadow-[inset_0_1px_4px_rgba(15,23,42,0.12)]",
					ANIMATE,
				)}
				style={{
					width: done ? "100%" : cutPct,
					clipPath: done ? WEDGE_DONE : WEDGE_CUTTING,
				}}
				aria-hidden
			/>
			{/* The dotted line, running right up to the blades. */}
			{done ? null : (
				<div
					className={cn(
						"absolute left-3.5 top-[calc(50%-1px)] border-t-2 border-dashed",
						STAGE_DASH[stage],
						ANIMATE,
					)}
					style={{ right: `calc(${cutPct} + 9px)` }}
					aria-hidden
				/>
			)}
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
					opacity: 0.5,
					filter: SMUDGE,
				}}
				aria-hidden
			>
				<StripRow icon={icon} label={label} digits={digits} />
			</div>
			<div
				className={cn(
					ghostBase,
					"translate-y-[1px] translate-x-[0.5px] skew-x-[2deg]",
					ANIMATE,
				)}
				style={{
					clipPath: done ? "inset(50% 0 0 0)" : `inset(50% 0 0 ${sealedPct})`,
					opacity: 0.45,
					filter: SMUDGE,
				}}
				aria-hidden
			>
				<StripRow icon={icon} label={label} digits={digits} />
			</div>
			{/* The blades, always sitting ON the cut. Mirrored so they point the
			    way they travel. */}
			<div
				className={cn("absolute top-1/2 -translate-y-1/2", ANIMATE)}
				style={{ left: done ? "-4px" : `calc(${sealedPct} - 10px)` }}
				aria-hidden
			>
				<Scissors
					className={cn(
						"size-5 -scale-x-100",
						done ? "text-muted-foreground" : "text-foreground",
					)}
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
				className="rounded-none border-b border-border/70 ring-0 shadow-[0_1px_6px_rgba(15,23,42,0.06)]"
			/>
		</div>
	);
}
