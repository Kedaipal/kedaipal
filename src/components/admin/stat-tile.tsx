import type { ReactNode } from "react";
import type { Tone } from "../../lib/tone";

/** The tones a billing stat tile can take — the TONE subset this page uses. */
export type StatTileTone = Extract<
	Tone,
	"neutral" | "info" | "warn" | "success" | "danger" | "progress"
>;

/**
 * Tile surfaces. The LIGHT half is the page's own (`text-X-800` where
 * TONE_PANEL reads `-700` — adopting the registry would repaint blue + emerald
 * in light, see lib/tone.ts). The DARK half is TONE_PANEL's: a half-strength
 * `-950/50` fill with `-100` ink, the house recipe for a tinted card on a dark
 * page. Full-strength `-950` fills read as loud slabs of colour there.
 *
 * `danger` used to be `text-destructive` on `bg-destructive/10` — 2.4:1 for the
 * helper in light, ~3:1 in dark — so it now follows the same pattern.
 */
const SURFACE: Record<StatTileTone, string> = {
	neutral: "border-border bg-muted/50 text-foreground",
	info: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-100",
	warn: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100",
	success:
		"border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100",
	progress:
		"border-purple-200 bg-purple-50 text-purple-800 dark:border-purple-900 dark:bg-purple-950/50 dark:text-purple-100",
	danger:
		"border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-100",
};

export type StatTileProps = {
	label: string;
	/**
	 * The figure. A list is several money amounts (one per currency): each is
	 * kept whole on its own line-piece and they wrap at the " + ", never inside
	 * "RM 149.00" — and never truncated, because the figure IS the tile.
	 */
	value: string | readonly string[];
	helper: string;
	icon: ReactNode;
	tone: StatTileTone;
};

/**
 * One stat tile for the admin billing page (z8r3fdwf9t). Both rows — the
 * invoice figures and the credit totals — render through this, because they
 * had been two hand-copied tiles that drifted: one row's icon well was
 * `bg-white/70` in BOTH themes (a near-white disc with a pale icon on it in
 * dark), the other's `bg-background/70`.
 *
 * - The well is white in light, and in dark the tile's OWN ink at 15%
 *   (`bg-current/15`), so it tints per tone and the icon always reads on it.
 * - Layout answers to the TILE's width, not the viewport's (a container
 *   query): a narrow tile — two-up on a 375px phone is 160px — stacks the icon
 *   above the text so the figure gets the full width; a wider one sits them
 *   side by side. A viewport breakpoint would get the full-width odd tile on a
 *   phone (StatTileGrid) wrong.
 * - Label and helper sit at 85% ink, not 70%: at 70% the 11px helper measured
 *   3.6–4.1:1 on the tinted tiles in light, under AA.
 */
export function StatTile({ label, value, helper, icon, tone }: StatTileProps) {
	const amounts = typeof value === "string" ? [value] : value;
	return (
		<div className={`@container rounded-2xl border px-3 py-3 ${SURFACE[tone]}`}>
			<div className="flex flex-col items-start gap-2 @[10rem]:flex-row @[10rem]:items-center @[10rem]:gap-3">
				<div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/70 dark:bg-current/15">
					{icon}
				</div>
				<div className="min-w-0">
					<p className="text-xs font-medium opacity-85">{label}</p>
					<p className="font-mono text-lg font-bold leading-tight">
						{amounts.map((amount, i) => (
							<span key={amount}>
								{i > 0 ? " + " : null}
								<span className="whitespace-nowrap">{amount}</span>
							</span>
						))}
					</p>
					{/* Wraps: the helper IS the explanation — cut off, it read
					    "across 0 stores · service still …". */}
					<p className="text-[11px] leading-snug text-pretty opacity-85">
						{helper}
					</p>
				</div>
			</div>
		</div>
	);
}

/** Static so Tailwind sees every class it may need. */
const LG_COLS: Record<number, string> = {
	1: "lg:grid-cols-1",
	2: "lg:grid-cols-2",
	3: "lg:grid-cols-3",
	4: "lg:grid-cols-4",
};

/**
 * A row of stat tiles that never leaves a hole: on desktop the row has exactly
 * as many columns as tiles (three credit tiles fill the width rather than
 * leaving a fourth slot empty), and on a phone's two-up grid an odd last tile
 * spans the full row instead of sitting beside nothing.
 */
export function StatTileGrid({ tiles }: { tiles: readonly StatTileProps[] }) {
	const oddLast = tiles.length % 2 === 1;
	return (
		<div
			className={`grid grid-cols-2 gap-2 ${LG_COLS[Math.min(tiles.length, 4)] ?? ""}`}
		>
			{tiles.map((tile, i) => (
				<div
					key={tile.label}
					className={
						oddLast && i === tiles.length - 1
							? "col-span-2 grid lg:col-span-1"
							: "grid"
					}
				>
					<StatTile {...tile} />
				</div>
			))}
		</div>
	);
}
