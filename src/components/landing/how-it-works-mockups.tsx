import { Inbox } from "lucide-react";
import { cn } from "../../lib/utils";
import { m } from "../../paraglide/messages";

/**
 * Rendered CSS/HTML mockups for the "How it works" timeline rows. Built from
 * semantic design tokens (no raster screenshots) so they never drift from the
 * real theme and need no image pipeline. Purely decorative — the adjacent
 * label + heading + description already carry the accessible content, so
 * every root here is `aria-hidden`.
 */

/** Step 1 — Share: WhatsApp-status card + a small "scan to order" QR card beside it. */
export function ShareMockup() {
	return (
		<div
			aria-hidden="true"
			className="mx-auto flex w-full max-w-[340px] flex-col items-stretch gap-3 sm:flex-row"
		>
			<div className="min-w-0 flex-1 overflow-hidden rounded-2xl bg-primary text-primary-foreground shadow-lg">
				<div className="flex items-center gap-3 border-b border-white/10 p-4">
					<div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground">
						DN
					</div>
					<div className="min-w-0">
						<p className="truncate text-sm font-semibold">
							{m.how_mockup_1_store()}
						</p>
						<p className="truncate text-xs text-primary-foreground/60">
							{m.how_mockup_1_tagline()}
						</p>
					</div>
				</div>
				<div className="p-4">
					<div className="rounded-xl bg-white/10 p-3">
						<p className="text-sm leading-snug">{m.how_mockup_1_caption()}</p>
					</div>
					<div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-primary-foreground/50">
						<span className="truncate">{m.how_mockup_1_url()}</span>
						<span className="shrink-0">{m.how_mockup_1_time()} ✓✓</span>
					</div>
				</div>
			</div>

			<div className="flex flex-row items-center gap-3 rounded-2xl border-2 border-dashed border-accent/40 bg-card p-3 text-center shadow-sm sm:w-[104px] sm:shrink-0 sm:flex-col sm:justify-center">
				<div className="grid size-14 shrink-0 grid-cols-4 grid-rows-4 gap-0.5 rounded-md bg-foreground p-1.5">
					{Array.from({ length: 16 }).map((_, i) => (
						<span
							// biome-ignore lint/suspicious/noArrayIndexKey: static decorative grid, never reorders
							key={i}
							className={cn(
								"rounded-[1px]",
								i % 3 === 0 || i % 5 === 0 ? "bg-background" : "bg-transparent",
							)}
						/>
					))}
				</div>
				<p className="text-xs font-semibold leading-tight">
					{m.how_mockup_1_qr_label()}
				</p>
			</div>
		</div>
	);
}

/** Step 2 — Browse: storefront product cards + sticky cart bar, framed like an in-WhatsApp browser. */
export function BrowseMockup() {
	return (
		<div
			aria-hidden="true"
			className="mx-auto w-full max-w-[340px] overflow-hidden rounded-2xl border border-border bg-card shadow-lg"
		>
			<div className="flex items-center gap-1.5 border-b border-border bg-muted/60 px-3 py-2">
				<span className="flex gap-1" aria-hidden>
					<span className="size-1.5 rounded-full bg-border" />
					<span className="size-1.5 rounded-full bg-border" />
					<span className="size-1.5 rounded-full bg-border" />
				</span>
				<span className="ml-1 truncate text-[10px] font-bold tracking-wide text-muted-foreground">
					kedaipal
				</span>
			</div>
			<div className="flex items-center gap-3 bg-primary p-4 text-primary-foreground">
				<div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground">
					DN
				</div>
				<p className="min-w-0 truncate text-sm font-semibold">
					{m.how_mockup_2_store()} — {m.how_mockup_2_tagline()}
				</p>
			</div>
			<div className="space-y-2 p-3">
				<div className="flex items-center gap-3 rounded-xl border border-border p-2.5">
					<div className="size-11 shrink-0 rounded-lg bg-accent/15" />
					<div className="min-w-0 flex-1">
						<p className="truncate text-xs font-semibold">
							{m.how_mockup_2_product_1_name()}
						</p>
						<p className="text-xs text-muted-foreground">
							{m.how_mockup_2_product_1_price()}
						</p>
					</div>
					<span className="shrink-0 rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-bold text-accent">
						{m.how_mockup_2_product_1_cta()}
					</span>
				</div>
				<div className="flex items-center gap-3 rounded-xl border border-border p-2.5">
					<div className="relative size-11 shrink-0 rounded-lg bg-accent/15">
						<span className="absolute -left-1.5 -top-1.5 rounded-full bg-destructive px-1.5 py-0.5 text-[9px] font-bold text-destructive-foreground">
							{m.how_mockup_2_product_2_badge()}
						</span>
					</div>
					<div className="min-w-0 flex-1">
						<p className="truncate text-xs font-semibold">
							{m.how_mockup_2_product_2_name()}
						</p>
						<p className="text-xs text-muted-foreground">
							{m.how_mockup_2_product_2_from()}{" "}
							{m.how_mockup_2_product_2_price()}
						</p>
					</div>
					<span className="shrink-0 rounded-full border border-accent/30 px-2.5 py-1 text-[11px] font-bold text-accent">
						{m.how_mockup_2_product_2_cta()}
					</span>
				</div>
			</div>
			<div className="flex items-center justify-between gap-2 border-t border-border bg-accent px-4 py-3 text-accent-foreground">
				<span className="text-xs font-bold">
					{m.how_mockup_2_cart_count()} · {m.how_mockup_2_cart_label()} ·{" "}
					{m.how_mockup_2_cart_total()}
				</span>
				<span className="text-xs font-bold underline underline-offset-2">
					{m.how_mockup_2_cart_cta()}
				</span>
			</div>
		</div>
	);
}

