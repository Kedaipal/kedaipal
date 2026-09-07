import { CalendarCheck, CalendarClock, ExternalLink, FileClock } from "lucide-react";
import type { AnnualOfferState } from "../../lib/annual-billing";
import { buildWaContactLink } from "../../lib/contact";
import { formatPrice, formatShortDate } from "../../lib/format";
import { PLAN_LABEL } from "../../lib/subscription";
import { Button } from "../ui/button";

/** "2 months free" — pluralised from the quote so the claim can never outlive a
 * change to ANNUAL_MONTHS_CHARGED. Never a percentage: a standing % reads as a
 * markdown on a flat price (Arif, 28 Jul + 9 Aug 2026). */
function monthsFreeLabel(months: number): string {
	return `${months} month${months === 1 ? "" : "s"} free`;
}

const SECTION =
	"flex flex-col gap-3 rounded-2xl border border-input bg-background p-5 lg:p-6";

/** A plain note in the same frame as its siblings — no tint, no badge. */
function NoteCard({
	icon,
	title,
	children,
}: {
	icon: React.ReactNode;
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section className="flex items-start gap-3 rounded-2xl border border-input bg-background p-5 lg:p-6">
			{icon}
			<div>
				<p className="text-sm font-medium">{title}</p>
				<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
					{children}
				</p>
			</div>
		</section>
	);
}

/**
 * The annual-billing card in Settings → Billing.
 *
 * Deliberately NOT promotional. Every other card in this tab is a neutral
 * `border-input bg-background` section, and a glowing panel in Settings is what
 * makes a small seller suspicious rather than interested — emerald appears on
 * exactly one word, the saving, which is what it already means in this file.
 *
 * There is no self-serve checkout in v1: every billing action here is a
 * prefilled WhatsApp message, and this is no different. The message is a
 * complete work order — store, plan, exact amount, and in the swap case the
 * invoice number plus the seller's own assertion that it is unpaid — so the
 * invoice can be issued without a follow-up question.
 *
 * Which state a seller is in is decided by `resolveAnnualOffer`; this component
 * only renders them. See src/lib/annual-billing.ts.
 */
