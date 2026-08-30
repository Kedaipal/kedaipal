import { Inbox, Plus, ShoppingBag, SlidersHorizontal } from "lucide-react";
import { m } from "../../paraglide/messages";
import { AppImage } from "../ui/app-image";
import { QrPattern } from "./landing-ui";

/**
 * Rendered CSS/HTML mockups for the "How it works" timeline rows, matching
 * the Landing Rewrite design reference: floating, slightly-rotated cards
 * with their own shadows (no shared frame). Steps 1 and 3 are WhatsApp
 * surfaces — their trade-dress colours (#ECE5DD wallpaper, #DCF8C6 outgoing
 * bubble) are intentionally literal, same as `hero-phone.tsx`: a WhatsApp
 * chat can't theme-flip. Steps 2 and 4 mock Kedaipal's own UI and use theme
 * tokens (step 4 reuses the real `StatusBadge` palette). Purely decorative —
 * the adjacent label + heading + description carry the accessible content,
 * so every root here is `aria-hidden`.
 */

/** Avatar-initials chip for the demo store (K Frozen Food). */
function StoreInitials({ className }: { className?: string }) {
	return (
		<span aria-hidden className={className}>
			KF
		</span>
	);
}

/** Step 1 — Share: WhatsApp status bubble with a link preview + a "scan to order" QR poster card. */
export function ShareMockup() {
	return (
		<div
			aria-hidden="true"
			className="mx-auto flex w-full max-w-[480px] flex-col items-center gap-5 lg:flex-row lg:items-start lg:gap-3"
		>
			<div className="w-full max-w-[300px] rotate-1 rounded-[20px] bg-[#ECE5DD] p-3.5 shadow-xl">
				<div className="ml-auto max-w-[250px] rounded-xl rounded-tr-sm bg-[#DCF8C6] p-2 shadow-sm">
					<div className="rounded-lg bg-white/70 px-3 py-2.5">
						<div className="flex items-center gap-2">
							<StoreInitials className="flex size-8 shrink-0 items-center justify-center rounded-[10px] border border-emerald-600/25 bg-white font-heading text-[11px] font-extrabold text-emerald-800" />
							<div className="min-w-0">
								<p className="truncate text-xs font-bold text-slate-900">
									{m.how_mockup_1_store()}
								</p>
								<p className="truncate text-[10px] text-slate-500">
									{m.how_mockup_1_tagline()}
								</p>
							</div>
						</div>
						<p className="mt-2 truncate text-[11px] font-semibold text-emerald-700">
							{m.how_mockup_1_url()}
						</p>
					</div>
					<p className="mx-1 mb-0.5 mt-2 text-[12.5px] leading-snug text-slate-800">
						{m.how_mockup_1_caption()}
					</p>
					<p className="mx-1 text-right text-[9px] text-slate-500">
						{m.how_mockup_1_time()} ✓✓
					</p>
				</div>
			</div>

			<div className="w-[140px] shrink-0 -rotate-2 rounded-2xl border-2 border-dashed border-foreground/20 bg-card p-3.5 text-center shadow-lg lg:mt-8">
				<AppImage
					src="/logo-3.svg"
					alt=""
					aspect="mx-auto h-3 w-auto"
					fill={false}
				/>
				<QrPattern className="mx-auto mt-2.5 size-[76px] rounded-lg p-1.5" />
				<p className="mt-3 font-heading text-[11px] font-bold">
					{m.how_mockup_1_qr_label()}
				</p>
				<p className="mt-0.5 truncate text-[8px] text-muted-foreground">
					{m.how_mockup_1_url()}
				</p>
			</div>
		</div>
	);
}

