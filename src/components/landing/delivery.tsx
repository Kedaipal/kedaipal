import { Check, Loader2, Snowflake, Truck } from "lucide-react";
import type { BillingCurrency } from "../../../convex/lib/plans";
import type {
	Courier,
	CourierProvider,
	QuotedCourier,
} from "../../lib/couriers";
import { formatPrice } from "../../lib/format";
import { cn } from "../../lib/utils";
import { m } from "../../paraglide/messages";
import { AppImage } from "../ui/app-image";
import { LogoMarqueeRow, logoPillClass } from "./landing-ui";

/**
 * Delivery — the courier catalogue and the dispatch-card mock, phase 03 of
 * the seller-flow walkthrough (`seller-flow.tsx`, 19 Oct 2026; it was its own
 * section, "Book the courier from the order. Cold chain included.", from
 * landing v2 until then — the walkthrough's step copy carries the claim now).
 * A seller quotes their own Delyva couriers from the order, cheapest first,
 * parcel / chilled / frozen, and the buyer gets the tracking number on their
 * order page. Lalamove covers the same-day rider case.
 *
 * The catalogue (`src/lib/couriers.ts`) is a grid on md+, one auto-scrolling
 * rail below it (seventeen tiles two-up ran 1,300px on a phone in the design
 * review). The card mocks the real dispatch card (`delyva-dispatch-card.tsx`
 * — weight, parcel type, quote list with the cheapest pre-selected and
 * "buyer paid" beside it, then the book button), quote → book → shipped. The
 * first beat is a STATE, not a gap (15 Oct 2026 canvas, artboard 3 + M3):
 * skeleton rows hold the list's height while "20+ couriers" are asked and the
 * book button is a disabled "Getting quotes…" — the old loop opened on an
 * empty list under a button that already named a courier and a price.
 *
 * The walkthrough passes the page's one region (`LandingRegionProvider`). For
 * SG the Delyva tenant has no couriers enabled yet (docs/delivery-delyva.md,
 * 3 Sep) — the catalogue hides those rows, the rail shows what IS live
 * (Lalamove), and the walkthrough's note says the rest is being enabled.
 * Honest beats a logo wall for a courier the seller can't book, and the
 * step copy follows (`flow_step_3_body_rider` where no parcel lane is live).
 * The card reads the provider off the quoted row the same way: a Lalamove
 * quote is booked on the seller's Lalamove wallet, not Delyva credit
 * (`docs/delivery-lalamove.md`), and its badge, note and shipped line say so.
 *
 * Every courier mark is a brand-approved SVG under `public/img/courier/` or a
 * name chip with the same initials avatar the real dispatch card uses for a
 * courier we hold no logo for — never a hot-linked PNG (the design mock's
 * placeholders were exactly that, and the AC says local assets only).
 */

/** Beat holds, ms: asking → quotes in → cheapest chosen → booked → shipped. The
 *  walkthrough's timeline reads these (`seller-flow-timeline.ts`). */
export const DISPATCH_BEATS = [1100, 1400, 1100, 1300, 2600] as const;
/** The beat that shows the booked courier as shipped (`delivery.test.tsx` drives to it). */
export const SHIPPED_BEAT = 4;
/** Skeleton rows on the asking beat — the real card's loading state, three deep. */
const SKELETON_ROWS = 3;

/**
 * The integration badge on the mock card follows the quoted row's provider.
 * Delyva's emblem is square and needs the name beside it; Lalamove's mark is a
 * wordmark and IS the name.
 */
const PROVIDER_BADGE: Record<
	CourierProvider,
	{ name: string; src: string; markClass: string; wordmark: boolean }
> = {
	delyva: {
		name: "Delyva",
		src: "/img/delyva-logo.png",
		markClass: "size-3.5",
		wordmark: false,
	},
	lalamove: {
		name: "Lalamove",
		src: "/img/lalamove-logo.svg",
		markClass: "h-3 w-auto",
		wordmark: true,
	},
};

/** Two-letter mark — the real dispatch card's fallback for a courier with no logo. */
function initials(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return "??";
	if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
	return (words[0][0] + words[1][0]).toUpperCase();
}

