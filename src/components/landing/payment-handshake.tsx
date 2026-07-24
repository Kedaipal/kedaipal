import { Check } from "lucide-react";
import { m } from "../../paraglide/messages";
import { FadeIn } from "./fade-in";
import { Eyebrow } from "./landing-ui";

/**
 * "The payment handshake" — the landing section for universal pain #2
 * (chasing "dah transfer" screenshots). Left: claim + proof bullets.
 * Right: a rendered CSS mock of the real flow — buyer's WhatsApp bubble,
 * the seller's payment-claim card, and the auto-receipt confirmation.
 * Mock is decorative (`aria-hidden`); the copy carries the content.
 */
export function PaymentHandshake() {
	const points = [
		m.handshake_point_1(),
		m.handshake_point_2(),
		m.handshake_point_3(),
	];

	return (
		<section aria-labelledby="handshake-heading" className="bg-background">
			<div className="mx-auto max-w-6xl px-5 py-20 md:px-8 md:py-32">
				<div className="grid items-center gap-12 md:grid-cols-2 md:gap-16 lg:gap-20">
					<FadeIn>
						<Eyebrow>{m.handshake_label()}</Eyebrow>
						<h2
							id="handshake-heading"
							className="mt-4 text-3xl font-bold leading-[1.08] md:text-5xl"
							style={{ letterSpacing: "-0.02em" }}
						>
							{m.handshake_heading()}
						</h2>
						<p className="mt-4 text-base leading-relaxed text-muted-foreground md:text-lg">
							{m.handshake_body_1()}{" "}
							<strong className="font-semibold text-foreground">
								{m.handshake_body_strong()}
							</strong>{" "}
							{m.handshake_body_2()}
						</p>
						<ul className="mt-7 space-y-3.5">
							{points.map((point) => (
								<li
									key={point}
									className="flex gap-3 text-[15px] leading-relaxed text-foreground/80"
								>
									<Check className="mt-0.5 size-4 shrink-0 text-accent" />
									{point}
								</li>
							))}
						</ul>
						<p className="mt-6 text-[13px] text-muted-foreground">
							{m.handshake_note()}
						</p>
					</FadeIn>

					<FadeIn delay={0.15}>
						<div
							aria-hidden="true"
							className="mx-auto flex w-full max-w-sm flex-col gap-3"
						>
							{/* Buyer's WhatsApp bubble */}
							<div className="max-w-[280px] rotate-1 self-end rounded-2xl rounded-tr-sm bg-[#DCF8C6] px-4 py-3 shadow-md">
								<p className="text-sm font-medium text-slate-800">
									{m.handshake_chat_paid()}
								</p>
								<p className="mt-1 text-right text-[10px] text-slate-500">
									8:41 PM ✓✓
								</p>
							</div>

							{/* Seller's payment-claim card */}
							<div className="-rotate-1 rounded-2xl border border-border bg-card p-5 shadow-xl">
								<div className="flex items-center justify-between gap-2">
									<p className="text-[13px] font-bold">ORD-0042 · RM 76.00</p>
									<span className="whitespace-nowrap rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
										{m.handshake_card_badge()}
									</span>
								</div>
								<p className="mt-2.5 text-[13px] text-muted-foreground">
									{m.handshake_card_method()}
								</p>
								<div className="mt-3.5 flex gap-2">
									<span className="flex h-10 flex-1 items-center justify-center rounded-full bg-accent text-[13px] font-bold text-accent-foreground">
										{m.handshake_card_confirm()}
									</span>
									<span className="flex h-10 items-center justify-center rounded-full border border-border px-4 text-[13px] font-semibold text-muted-foreground">
										{m.handshake_card_decline()}
									</span>
								</div>
							</div>

							{/* Auto-receipt confirmation */}
							<div className="max-w-[300px] rotate-[0.5deg] rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-3 shadow-md">
								<p className="text-[13px] font-semibold">
									{m.handshake_chat_received()}
								</p>
								<p className="mt-1 text-xs text-muted-foreground">
									{m.handshake_chat_receipt()}
								</p>
							</div>
						</div>
					</FadeIn>
				</div>
			</div>
		</section>
	);
}