/** Step 2 — Browse: the hosted storefront — product grid tiles + sticky cart bar. */
export function BrowseMockup() {
	return (
		<div
			aria-hidden="true"
			className="mx-auto w-full max-w-[320px] -rotate-1 overflow-hidden rounded-3xl border border-border bg-card shadow-xl"
		>
			<div className="flex flex-col gap-4 bg-gradient-to-b from-accent/10 to-card px-5 pb-4 pt-5">
				<AppImage
					src="/logo-3.svg"
					alt=""
					aspect="h-4 w-auto self-start"
					fill={false}
				/>
				<div className="flex items-center gap-3.5">
					<StoreInitials className="flex size-12 shrink-0 items-center justify-center rounded-2xl border-2 border-accent/20 bg-card font-heading text-base font-extrabold text-accent-emphasis shadow-sm" />
					<div className="min-w-0">
						<p className="truncate font-heading text-lg font-bold leading-tight">
							{m.how_mockup_2_store()}
						</p>
						<p className="truncate text-xs text-muted-foreground">
							{m.how_mockup_2_tagline()}
						</p>
					</div>
				</div>
			</div>

			<div className="grid grid-cols-2 gap-2 px-3 pb-3 pt-1">
				<div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card">
					<div className="flex aspect-square items-center justify-center bg-muted">
						<span className="font-mono text-[9px] text-muted-foreground/70">
							brownie photo
						</span>
					</div>
					<div className="flex flex-1 flex-col gap-1.5 p-2.5">
						<p className="min-h-[30px] text-xs font-medium leading-tight">
							{m.how_mockup_2_product_1_name()}
						</p>
						<p className="text-sm font-bold">
							{m.how_mockup_2_product_1_price()}
						</p>
						<span className="mt-auto flex h-9 items-center justify-center gap-1 rounded-[10px] bg-primary text-xs font-semibold text-primary-foreground">
							<Plus className="size-3.5" />
							{m.how_mockup_2_product_1_cta()}
						</span>
					</div>
				</div>
				<div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card">
					<div className="relative flex aspect-square items-center justify-center bg-muted">
						<span className="font-mono text-[9px] text-muted-foreground/70">
							kek lapis photo
						</span>
						{/* Bottom-left like the real ProductCard's min-quantity chip —
						    top-left is where its stock badges live. */}
						<span className="absolute bottom-1.5 left-1.5 rounded-full bg-card/85 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-muted-foreground">
							{m.how_mockup_2_product_2_badge()}
						</span>
					</div>
					<div className="flex flex-1 flex-col gap-1.5 p-2.5">
						<p className="min-h-[30px] text-xs font-medium leading-tight">
							{m.how_mockup_2_product_2_name()}
						</p>
						<p className="text-sm font-bold">
							<span className="text-[10px] font-medium text-muted-foreground">
								{m.how_mockup_2_product_2_from()}
							</span>{" "}
							{m.how_mockup_2_product_2_price()}
						</p>
						<span className="mt-auto flex h-9 items-center justify-center gap-1 rounded-[10px] border border-border bg-card text-xs font-semibold">
							<SlidersHorizontal className="size-3.5" />
							{m.how_mockup_2_product_2_cta()}
						</span>
					</div>
				</div>
			</div>

			<div className="flex items-center gap-3 border-t border-border bg-card px-4 py-3">
				<span className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
					<ShoppingBag className="size-4" />
					<span className="absolute -right-0.5 -top-0.5 flex size-[17px] items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
						{m.how_mockup_2_cart_count()}
					</span>
				</span>
				<div className="min-w-0 flex-1">
					<p className="text-[9px] uppercase tracking-wider text-muted-foreground">
						{m.how_mockup_2_cart_label()}
					</p>
					<p className="text-[13px] font-semibold">
						{m.how_mockup_2_cart_total()}
					</p>
				</div>
				<span className="flex h-10 shrink-0 items-center rounded-xl bg-primary px-3.5 text-xs font-semibold text-primary-foreground">
					{m.how_mockup_2_cart_cta()}
				</span>
			</div>
		</div>
	);
}

/** Step 3 — Close: WhatsApp order bubble + Kedaipal confirm reply on the chat wallpaper. */
export function CloseMockup() {
	// Current shipped flow (confirmation push, 86eyf1rck): the buyer completes
	// checkout ON the page — name + phone, no account — the order is confirmed
	// at create, and Kedaipal's WABA pushes the confirmation INTO their chat.
	// The old buyer-sent "here's my order" wa.me bubble is the LEGACY fallback
	// and no longer the story this step tells (owner-caught, 29 Aug).
	return (
		<div
			aria-hidden="true"
			className="mx-auto flex w-full max-w-[340px] flex-col gap-3"
		>
			{/* The checkout card — Kedaipal UI, so theme tokens. */}
			<div className="-rotate-1 rounded-2xl border border-border bg-card p-4 shadow-xl">
				<p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
					{m.how_mockup_3_checkout_label()}
				</p>
				<div className="mt-2 flex items-center justify-between text-[12.5px]">
					<span className="text-muted-foreground">
						{m.how_mockup_3_item()}
					</span>
					<span className="font-bold">{m.how_mockup_3_total()}</span>
				</div>
				<div className="mt-2.5 flex flex-col gap-1.5">
					<span className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground/80">
						Aisyah Rahim
					</span>
					<span className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground/80">
						+60 12-338 1122
					</span>
				</div>
				<span className="mt-3 flex h-9 items-center justify-center rounded-full bg-accent text-[12.5px] font-bold text-accent-foreground">
					{m.how_mockup_3_place_order()}
				</span>
			</div>

			{/* …and the confirmation arriving in the buyer's WhatsApp — incoming,
			    from Kedaipal, not something the buyer had to send. */}
			<div className="rotate-1 rounded-[20px] bg-[#ECE5DD] p-3.5 shadow-xl">
				<div className="max-w-[92%] self-start rounded-xl rounded-tl-sm bg-white px-3 py-2 shadow-sm">
					<p className="text-[12.5px] leading-relaxed text-slate-800">
						{m.how_mockup_3_confirm_line1()}
					</p>
					<p className="mt-1.5 text-[12.5px] leading-relaxed text-sky-600">
						{m.how_mockup_3_confirm_line2()}
					</p>
					<p className="mt-1 text-right text-[9px] text-slate-500">10:02 AM</p>
				</div>
			</div>
		</div>
	);
}