/** Step 3 — Close: WhatsApp order bubble + Kedaipal confirm reply. */
export function CloseMockup() {
	return (
		<div aria-hidden="true" className="mx-auto w-full max-w-[320px] space-y-2">
			<div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-accent/15 p-3">
				<p className="text-xs leading-relaxed">{m.how_mockup_3_greeting()}</p>
				<p className="mt-1.5 text-xs font-bold">{m.how_mockup_3_order_id()}</p>
				<p className="mt-0.5 text-xs text-muted-foreground">
					{m.how_mockup_3_item()}
				</p>
				<p className="text-xs text-muted-foreground">
					{m.how_mockup_3_total()}
				</p>
				<p className="text-xs text-muted-foreground">
					{m.how_mockup_3_payment()}
				</p>
			</div>
			<div className="mr-auto max-w-[85%] rounded-2xl rounded-tl-sm border border-border bg-card p-3 shadow-sm">
				<p className="text-xs leading-relaxed">
					{m.how_mockup_3_confirm_line1()}
				</p>
				<p className="mt-1.5 text-xs leading-relaxed text-accent underline underline-offset-2">
					{m.how_mockup_3_confirm_line2()}
				</p>
			</div>
		</div>
	);
}

/** Step 4 — Run: order-inbox rows with a due-today banner + status badges. */
export function RunMockup() {
	const orders = [
		{
			name: m.how_mockup_4_order_1_name(),
			amount: m.how_mockup_4_order_1_amount(),
			id: m.how_mockup_4_order_1_id(),
			time: m.how_mockup_4_order_1_time(),
			items: m.how_mockup_4_order_1_items(),
			badges: [
				m.how_mockup_4_order_1_badge_1(),
				m.how_mockup_4_order_1_badge_2(),
			],
		},
		{
			name: m.how_mockup_4_order_2_name(),
			amount: m.how_mockup_4_order_2_amount(),
			id: m.how_mockup_4_order_2_id(),
			time: m.how_mockup_4_order_2_time(),
			items: m.how_mockup_4_order_2_items(),
			badges: [m.how_mockup_4_order_2_badge_1()],
		},
	];

	return (
		<div
			aria-hidden="true"
			className="mx-auto w-full max-w-[340px] overflow-hidden rounded-2xl border border-border bg-card shadow-lg"
		>
			<div className="flex items-center justify-between gap-2 bg-accent/10 px-4 py-2.5 text-xs font-bold text-accent">
				<span className="flex items-center gap-2">
					<Inbox className="size-3.5" />
					{m.how_mockup_4_banner()}
				</span>
				<span>{m.how_mockup_4_banner_cta()}</span>
			</div>
			<div className="divide-y divide-border">
				{orders.map((order) => (
					<div key={order.id} className="p-3">
						<div className="flex items-center justify-between gap-2">
							<p className="truncate text-xs font-semibold">{order.name}</p>
							<p className="shrink-0 text-xs font-bold">{order.amount}</p>
						</div>
						<p className="mt-0.5 truncate text-[11px] text-muted-foreground">
							{order.id} · {order.time}
						</p>
						<p className="mt-1 truncate text-[11px] text-muted-foreground">
							{order.items}
						</p>
						<div className="mt-2 flex flex-wrap gap-1.5">
							{order.badges.map((badge) => (
								<span
									key={badge}
									className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent"
								>
									{badge}
								</span>
							))}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
