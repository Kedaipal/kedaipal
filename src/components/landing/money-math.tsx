import { Link } from "@tanstack/react-router";
import { m } from "../../paraglide/messages";
import {
	FoodpandaIcon,
	GrabIcon,
	ShopeeIcon,
	TikTokIcon,
} from "../dashboard/brand-icons";

/**
 * "The money math" (ClickUp 86eye3p6z §A) — the cost context a visitor needs
 * BEFORE they meet RM79/149/299, mounted directly above the pricing teaser.
 *
 * This is a POSITIONING claim, not a savings claim, and the copy is written to
 * stay on the right side of that line. A seller's WhatsApp orders already cost
 * them 0%, so Kedaipal is an added cost on those orders — the page may say "we
 * never take a cut at any volume", it may NOT say "save RM900 vs Shopee".
 * Shopee leads (a marketplace, like us) rather than GrabFood, whose 15–22% also
 * buys a rider fleet we don't provide. `mm_note` carries that caveat in full.
 *
 * The calculator lives at the EXISTING `/cost` page rather than a second `/kira`
 * route — `/cost` already runs the exact formula (`src/lib/calculator.ts`), is
 * SSR'd, localised and shareable via prefill params, so a parallel page would be
 * two things to keep in sync for zero gain.
 */

/**
 * Published 2026 rates (Shopee/GrabFood/foodpanda verified on the ticket;
 * TikTok Shop verified 29 Aug 2026 against the post-Feb-2026 MY rate card —
 * ~10.3% top commission + ~4.9% opt-in Bonus Cashback + ~3.8% transaction
 * fee ≈ 18.9% for a full-programme seller, hence "up to ~19%"). `pct` is the
 * TOP of each published range and only drives bar width — the visible label
 * is the honest range. Shopee and TikTok Shop are both "up to ~", never
 * flat: commissions are category-based and their biggest slices (Free
 * Shipping / Bonus Cashback) are opt-in, per `mm_note`.
 */
const MARKETPLACE_RATES = [
	{
		id: "shopee",
		name: "Shopee",
		Icon: ShopeeIcon,
		iconClass: "text-[#EE4D2D]",
		pct: 20,
		rate: () => m.mm_rate_shopee(),
	},
	{
		id: "tiktok-shop",
		name: "TikTok Shop",
		Icon: TikTokIcon,
		iconClass: "text-foreground",
		pct: 19,
		rate: () => m.mm_rate_tiktok(),
	},
	{
		id: "grabfood",
		name: "GrabFood",
		Icon: GrabIcon,
		iconClass: "text-[#00B14F]",
		pct: 22,
		rate: () => "15–22%",
	},
	{
		id: "foodpanda",
		name: "foodpanda",
		Icon: FoodpandaIcon,
		iconClass: "text-[#D70F64]",
		pct: 20,
		rate: () => "12–20%",
	},
] as const;


/**
 * One-line variant for `/pricing`, where the tier cards are already the focus —
 * the same rates, no chart, sitting between the hero and the cards so the
 * numbers below arrive with context.
 */
export function MoneyMathRow() {
	return (
		<section aria-label={m.mm_label()} className="bg-background">
			<div className="mx-auto max-w-6xl px-5 md:px-8">
				<div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-x-7 gap-y-3 rounded-3xl border border-border bg-card px-6 py-5 shadow-sm">
					{MARKETPLACE_RATES.map((row) => (
						<span
							key={row.id}
							className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground"
						>
							<row.Icon className={`size-4 shrink-0 ${row.iconClass}`} />
							{row.name}{" "}
							<strong className="font-bold text-red-700 dark:text-red-300">
								{row.rate()}
							</strong>
						</span>
					))}
					<span
						aria-hidden
						className="hidden h-5 w-px bg-border sm:inline-block"
					/>
					<span className="inline-flex items-center gap-2 text-[13px] font-bold">
						<img
							src="/logo.svg"
							alt=""
							width={78}
							height={68}
							loading="lazy"
							className="size-4 shrink-0"
						/>
						Kedaipal
						<span className="rounded-full bg-accent px-3 py-0.5 text-[13px] font-extrabold text-accent-foreground">
							0%
						</span>
						<span className="font-semibold text-accent-emphasis">
							{m.mm_bar_kedaipal_value()}
						</span>
					</span>
					<Link
						to="/cost"
						className="inline-flex min-h-11 items-center text-[13px] font-semibold text-accent underline-offset-4 hover:underline"
					>
						{m.mm_cta()} →
					</Link>
				</div>
			</div>
		</section>
	);
}
