import { useInView, useReducedMotion } from "framer-motion";
import { Snowflake, Truck, Zap } from "lucide-react";
import { useRef } from "react";
import {
	BILLING_CURRENCY_FOR_COUNTRY,
	type BillingCurrency,
} from "../../../convex/lib/plans";
import { useBeatLoop } from "../../hooks/useBeatLoop";
import { useLandingRegionContext } from "../../hooks/useLandingRegion";
import {
	type Courier,
	couriersFor,
	hasParcelCouriers,
	mockQuotes,
	type QuotedCourier,
} from "../../lib/couriers";
import { formatPrice } from "../../lib/format";
import { cn } from "../../lib/utils";
import { m } from "../../paraglide/messages";
import { AppImage } from "../ui/app-image";
import { FadeIn } from "./fade-in";
import {
	Eyebrow,
	LogoMarqueeRow,
	logoPillClass,
	RegionToggle,
} from "./landing-ui";

/**
 * Delivery — "Book the courier from the order. Cold chain included." (landing
 * v2, ClickUp z8r3fdegej). The section the target tier (Pro) is sold on: a
 * seller quotes their own Delyva couriers from the order, cheapest first,
 * parcel / chilled / frozen, and the buyer gets the tracking number on
 * WhatsApp. Lalamove covers the same-day rider case.
 *
 * Two halves. Left: the claim, three bullets, the courier catalogue
 * (`src/lib/couriers.ts` — a grid on md+, one auto-scrolling rail below it;
 * seventeen tiles two-up ran 1,300px on a phone in the design review) and the
 * cold-chain footnote. Right: a mock of the real dispatch card
 * (`delyva-dispatch-card.tsx` — weight, parcel type, quote list with the
 * cheapest pre-selected and "buyer paid" beside it, then the book button),
 * looping quote → book → shipped so the section moves like the rest.
 *
 * MY/SG share the page's one region (`LandingRegionProvider`): the toggle
 * here and the one in Pricing move the same state. For SG the Delyva tenant
 * has no couriers enabled yet (docs/delivery-delyva.md, 3 Sep) — the
 * catalogue hides those rows, the rail shows what IS live (Lalamove), and a
 * one-line note says the rest is being enabled. Honest beats a logo wall for a
 * courier the seller can't book.
 *
 * Every courier mark is a brand-approved SVG under `public/img/courier/` or a
 * name chip with the same initials avatar the real dispatch card uses for a
 * courier we hold no logo for — never a hot-linked PNG (the design mock's
 * placeholders were exactly that, and the AC says local assets only).
 */

/** Beat durations, ms: quoting → quotes in → cheapest chosen → booked → shipped → clear. */
const BEATS = [1100, 1400, 1100, 1300, 2600, 450] as const;

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
	return (
		<span className={cn(logoPillClass, "h-11 pl-1.5 pr-3.5")}>
			{courier.src ? (
				<AppImage
					src={courier.src}
					alt={hidden ? "" : courier.name}
					aspect={courier.markClass ?? "h-5 w-auto"}
					fill={false}
					className="ml-2"
				/>
			) : (
				<>
					<span
						aria-hidden
						className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-primary text-[11px] font-bold text-primary-foreground"
					>
						{initials(courier.name)}
					</span>
					<span className="text-sm font-bold text-slate-800">
						{courier.name}
					</span>
				</>
			)}
			{courier.group === "cold" ? (
				<span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent-emphasis">
					<Snowflake className="size-3" />
					{m.delivery_cold()}
				</span>
			) : null}
		</span>
	);
}

