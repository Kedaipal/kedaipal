import type { PaymentGroupId, PaymentMethod } from "../../lib/payment-methods";
import {
	compactMethods,
	methodsInGroup,
	PAYMENT_GROUP_ORDER,
} from "../../lib/payment-methods";
import { cn } from "../../lib/utils";
import { m } from "../../paraglide/messages";
import { AppImage } from "../ui/app-image";
import { FadeIn } from "./fade-in";
import { Eyebrow } from "./landing-ui";

/**
 * "Your customers pay the way they already do" — the payment-methods strip
 * (ClickUp 86eye3p6z §G). Sits directly under the money-math block so the
 * 0%-cut argument and the rails land in one eyeline, with a compact repeat in
 * the footer.
 *
 * Every mark rides a white pill in BOTH themes on purpose: official brand
 * marks may not be recoloured, and most carry their own colours, so a white
 * ground is the only treatment that stays legible and compliant when the page
 * flips to dark. Methods we hold no brand-approved SVG for render as neutral
 * wordmark chips — uniform weight beats a ransom-note row of mismatched logos,
 * and a plain-text name can't breach a brand guideline.
 *
 * The catalogue itself lives in `src/lib/payment-methods.ts`.
 */

const GROUP_LABEL: Record<PaymentGroupId, () => string> = {
	bank: m.pay_group_bank,
	cards: m.pay_group_cards,
	wallets: m.pay_group_wallets,
	bnpl: m.pay_group_bnpl,
	crossborder: m.pay_group_crossborder,
};

/** White pill shared by marks and wordmarks so every chip has one silhouette.
 * `shrink-0` because below `lg` each group's chips ride a one-line horizontal
 * scroller (see the row classes) — a shrinking pill squashes its mark. */
const pillClass =
	"inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-border bg-white shadow-sm";

function MethodChip({ method }: { method: PaymentMethod }) {
	if (!method.src) {
		return (
			<span
				className={cn(pillClass, "h-11 px-4 text-sm font-bold text-slate-800")}
			>
				{method.name}
			</span>
		);
	}
	return (
		<span className={cn(pillClass, "h-11 px-4")}>
			<AppImage
				src={method.src}
				alt={method.name}
				aspect={method.markClass ?? "h-5 w-auto"}
				fill={false}
			/>
			{method.noteKey ? (
				<span className="text-[11px] font-semibold text-slate-500">
					{m[method.noteKey]()}
				</span>
			) : null}
		</span>
	);
}

export function PaymentMethods() {
	const groups = PAYMENT_GROUP_ORDER.map((id) => ({
		id,
		methods: methodsInGroup(id),
	})).filter((g) => g.methods.length > 0);

	return (
		<section
			id="payments"
			aria-labelledby="payments-heading"
			className="border-t border-border bg-muted/30"
		>
			<div className="mx-auto max-w-6xl px-5 py-20 md:px-8 md:py-24">
				<FadeIn>
					<div className="mx-auto max-w-2xl text-center">
						<Eyebrow className="justify-center">{m.pay_label()}</Eyebrow>
						<h2
							id="payments-heading"
							className="mt-4 text-3xl font-bold md:text-4xl"
							style={{ letterSpacing: "-0.02em" }}
						>
							{m.pay_heading()}
						</h2>
						<p className="mt-4 text-base leading-relaxed text-muted-foreground">
							{m.pay_sub()}
						</p>
					</div>
				</FadeIn>

				<FadeIn delay={0.1}>
					{/* Label above the row until lg, beside it after — the house rule
					    for inner multi-column layouts, so 375px never cramps. */}
					<div className="mx-auto mt-10 flex max-w-4xl flex-col gap-6 md:mt-12">
						{groups.map((group) => (
							<div
								key={group.id}
								className="flex flex-col gap-3 lg:grid lg:grid-cols-[11rem_minmax(0,1fr)] lg:items-center lg:gap-5"
							>
								<p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground lg:text-right">
									{GROUP_LABEL[group.id]()}
								</p>
								{/* Below lg each group is ONE swipeable line (full-bleed, the
								    category-rail scroller mechanics) instead of wrapping to
								    2–3 rows — the mobile page was far too tall. At lg the
								    label sits beside the row and the chips wrap again. */}
								<div className="-mx-5 flex gap-2.5 overflow-x-auto px-5 [scrollbar-width:none] md:-mx-8 md:px-8 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden">
									{group.methods.map((method) => (
										<MethodChip key={method.id} method={method} />
									))}
								</div>
							</div>
						))}
					</div>
				</FadeIn>

				<FadeIn delay={0.15}>
					{/* The strongest line on the strip: BYO HitPay means the money never
					    touches Kedaipal. Paired immediately with the gateway-fee note so
					    "0% cut" (one section up) can't be read as free processing. */}
					<div className="mx-auto mt-10 max-w-4xl rounded-2xl border-l-4 border-accent/40 bg-accent/5 px-5 py-4">
						<p className="text-base font-bold">{m.pay_strong()}</p>
						<p className="mt-1.5 text-sm text-muted-foreground">
							{m.pay_fee_note()}
						</p>
					</div>

					{/* A <div>, not a <p>: AppImage's loading skeleton is a <div>, which
					    is illegal inside a paragraph and fails hydration.
					    The HitPay asset is a self-contained circular icon mark (it
					    carries its own dark ground), so it gets no white pill — and the
					    brand is spelled out in text beside it, which reads in both
					    themes no matter how the mark resolves. */}
					<div className="mt-8 flex flex-wrap items-center justify-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
						{m.pay_powered()}
						<span className="inline-flex items-center gap-1.5 text-foreground">
							<AppImage
								src="/img/hitpay-logo.svg"
								alt=""
								aspect="size-5"
								fill={false}
								className="shrink-0"
							/>
							HitPay
						</span>
					</div>
				</FadeIn>
			</div>
		</section>
	);
}

/**
 * Compact repeat for the footer — same config array, smaller marks, on the
 * navy footer ground. Wordmark-only methods are skipped here: the footer row is
 * a glance, not the catalogue, and the full strip above carries them.
 */
export function PaymentStripCompact() {
	return (
		<div>
			<div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
				<span className="text-xs font-semibold uppercase tracking-[0.12em] text-primary-foreground/45">
					{m.footer_pay_line()}
				</span>
				{compactMethods().map((method) =>
					method.src ? (
						<span
							key={method.id}
							className="inline-flex h-[30px] items-center rounded-full bg-white/[0.92] px-2.5"
						>
							<AppImage
								src={method.src}
								alt={method.name}
								aspect={method.compactMarkClass ?? "h-3 w-auto"}
								fill={false}
							/>
						</span>
					) : (
						<span
							key={method.id}
							className="inline-flex h-[30px] items-center rounded-full bg-white/[0.92] px-2.5 text-[11px] font-bold text-slate-800"
						>
							{method.name}
						</span>
					),
				)}
			</div>
			{/* Fine print, but it still has to be readable — the footer ground is
			    navy in light and MINT in dark (--primary flips), so /40 washed out
			    entirely on the mint. /55 holds on both. */}
			<p className="mt-3 text-[11px] text-primary-foreground/55">
				{m.pay_fee_note()}
			</p>
		</div>
	);
}