/** Step 4 — Run: due-today banner pill + floating order-inbox cards with real status colours. */
export function RunMockup() {
	const orders = [
		{
			name: m.how_mockup_4_order_1_name(),
			amount: m.how_mockup_4_order_1_amount(),
			id: m.how_mockup_4_order_1_id(),
			time: m.how_mockup_4_order_1_time(),
			items: [
				{
					label: m.how_mockup_4_order_1_item_1(),
					price: m.how_mockup_4_order_1_item_1_price(),
				},
				{
					label: m.how_mockup_4_order_1_item_2(),
					price: m.how_mockup_4_order_1_item_2_price(),
				},
			],
			// Class strings mirror the dashboard's StatusBadge palette
			// (`dashboard/status-badge.tsx`) so the mock matches the real inbox.
			badges: [
				{
					label: m.how_mockup_4_order_1_badge_1(),
					className:
						"bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
				},
				{
					label: m.how_mockup_4_order_1_badge_2(),
					className:
						"bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
				},
			],
		},
		{
			name: m.how_mockup_4_order_2_name(),
			amount: m.how_mockup_4_order_2_amount(),
			id: m.how_mockup_4_order_2_id(),
			time: m.how_mockup_4_order_2_time(),
			items: [
				{
					label: m.how_mockup_4_order_2_item_1(),
					price: m.how_mockup_4_order_2_item_1_price(),
				},
			],
			badges: [
				{
					label: m.how_mockup_4_order_2_badge_1(),
					className:
						"bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
				},
			],
		},
	];

	return (
		<div
			aria-hidden="true"
			className="mx-auto flex w-full max-w-[360px] -rotate-1 flex-col gap-2"
		>
			<div className="flex items-center gap-2.5 rounded-2xl bg-primary px-4 py-3 text-primary-foreground shadow-lg">
				<Inbox className="size-4 shrink-0 text-accent" />
				<span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
					{m.how_mockup_4_banner()}
				</span>
				<span className="shrink-0 text-[13px] font-bold text-accent">
					{m.how_mockup_4_banner_cta()}
				</span>
			</div>

			{orders.map((order) => (
				<div
					key={order.id}
					className="rounded-2xl border border-border bg-card p-3.5 shadow-sm"
				>
					<div className="flex items-center justify-between gap-2.5">
						<p className="truncate text-sm font-semibold">{order.name}</p>
						<p className="shrink-0 text-sm font-bold tabular-nums">
							{order.amount}
						</p>
					</div>
					<p className="mt-0.5 truncate text-xs text-muted-foreground">
						<span className="font-mono">{order.id}</span> · {order.time}
					</p>
					<div className="mt-2 flex flex-col gap-1 rounded-xl bg-muted/70 px-2.5 py-2">
						{order.items.map((item) => (
							<div
								key={item.label}
								className="flex justify-between gap-3 text-[12.5px]"
							>
								<span className="min-w-0 truncate font-medium">
									{item.label}
								</span>
								<span className="shrink-0 text-muted-foreground tabular-nums">
									{item.price}
								</span>
							</div>
						))}
					</div>
					<div className="mt-2.5 flex items-center gap-1.5">
						{order.badges.map((badge) => (
							<span
								key={badge.label}
								className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${badge.className}`}
							>
								{badge.label}
							</span>
						))}
						<span className="ml-auto text-sm text-muted-foreground/50">›</span>
					</div>
				</div>
			))}
		</div>
	);
}