export function AnnualBillingCard({
	state,
	slug,
	supportWa,
	founding = false,
}: {
	state: AnnualOfferState;
	slug: string;
	/** Always a string — `useSupportWaNumber` falls back to the built-in default
	 * rather than resolving to undefined, so this CTA is never a dead link. */
	supportWa: string;
	/** Founding members are quoted their discounted rate, and the message says so
	 * — those words are what tell the operator to tick the founding flag. */
	founding?: boolean;
}) {
	if (state.kind === "hidden") return null;

	// They already accepted; an annual invoice is waiting. Selling again here is
	// how a seller ends up asking twice and the issue mutation throws.
	if (state.kind === "pendingAnnual") {
		return (
			<NoteCard
				icon={
					<FileClock className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
				}
				title="Your annual invoice is ready"
			>
				{state.invoiceNumber ? (
					<>
						Invoice{" "}
						<span className="font-mono">{state.invoiceNumber}</span> below covers
						the next 12 months. Your year starts the day we receive it.
					</>
				) : (
					<>
						The invoice below covers the next 12 months. Your year starts the day
						we receive it.
					</>
				)}
			</NoteCard>
		);
	}

	// Already switched. A quiet statement of fact — pitching a seller something
	// they have already bought is how an app stops being believed. Note this
	// deliberately does NOT promise a renewal email: the renewal chase is a log
	// line today (see docs/manual-subscription.md), so a promise here would be
	// one the backend keeps by luck.
	if (state.kind === "onAnnual") {
		return (
			<NoteCard
				icon={
					<CalendarCheck className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
				}
				title="You're on annual billing"
			>
				{PLAN_LABEL[state.plan]}, invoiced once a year — two months of every
				twelve are free.
				{state.renewsAt
					? ` Your current year runs to ${formatShortDate(state.renewsAt)}.`
					: ""}{" "}
				If you change plan part-way through, the months you haven't used are
				credited to the new one.
			</NoteCard>
		);
	}

	const { quote, currency, plan } = state;
	const rate = founding ? " at my Founding Member rate" : "";
	const amount = formatPrice(quote.annualTotal, currency);

	const waMessage =
		state.kind === "switchInstead"
			? `Hi, I have invoice ${state.invoiceNumber ?? "(see my account)"} due for my Kedaipal store (/${slug}) and I haven't paid it yet. I'd like to switch to annual billing instead — ${PLAN_LABEL[plan]}${rate} at ${amount} for 12 months. Please cancel that invoice and send me the annual one.`
			: state.kind === "switchDeferred"
				? `Hi, I'll pay my current invoice for my Kedaipal store (/${slug}) as normal, but I'd like to move to annual billing from the next one — ${PLAN_LABEL[plan]}${rate} at ${amount} for 12 months.`
				: `Hi, I'd like to switch my Kedaipal store (/${slug}) to annual billing — ${PLAN_LABEL[plan]}${rate} at ${amount} for 12 months. Nothing pending on my account right now, so please send me the annual invoice.`;

	const heading =
		state.kind === "switchInstead"
			? "Pay for the year instead?"
			: state.kind === "switchDeferred"
				? "Moving to annual billing"
				: `Pay for the year, get ${monthsFreeLabel(quote.monthsFree)}`;

	const cta =
		state.kind === "switchInstead"
			? "Ask for an annual invoice"
			: state.kind === "switchDeferred"
				? "Ask for annual next cycle"
				: "Switch to annual billing";

	return (
		<section className={SECTION}>
			<div className="flex items-start gap-3">
				<CalendarClock className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
				<div>
					<p className="text-sm font-medium">{heading}</p>
					<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
						{state.kind === "switchInstead" ? (
							<>
								You have an invoice due below.{" "}
								<strong className="font-semibold text-foreground">
									Tell us before you pay it
								</strong>{" "}
								and we'll cancel that one and send an annual invoice instead.
							</>
						) : state.kind === "switchDeferred" ? (
							<>
								Your current invoice is due in{" "}
								{state.daysToDue === 1 ? "a day" : `${state.daysToDue} days`} —
								too soon to swap it safely, so please pay it as normal. Tell us
								now and we'll make the next one an annual invoice.
							</>
						) : (
							<>You're billed {formatPrice(quote.monthly, currency)} a month.</>
						)}
					</p>
				</div>
			</div>

			{/* The money. The big number is what they will actually transfer; the
			    effective monthly is secondary and labelled as never billed, because
			    leading with the flattering figure is how a price becomes a surprise. */}
			<div className="flex flex-col gap-1 rounded-xl bg-muted/40 px-4 py-3">
				<div className="flex flex-wrap items-baseline gap-x-2">
					<span className="text-xl font-bold tabular-nums">{amount}</span>
					<span className="text-xs text-muted-foreground">for 12 months</span>
				</div>
				<p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
					Save {formatPrice(quote.saving, currency)} ·{" "}
					{monthsFreeLabel(quote.monthsFree)}
				</p>
				<p className="text-[11px] text-muted-foreground">
					Works out at {formatPrice(quote.effectiveMonthly, currency)} a month,
					though we only ever invoice the year.
				</p>
			</div>

			{/* Above the CTA, never below it and never as fine print: a seller who
			    has to hunt for "what if I want out" assumes the answer is bad. There
			    is no proration machinery in the codebase, so this promises only what
			    a human can honour by hand at the next issue. */}
			<p className="text-[11px] leading-relaxed text-muted-foreground">
				One invoice, paid the same way as your monthly one. A year already paid
				isn't refunded in cash — if you change plan or stop part-way, the months
				you haven't used are credited to your new plan or your next invoice.
			</p>

			{/* Emphasis ladder: full primary only when nothing competes. Whenever an
			    invoice is open, its own "I've paid — notify us" CTA sits just below
			    this card and must stay the loudest thing on the page — an upsell
			    never outranks a bill. (The five hand-rolled anchors elsewhere in
			    billing-tab predate this primitive; converting them is its own
			    ticket, not silent churn in this diff.) */}
			<Button
				asChild
				variant={state.kind === "offer" ? "default" : "outline"}
				className="tap-target w-full sm:w-auto"
			>
				<a
					href={buildWaContactLink(waMessage, supportWa)}
					target="_blank"
					rel="noopener noreferrer"
				>
					<ExternalLink className="size-4" />
					{cta}
				</a>
			</Button>
			<p className="text-[11px] text-muted-foreground">
				Nothing changes until we confirm on WhatsApp — keep paying as usual
				until then.
			</p>
		</section>
	);
}
