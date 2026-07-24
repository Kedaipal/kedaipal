import { m } from "../../paraglide/messages";

/**
 * CSS-rendered WhatsApp chat inside a simple device frame — the hero's
 * visual proof of the whole loop (ask → storefront CTA → order message →
 * auto-confirmation). Rendered HTML like the how-it-works mockups so it
 * never drifts from real copy and needs no image pipeline.
 *
 * WhatsApp trade-dress colours (#075E54 header, #ECE5DD wallpaper,
 * #DCF8C6 outgoing bubble) are intentionally literal: a WhatsApp chat
 * can't theme-flip, and the hero already used #DCF8C6 for the same reason.
 * The whole frame is one `role="img"` — inner text is decorative.
 */
export function HeroPhone() {
	return (
		<div
			role="img"
			aria-label={m.hero_phone_alt()}
			className="w-[260px] rotate-2 rounded-[2.5rem] bg-slate-900 p-2 shadow-[0_32px_48px_hsl(222_47%_11%_/_0.25)] sm:w-[290px]"
		>
			<div className="flex h-[560px] flex-col overflow-hidden rounded-[2rem] bg-[#ECE5DD] sm:h-[600px]">
				{/* Chat header */}
				<div className="flex items-center gap-2.5 bg-[#075E54] px-3.5 pb-2.5 pt-9 text-white">
					<span aria-hidden className="text-base opacity-90">
						‹
					</span>
					<span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white font-heading text-[10px] font-extrabold text-emerald-800">
						KF
					</span>
					<div className="min-w-0 flex-1">
						<p className="truncate text-sm font-semibold leading-tight">
							{m.hero_chat_store()}
						</p>
						<p className="text-[10px] leading-tight opacity-75">
							{m.hero_chat_online()}
						</p>
					</div>
				</div>

				{/* Thread */}
				<div className="flex flex-1 flex-col gap-2 overflow-hidden p-3">
					<div className="max-w-[85%] self-end rounded-xl rounded-tr-sm bg-[#DCF8C6] px-2.5 py-1.5 shadow-sm">
						<p className="text-xs leading-snug text-slate-800">
							{m.hero_chat_buyer_ask()}
						</p>
						<p className="mt-0.5 text-right text-[8px] text-slate-500">
							9:12 AM ✓✓
						</p>
					</div>

					<div className="max-w-[88%] self-start rounded-xl rounded-tl-sm bg-white px-2.5 py-1.5 shadow-sm">
						<p className="text-xs leading-snug text-slate-800">
							{m.hero_chat_seller_reply()}
						</p>
						<div className="mt-1.5 border-t border-slate-200 pt-1.5 text-center">
							<span className="text-xs font-semibold text-sky-600">
								{m.hero_chat_cta()}
							</span>
						</div>
						<p className="mt-0.5 text-right text-[8px] text-slate-500">
							9:12 AM
						</p>
					</div>

					<div className="max-w-[85%] self-end rounded-xl rounded-tr-sm bg-[#DCF8C6] px-2.5 py-1.5 shadow-sm">
						<p className="text-xs font-bold leading-snug text-slate-800">
							{m.hero_chat_order_title()}
						</p>
						<p className="mt-0.5 text-xs leading-snug text-slate-800">
							{m.hero_chat_order_items()}
							<br />
							{m.hero_chat_order_total()}
						</p>
						<p className="mt-0.5 text-right text-[8px] text-slate-500">
							9:15 AM ✓✓
						</p>
					</div>

					<div className="max-w-[88%] self-start rounded-xl rounded-tl-sm bg-white px-2.5 py-1.5 shadow-sm">
						<p className="text-xs leading-snug text-slate-800">
							{m.hero_chat_confirm()}
						</p>
						<p className="mt-0.5 text-right text-[8px] text-slate-500">
							9:15 AM
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}