function CourierChip({
	courier,
	hidden = false,
}: {
	courier: Courier;
	hidden?: boolean;
}) {
	const showName = !courier.src || Boolean(courier.borrowsMarkFrom);
	return (
		<span className={cn(logoPillClass, "h-11 px-4")}>
			{courier.src ? (
				<AppImage
					src={courier.src}
					// A borrowed mark is decorative here: the name beside it is the label.
					alt={hidden || courier.borrowsMarkFrom ? "" : courier.name}
					aspect={courier.markClass ?? "h-5 w-auto"}
					fill={false}
					// Eager: the mobile rail drifts, and a lazy mark would enter the
					// viewport blank (same rule as the payment wall).
					eager
				/>
			) : (
				<span
					aria-hidden
					className="-ml-2.5 flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-primary text-[11px] font-bold text-primary-foreground"
				>
					{initials(courier.name)}
				</span>
			)}
			{showName ? (
				// dark-ok: ink on the white brand plate (logoPillClass), both themes.
				<span className="text-sm font-bold text-slate-800">{courier.name}</span>
			) : null}
			{courier.group === "cold" ? (
				<span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent-emphasis">
					<Snowflake className="size-3" />
					{m.delivery_cold()}
				</span>
			) : null}
		</span>
	);
}

/** Fewer chips than this and a looping rail just repeats one logo — show the grid. */
const RAIL_MIN = 4;

export function CourierCatalogue({ couriers }: { couriers: Courier[] }) {
	const rail = couriers.length >= RAIL_MIN;
	return (
		<>
			{/* md+: the grid, every chip visible at once (and every size, when the
			    region has too few couriers for a rail to make sense). */}
			<ul
				className={cn("flex-wrap gap-2.5 md:flex", rail ? "hidden" : "flex")}
				aria-label={m.delivery_catalogue_label()}
			>
				{couriers.map((c) => (
					<li key={c.id}>
						<CourierChip courier={c} />
					</li>
				))}
			</ul>
			{/* Below md: one rail, edge-faded so it reads as passing through.
			    `contain-inline-size`: the rail's track must not feed the grid's
			    intrinsic sizing — without it the column grew past the viewport and
			    the page scrolled sideways at 390. */}
			{rail ? (
				<div
					className="-mx-5 overflow-hidden contain-inline-size md:hidden"
					style={{
						maskImage:
							"linear-gradient(to right, transparent, black 8%, black 92%, transparent)",
						WebkitMaskImage:
							"linear-gradient(to right, transparent, black 8%, black 92%, transparent)",
					}}
				>
					<LogoMarqueeRow className="px-5">
						{(hidden) =>
							couriers.map((c) => (
								<CourierChip key={c.id} courier={c} hidden={hidden} />
							))
						}
					</LogoMarqueeRow>
				</div>
			) : null}
		</>
	);
}

function quoteMeta(courier: Courier): string {
	const cold = courier.group === "cold" ? m.delivery_quote_coldchain() : null;
	const speed =
		courier.speed === "sameday"
			? m.delivery_quote_sameday()
			: m.delivery_quote_nextday();
	return [cold, speed, courier.name].filter(Boolean).join(" · ");
}

/**
 * The dispatch card, as a still that moves: the real card's weight → parcel
 * type → quote list → book flow (`delyva-dispatch-card.tsx`). Phase 03 of the
 * seller-flow walkthrough, which owns the clock, the region and the
 * `aria-hidden` frame; the beat comes in. Fixed-height so the beats never
 * shift the page.
 */
