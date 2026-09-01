import { BatteryFull, Signal, Wifi } from "lucide-react";
import { WhatsAppIcon } from "../dashboard/brand-icons";

/**
 * The storefront rendered inside the hero's iPhone mockup (hero-device.tsx).
 * Owns the whole screen surface: status bar, dynamic island, storefront,
 * cart bar. Product tiles carry real (AI-generated) photography — a
 * deliberate exception to the house no-raster mockup style
 * (`how-it-works-mockups.tsx`), because this one mock is the hero's promise
 * of what a seller's storefront can look like, and gradient blocks
 * undersold it (owner call, 29 Aug). See PRODUCTS below for the pipeline.
 *
 * Decorative by design — the device frame carries the accessible label
 * (`hero_phone_alt`), so the copy here stays as literals, matching the bento
 * cards' "Aisyah Rahim" / "K7" precedent.
 */

// Six products so the third row clips behind the cart bar — the cut-off row
// is what makes the mock read as a real scrollable storefront rather than a
// four-item poster (the grid wrapper is overflow-hidden). Photos are a
// Higgsfield-generated set (one consistent style: cream ground, soft window
// light, mint linen accent — the brand palette in photographic form),
// sourced in `assets/landing/` and emitted by `pnpm optimize:images`
// (5–15 KB AVIF/WebP per tile).
const PRODUCTS = [
	{ name: "Kek Batik Premium", price: "RM 28", image: "product-kek-batik" },
	{ name: "Sambal Nyet 250g", price: "RM 15", image: "product-sambal" },
	{ name: "Kuih Raya Set", price: "RM 35", image: "product-kuih-raya" },
	{ name: "Frozen Pau (12)", price: "RM 18", image: "product-pau" },
	{ name: "Brownies (6)", price: "RM 22", image: "product-brownies" },
	{ name: "Ayam Percik Set", price: "RM 24", image: "product-ayam-percik" },
];

export function PhoneScreenMockup() {
	return (
		<div className="flex h-full w-full flex-col bg-white font-sans">
			{/* Status bar + dynamic island */}
			<div className="relative shrink-0 bg-white">
				<div className="flex items-center justify-between px-7 pb-1 pt-3.5">
					<span className="text-[12px] font-semibold tracking-tight text-slate-900">
						9:41
					</span>
					<span className="flex items-center gap-1 text-slate-900">
						<Signal className="size-3" strokeWidth={2.5} />
						<Wifi className="size-3" strokeWidth={2.5} />
						<BatteryFull className="size-3.5" strokeWidth={2} />
					</span>
				</div>
				<span className="absolute left-1/2 top-2.5 h-[21px] w-[76px] -translate-x-1/2 rounded-full bg-slate-950" />
			</div>

			{/* Store header */}
			<div className="shrink-0 px-4 pt-2">
				<div className="flex items-center gap-2.5">
					<span className="flex size-9 items-center justify-center rounded-full bg-emerald-500 text-[13px] font-extrabold text-white">
						KS
					</span>
					<div className="min-w-0">
						<p className="text-[13px] font-bold leading-tight text-slate-900">
							Kek Sayang Bakery
						</p>
						<p className="text-[9.5px] font-medium text-emerald-600">
							kedaipal.com/kek-sayang
						</p>
					</div>
				</div>
				<div className="mt-2.5 flex gap-1.5">
					<span className="rounded-full bg-slate-900 px-2.5 py-1 text-[9px] font-bold text-white">
						All
					</span>
					<span className="rounded-full bg-slate-100 px-2.5 py-1 text-[9px] font-semibold text-slate-500">
						Kek
					</span>
					<span className="rounded-full bg-slate-100 px-2.5 py-1 text-[9px] font-semibold text-slate-500">
						Kuih
					</span>
					<span className="rounded-full bg-slate-100 px-2.5 py-1 text-[9px] font-semibold text-slate-500">
						Frozen
					</span>
				</div>
			</div>

			{/* Product grid */}
			<div className="mt-3 grid flex-1 auto-rows-max grid-cols-2 content-start gap-2.5 overflow-hidden px-4">
				{PRODUCTS.map((p) => (
					<div
						key={p.name}
						className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm"
					>
						<picture>
							<source
								srcSet={`/img/landing/${p.image}-320.avif`}
								type="image/avif"
							/>
							<img
								src={`/img/landing/${p.image}-320.webp`}
								alt=""
								width={320}
								height={320}
								loading="lazy"
								className="h-[92px] w-full bg-slate-100 object-cover"
							/>
						</picture>
						<div className="px-2 py-1.5">
							<p className="truncate text-[9.5px] font-bold text-slate-900">
								{p.name}
							</p>
							<div className="mt-0.5 flex items-center justify-between">
								<p className="text-[10px] font-extrabold text-emerald-600">
									{p.price}
								</p>
								<span className="flex size-4.5 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold leading-none text-white">
									+
								</span>
							</div>
						</div>
					</div>
				))}
			</div>

			{/* Cart bar */}
			<div className="shrink-0 border-t border-slate-100 bg-white px-4 pb-5 pt-2.5">
				<div className="flex items-center justify-between">
					<div>
						<p className="text-[9px] font-medium text-slate-500">3 items</p>
						<p className="text-[13px] font-extrabold text-slate-900">RM 74.00</p>
					</div>
					<span className="flex h-9 items-center gap-1.5 rounded-full bg-emerald-500 px-3.5 text-[10.5px] font-bold text-white shadow-md shadow-emerald-500/30">
						<WhatsAppIcon className="size-3.5" />
						Checkout
					</span>
				</div>
			</div>
		</div>
	);
}