function CourierCatalogue({ couriers }: { couriers: Courier[] }) {
	return (
		<>
			{/* md+: the grid, every chip visible at once. */}
			<ul
				className="hidden flex-wrap gap-2.5 md:flex"
				aria-label={m.delivery_label()}
			>
				{couriers.map((c) => (
					<li key={c.id}>
						<CourierChip courier={c} />
					</li>
				))}
			</ul>
			{/* Below md: one rail, edge-faded so it reads as passing through. */}
			{/* `contain-inline-size`: the rail's track must not feed the grid's
			    intrinsic sizing — without it the column grew past the viewport by
			    the chips' shadows and the page scrolled sideways at 390. */}
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
 * type → quote list → book flow (`delyva-dispatch-card.tsx`), looping. Decorative
 * (`aria-hidden`) — the copy column carries the content — and fixed-height so
 * the beats never shift the page.
 */
function DispatchPlay({
	currency,
	quotes,
}: {
	currency: BillingCurrency;
	quotes: QuotedCourier[];
}) {
	const stageRef = useRef<HTMLDivElement>(null);
	const inView = useInView(stageRef, { margin: "-10% 0px" });
	const reduced = useReducedMotion() ?? false;
	const beat = useBeatLoop(!reduced && inView, BEATS);

	// Reduced motion: the whole story as one still — quotes in, cheapest
	// chosen, booked.
	const quotesIn = reduced || beat >= 1;
	const chosen = reduced || beat >= 2;
	const booked = reduced || beat >= 3;
	const shipped = !reduced && beat === 4;
	const cheapest = quotes[0];
	const buyerPaid = cheapest ? cheapest.mockQuote * 1.15 : 800;

	return (
		<div
			ref={stageRef}
			aria-hidden="true"
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
				<span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
					<AppImage
						src="/img/delyva-logo.png"
						alt=""
						aspect="size-3.5"
						fill={false}
					/>
					Delyva
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
							["chilled", m.delivery_quote_chilled()],
							["frozen", m.delivery_quote_frozen()],
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
					{m.delivery_quote_choose()}
				</span>
				<span className="text-[11px] text-muted-foreground">
					{m.delivery_quote_buyer_paid({
						amount: formatPrice(Math.round(buyerPaid), currency),
					})}
				</span>
			</div>
			{/* Fixed height for three rows so the beats never resize the card. */}
			<div className="mt-2 flex h-[13.75rem] flex-col gap-2">
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

			<div
				className={cn(
					"mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors duration-500 motion-reduce:transition-none",
					booked
						? "bg-primary text-primary-foreground"
						: "bg-accent text-accent-foreground",
				)}
			>
				<Truck className="size-4" />
				{cheapest
					? shipped
						? m.hero_after_status_4()
						: m.delivery_quote_book({
								courier: cheapest.name,
								price: formatPrice(cheapest.mockQuote, currency),
							})
					: m.delivery_quote_title()}
			</div>
			<p className="mt-2.5 text-xs text-muted-foreground">
				{m.delivery_quote_note()}
			</p>
		</div>
	);
}

export function Delivery() {
	const [region, setRegion] = useLandingRegionContext();
	const currency = BILLING_CURRENCY_FOR_COUNTRY[region];
	const couriers = couriersFor(region);
	const quotes = mockQuotes(region);
	const parcelsLive = hasParcelCouriers(region);
	const riderLive = couriers.some((c) => c.group === "sameday");

	return (
		<section
			id="delivery"
			aria-labelledby="delivery-heading"
			className="border-t border-border bg-background"
		>
			<div className="mx-auto max-w-6xl px-5 py-20 md:px-8 md:py-24">
				<div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-16">
					{/* `min-w-0`: the mobile rail's track is thousands of px wide, and a
					    grid item's automatic minimum would size the column to it — the
					    whole page then scrolls sideways (caught at 390 in verification). */}
					<div className="min-w-0">
						<FadeIn>
							<div className="flex flex-wrap items-center justify-between gap-3">
								<Eyebrow>{m.delivery_label()}</Eyebrow>
								<RegionToggle region={region} onChange={setRegion} />
							</div>
							<h2
								id="delivery-heading"
								className="mt-4 max-w-xl text-3xl font-bold leading-[1.1] md:text-5xl"
								style={{ letterSpacing: "-0.02em" }}
							>
								{m.delivery_heading()}
							</h2>
							<p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
								{m.delivery_sub()}
							</p>
							<ul className="mt-6 flex flex-col gap-3">
								{(
									[
										[Truck, m.delivery_point_1()],
										[Snowflake, m.delivery_point_2()],
										// The rider bullet only where a rider is actually bookable.
										...(riderLive
											? [[Zap, m.delivery_point_3()] as const]
											: []),
									] as const
								).map(([Icon, text]) => (
									<li
										key={text}
										className="flex items-start gap-3 text-sm md:text-base"
									>
										<span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent-emphasis">
											<Icon className="size-3.5" />
										</span>
										{text}
									</li>
								))}
							</ul>
						</FadeIn>

						<FadeIn delay={0.1}>
							<div className="mt-8">
								<CourierCatalogue couriers={couriers} />
							</div>
							<p className="mt-4 text-xs leading-relaxed text-muted-foreground">
								{parcelsLive ? m.delivery_cold_note() : m.delivery_sg_note()}
							</p>
						</FadeIn>
					</div>

					<FadeIn delay={0.15}>
						<DispatchPlay currency={currency} quotes={quotes} />
					</FadeIn>
				</div>
			</div>
		</section>
	);
}