export function DispatchCard({
	beat,
	reduced,
	currency,
	quotes,
	parcelsLive,
}: {
	beat: number;
	/** Reduced motion: the shipped frame as one still. */
	reduced: boolean;
	currency: BillingCurrency;
	quotes: QuotedCourier[];
	/** Whether the region has a parcel network to ask — SG asks one rider. */
	parcelsLive: boolean;
}) {
	// Reduced motion: the last story beat as one still — quotes in, cheapest
	// chosen, booked and shipped.
	const quotesIn = reduced || beat >= 1;
	const chosen = reduced || beat >= 2;
	const booked = reduced || beat >= 3;
	const shipped = reduced || beat === SHIPPED_BEAT;
	const cheapest = quotes[0];
	// Row count is fixed per region so the asking beat holds the exact height
	// the quotes will take; SG's one rider gets one skeleton, not three.
	const rowCount = quotes.length > 0 ? quotes.length : SKELETON_ROWS;
	const buyerPaid = cheapest ? cheapest.mockQuote * 1.15 : 800;
	const badge = PROVIDER_BADGE[cheapest?.provider ?? "delyva"];
	const rider = cheapest?.provider === "lalamove";

	return (
		<div
			// `contain-inline-size`: the quote rows carry nowrap (truncated) meta
			// lines whose full width would otherwise size the mobile grid column
			// past the viewport — the card must take its width from the page,
			// never hand one up.
			className="mx-auto w-full max-w-sm rounded-3xl border border-border bg-card p-5 shadow-2xl shadow-primary/10 contain-inline-size"
		>
			<div className="flex items-center justify-between gap-2">
				<p className="flex items-center gap-2 text-sm font-semibold">
					<Truck className="size-4 text-accent" />
					{m.delivery_quote_title()}
				</p>
				<span
					className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground"
					data-testid="dispatch-provider"
					data-provider={cheapest?.provider ?? "delyva"}
				>
					<AppImage
						src={badge.src}
						alt=""
						aspect={badge.markClass}
						fill={false}
					/>
					{badge.wordmark ? null : badge.name}
				</span>
			</div>

			<div className="mt-4 flex flex-col gap-1.5">
				<div className="flex items-center justify-between">
					<span className="text-xs font-medium text-muted-foreground">
						{m.delivery_quote_weight()}
					</span>
					<span className="text-[11px] text-muted-foreground">
						{m.delivery_quote_weight_hint()}
					</span>
				</div>
				<div className="flex items-center gap-2">
					<span className="flex h-10 w-24 items-center rounded-lg border border-input bg-background px-3 text-sm">
						{m.delivery_quote_weight_value()}
					</span>
					<span className="text-sm text-muted-foreground">kg</span>
				</div>
			</div>

			<div className="mt-3 flex flex-col gap-1.5">
				<span className="text-xs font-medium text-muted-foreground">
					{m.delivery_quote_type()}
				</span>
				<div className="flex flex-wrap gap-2">
					{(
						[
							["parcel", m.delivery_quote_parcel()],
							// The cold lanes exist only where a parcel network is live —
							// Singapore's one rider has no chilled or frozen option.
							...(parcelsLive
								? ([
										["chilled", m.delivery_quote_chilled()],
										["frozen", m.delivery_quote_frozen()],
									] as const)
								: []),
						] as const
					).map(([key, label]) => {
						const active =
							key === (cheapest?.group === "cold" ? "chilled" : "parcel");
						return (
							<span
								key={key}
								className={cn(
									"flex h-9 items-center gap-1.5 rounded-full border-2 px-3.5 text-xs font-medium",
									active
										? "border-accent bg-accent/[0.08] font-semibold text-accent-emphasis"
										: "border-border bg-card text-muted-foreground",
								)}
							>
								{key !== "parcel" ? <Snowflake className="size-3" /> : null}
								{label}
							</span>
						);
					})}
				</div>
			</div>

			<div className="mt-4 flex items-baseline justify-between gap-2">
				<span className="text-xs font-medium text-muted-foreground">
					{quotesIn
						? m.delivery_quote_choose()
						: parcelsLive
							? m.delivery_quote_asking()
							: m.delivery_quote_asking_rider()}
				</span>
				<span className="text-[11px] text-muted-foreground">
					{m.delivery_quote_buyer_paid({
						amount: formatPrice(Math.round(buyerPaid), currency),
					})}
				</span>
			</div>
			{/* Fixed height per row count, so the beats never resize the card. */}
			<div
				className="relative mt-2 flex flex-col gap-2"
				style={{
					height: `${rowCount * 4.25 + Math.max(rowCount - 1, 0) * 0.5}rem`,
				}}
			>
				{/* The asking beat: shimmering placeholders in the rows' own shape,
				    fading out as the first quote lands. */}
				<div
					aria-hidden
					data-testid="dispatch-skeleton"
					className={cn(
						"absolute inset-0 flex flex-col gap-2 transition-opacity duration-300 motion-reduce:transition-none",
						quotesIn ? "opacity-0" : "opacity-100",
					)}
				>
					{Array.from({ length: rowCount }, (_, i) => (
						<div
							// biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows, never reordered
							key={i}
							className="flex h-[4.25rem] items-center gap-2.5 rounded-2xl border-2 border-border bg-card p-2.5"
						>
							<span className="animate-kp-shimmer size-9 shrink-0 rounded-[10px]" />
							<span className="flex grow flex-col gap-1.5">
								<span
									className="animate-kp-shimmer h-2.5 rounded-full"
									style={{ width: `${[45, 55, 40][i % 3]}%` }}
								/>
								<span
									className="animate-kp-shimmer h-2 rounded-full"
									style={{ width: `${[30, 28, 34][i % 3]}%` }}
								/>
							</span>
							<span className="animate-kp-shimmer h-2.5 w-12 shrink-0 rounded-full" />
						</div>
					))}
				</div>
				{quotes.map((courier, index) => {
					const active = chosen && index === 0;
					return (
						<div
							key={courier.id}
							className={cn(
								"flex items-center gap-2.5 rounded-2xl border-2 p-2.5 transition-all duration-500 motion-reduce:transition-none",
								quotesIn
									? "translate-y-0 opacity-100"
									: "translate-y-2 opacity-0",
								active ? "border-accent bg-accent/5" : "border-border bg-card",
							)}
							style={{ transitionDelay: quotesIn ? `${index * 90}ms` : "0ms" }}
						>
							<span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-primary text-xs font-bold text-primary-foreground">
								{initials(courier.name)}
							</span>
							<span className="flex min-w-0 grow flex-col gap-0.5">
								<span className="truncate text-sm font-semibold">
									{courier.name}
								</span>
								<span className="truncate text-xs text-muted-foreground">
									{quoteMeta(courier)}
								</span>
							</span>
							<span className="flex shrink-0 flex-col items-end gap-1">
								<span className="text-sm font-bold">
									{formatPrice(courier.mockQuote, currency)}
								</span>
								{index === 0 && quotes.length > 1 ? (
									<span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent-emphasis">
										{m.delivery_quote_cheapest()}
									</span>
								) : null}
							</span>
							<span
								className={cn(
									"flex size-4 shrink-0 items-center justify-center rounded-full border-2",
									active ? "border-accent" : "border-border",
								)}
							>
								{active ? (
									<span className="size-2 rounded-full bg-accent" />
								) : null}
							</span>
						</div>
					);
				})}
			</div>

			{/* The book button walks its four states; it never names a courier
			    before a quote exists. Disabled grey while asking, mint to book,
			    navy once booked (tick scales in), the truck slides in on shipped. */}
			<div
				data-testid="dispatch-button"
				className={cn(
					"mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors duration-500 motion-reduce:transition-none",
					!quotesIn || !cheapest
						? "bg-muted text-muted-foreground"
						: booked
							? "bg-primary text-primary-foreground"
							: "bg-accent text-accent-foreground",
				)}
			>
				{!quotesIn || !cheapest ? (
					<>
						<Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
						{m.delivery_quote_getting()}
					</>
				) : shipped ? (
					<>
						<Truck
							key="shipped"
							className={cn("size-4", !reduced && "animate-kp-drive")}
						/>
						{m.delivery_quote_shipped({ courier: cheapest.name })}
					</>
				) : booked ? (
					<>
						<Check
							key="booked"
							strokeWidth={3}
							className={cn(
								"size-4 text-accent dark:text-current",
								!reduced && "animate-kp-pop",
							)}
						/>
						{m.delivery_quote_booked({ courier: cheapest.name })}
					</>
				) : (
					<>
						<Truck className="size-4" />
						{m.delivery_quote_book({
							courier: cheapest.name,
							price: formatPrice(cheapest.mockQuote, currency),
						})}
					</>
				)}
			</div>
			<p className="mt-2.5 text-xs text-muted-foreground">
				{rider ? m.delivery_quote_note_rider() : m.delivery_quote_note()}
			</p>
		</div>
	);
}
