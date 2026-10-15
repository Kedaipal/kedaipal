/**
 * The shared shell pieces every Settings tab is built from.
 *
 * `Card` and `SectionHeading` had drifted into byte-identical copies in
 * `app.settings.tsx` and `fulfilment-tab.tsx`; adding a third copy for the
 * per-kind order-flow cards (z8r3fdh3w1) is how a house ends up looking like
 * three houses, so they live here instead. Reach for these rather than
 * re-deriving the card chrome.
 *
 * The card anatomy (86eye9xd4): a title with an optional live GLANCE chip on
 * the right, ONE sentence saying what the card is for, then the controls.
 * Anything longer than that sentence goes in an `InfoDisclosure` as
 * `HelperBullets` — never a paragraph under the title. Warnings and errors are
 * the exception: they stay visible, in the body, where the seller acts on them.
 */

import { Check, ChevronDown, ChevronRight, Plug } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
	type FixHighlight,
	highlightRingClass,
} from "../../lib/country-setup-copy";
import { cn } from "../../lib/utils";

/**
 * One settings card. `id` is the deep-link anchor and `highlight` the ring a
 * Country-setup "Fix this" jump paints, so a linked card announces itself
 * rather than leaving the seller scanning a long tab (86eyqgujv).
 *
 * `scroll-mt-24` keeps the sticky header off the card once scrolled to.
 */
export function Card({
	children,
	id,
	highlight,
	dashed = false,
}: {
	children: ReactNode;
	id?: string;
	highlight?: FixHighlight;
	/** Saved but not in use right now — the manual methods while HitPay is
	 * the way buyers pay. Same anatomy, a quieter edge. */
	dashed?: boolean;
}) {
	return (
		<section
			id={id}
			data-fix-highlight={highlight ?? undefined}
			className={cn(
				"flex min-w-0 flex-col gap-4 rounded-2xl border bg-background p-5 scroll-mt-24 lg:p-6",
				dashed && "border-dashed",
				highlightRingClass(highlight),
			)}
		>
			{children}
		</section>
	);
}

/**
 * A card's header: title, an optional live `glance` chip on the right, and the
 * one-line purpose. `level="sub"` is a heading INSIDE a card that merges two
 * settings (Brand = logo + cover) — same shape, one step quieter.
 */
export function SectionHeading({
	title,
	description,
	glance,
	level = "card",
}: {
	title: string;
	/** Plain text, or inline markup (a link in the helper line) — it renders
	 * inside the description <p> either way. One sentence: longer helper copy
	 * belongs in an `InfoDisclosure`. */
	description?: ReactNode;
	/** A `<Glance>` stating the card's current value, so the tab reads as the
	 * store's configuration without opening a single form. */
	glance?: ReactNode;
	level?: "card" | "sub";
}) {
	const Title = level === "card" ? "h3" : "h4";
	return (
		<div className="flex flex-col gap-1">
			<div className="flex min-w-0 items-center gap-2">
				<Title
					className={cn(
						"min-w-0 font-semibold text-foreground",
						level === "card" ? "text-sm" : "text-[13px]",
					)}
				>
					{title}
				</Title>
				{glance ? (
					<span className="ml-auto flex shrink-0">{glance}</span>
				) : null}
			</div>
			{description ? (
				<p className="text-xs text-muted-foreground leading-relaxed">
					{description}
				</p>
			) : null}
		</div>
	);
}

/**
 * A card's live value at a glance — "Flat fee · RM 8", "3 points", "Setup 2
 * of 3". `mint` = on / configured, `grey` = a neutral fact, `warn` = needs the
 * seller (always paired with a visible reason in the card body).
 */
export function Glance({
	children,
	tone = "mint",
	className,
}: {
	children: ReactNode;
	tone?: "mint" | "grey" | "warn";
	className?: string;
}) {
	return (
		<span
			className={cn(
				"inline-flex max-w-[16rem] items-center truncate whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold leading-4",
				tone === "mint" && "bg-accent/15 text-accent-emphasis",
				tone === "grey" && "bg-muted text-muted-foreground",
				tone === "warn" &&
					"bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
				className,
			)}
		>
			{children}
		</span>
	);
}

/**
 * The small uppercase label that groups cards on a tab (Identity, Brand…) or
 * rows inside a card (Bank accounts, Setup). Same treatment as the mobile
 * settings index's group labels, so a section reads the same everywhere.
 */
export function SectionLabel({
	children,
	tone = "muted",
	icon,
	className,
}: {
	children: ReactNode;
	/** `accent` marks the Partner-integration half of a built-in/partner pair. */
	tone?: "muted" | "accent";
	icon?: ReactNode;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"flex items-center gap-1.5 pl-1 text-[11px] font-bold uppercase tracking-[0.08em]",
				tone === "muted" ? "text-muted-foreground/80" : "text-accent-emphasis",
				className,
			)}
		>
			{icon}
			{children}
		</span>
	);
}

/**
 * The built-in / partner grammar (z8r3fdcx5k, Arif). Things Kedaipal runs for
 * you are labelled "Kedaipal built-in"; things that run on a third-party
 * account the seller signs up for and pays directly are "Partner
 * integration", in mint with the plug. Used as the section label above each
 * half of a chooser, so the distinction is carried by grouping — one chooser
 * control, never two look-alike selectors stacked.
 */
export function SourceLabel({
	source,
	children,
}: {
	source: "builtin" | "partner";
	/** Overrides the default trailing clause, e.g. "you set the charge". */
	children?: ReactNode;
}) {
	return source === "builtin" ? (
		<SectionLabel>
			Kedaipal built-in{children ? <> &mdash; {children}</> : null}
		</SectionLabel>
	) : (
		<SectionLabel
			tone="accent"
			icon={<Plug className="size-3" strokeWidth={2.5} aria-hidden />}
		>
			Partner integration{children ? <> &mdash; {children}</> : null}
		</SectionLabel>
	);
}

/**
 * "How it works", tucked away. The second half of the card anatomy: one
 * sentence under the title, the rest one tap away. A native `<details>`, so it
 * is keyboard- and screen-reader-correct for free and needs no state.
 */
export function InfoDisclosure({
	summary,
	children,
	defaultOpen = false,
}: {
	summary: string;
	children: ReactNode;
	defaultOpen?: boolean;
}) {
	return (
		<details
			open={defaultOpen}
			className="group rounded-xl border border-border bg-background [&_summary::-webkit-details-marker]:hidden"
		>
			<summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl px-3.5 text-sm font-semibold text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
				{summary}
				<ChevronDown
					aria-hidden
					className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
				/>
			</summary>
			<div className="px-3.5 pb-3.5">{children}</div>
		</details>
	);
}

/**
 * Helper copy as scannable bullets. `check` marks facts that are guarantees
 * ("Buyers see the live price before ordering"); `dot` marks plain facts and
 * limits.
 */
export function HelperBullets({
	items,
	variant = "dot",
	className,
}: {
	items: ReactNode[];
	variant?: "dot" | "check";
	className?: string;
}) {
	return (
		<ul className={cn("flex flex-col gap-1.5", className)}>
			{items.map((item, i) => (
				<li
					// biome-ignore lint/suspicious/noArrayIndexKey: a static copy list — order never changes
					key={i}
					className="relative pl-5 text-sm leading-snug text-muted-foreground"
				>
					{variant === "check" ? (
						<Check
							aria-hidden
							strokeWidth={3}
							className="absolute left-0 top-[3px] size-3.5 text-accent-emphasis"
						/>
					) : (
						<span
							aria-hidden
							className="absolute left-1.5 top-[7px] size-1.5 rounded-full bg-accent-emphasis"
						/>
					)}
					{item}
				</li>
			))}
		</ul>
	);
}

/**
 * One key/value line in a card summary — "Advance notice · 0 days". With
 * `onClick` the whole row is the control (and grows the chevron); without, it
 * is a plain read-out. Rows separate with a hairline, the first one doesn't.
 */
export function SummaryRow({
	label,
	value,
	sublabel,
	onClick,
	expanded,
	ariaLabel,
}: {
	label: ReactNode;
	value?: ReactNode;
	/** A muted second line under the label (e.g. "13 states · RM 8–30"). */
	sublabel?: ReactNode;
	onClick?: () => void;
	/** Set when the row opens its editor IN PLACE (a down chevron that turns)
	 * rather than going somewhere (the right chevron). */
	expanded?: boolean;
	ariaLabel?: string;
}) {
	const body = (
		<>
			<span className="flex min-w-0 flex-col text-left">
				<span className="truncate text-sm text-foreground">{label}</span>
				{sublabel ? (
					<span className="truncate text-xs text-muted-foreground">
						{sublabel}
					</span>
				) : null}
			</span>
			<span className="ml-auto flex shrink-0 items-center gap-1.5 text-right text-sm font-medium text-foreground">
				{value}
				{onClick && expanded !== undefined ? (
					<ChevronDown
						aria-hidden
						className={cn(
							"size-4 text-muted-foreground/60 transition-transform duration-150 motion-reduce:transition-none",
							expanded && "rotate-180",
						)}
					/>
				) : onClick ? (
					<ChevronRight
						aria-hidden
						className="size-4 text-muted-foreground/60"
					/>
				) : null}
			</span>
		</>
	);
	const rowClass =
		"flex min-h-11 w-full items-center gap-3 border-t border-border/60 py-2 first:border-t-0";
	return onClick ? (
		<button
			type="button"
			onClick={onClick}
			aria-label={ariaLabel}
			aria-expanded={expanded}
			className={cn(
				rowClass,
				"-mx-2 w-[calc(100%+1rem)] rounded-lg px-2 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
			)}
		>
			{body}
		</button>
	) : (
		<div className={rowClass}>{body}</div>
	);
}

/**
 * A summary row that opens its editor IN PLACE (86eye9xd4, 9A): the card
 * reads as the store's configuration without opening anything, and one tap
 * edits a value where it's read. `id` is the deep-link anchor — a checklist
 * or What's-new link that targets the row opens it and rings it, so the
 * seller lands on the open editor rather than a collapsed line.
 */
export function ExpandableRow({
	id,
	highlight,
	label,
	value,
	sublabel,
	children,
}: {
	id?: string;
	highlight?: FixHighlight;
	label: ReactNode;
	value?: ReactNode;
	sublabel?: ReactNode;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(highlight !== undefined);
	return (
		<div
			id={id}
			data-fix-highlight={highlight ?? undefined}
			className={cn(
				"flex scroll-mt-24 flex-col border-t border-border/60 first:border-t-0",
				highlight &&
					`-mx-2 rounded-xl border px-2 ${highlightRingClass(highlight)}`,
			)}
		>
			<SummaryRow
				label={label}
				value={value}
				sublabel={sublabel}
				expanded={open}
				onClick={() => setOpen((o) => !o)}
			/>
			{open ? (
				<div className="flex flex-col gap-4 pb-4 pt-1">{children}</div>
			) : null}
		</div>
	);
}

/**
 * A numbered setup checklist that stays readable after onboarding: each step
 * is done (mint tick), needs action (amber number + reason), or not started.
 */
export function SetupChecklist({ children }: { children: ReactNode }) {
	return <ol className="flex flex-col gap-3">{children}</ol>;
}

export function SetupStep({
	n,
	state,
	title,
	detail,
	children,
}: {
	n: number;
	state: "done" | "action" | "todo";
	title: ReactNode;
	detail?: ReactNode;
	/** The step's controls (a "Register automatically" button, a key field). */
	children?: ReactNode;
}) {
	return (
		<li className="flex items-start gap-3">
			<span
				aria-hidden
				className={cn(
					"mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
					state === "done" && "bg-accent text-accent-foreground",
					state === "action" &&
						"bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
					state === "todo" && "bg-muted text-muted-foreground",
				)}
			>
				{state === "done" ? <Check className="size-3.5" strokeWidth={3} /> : n}
			</span>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
					{title}
					<span className="sr-only">
						{state === "done"
							? "(done)"
							: state === "action"
								? "(action needed)"
								: "(not started)"}
					</span>
					{state === "action" ? (
						<Glance tone="warn">Action needed</Glance>
					) : null}
				</span>
				{detail ? (
					<span className="text-xs text-muted-foreground">{detail}</span>
				) : null}
				{children}
			</div>
		</li>
	);
}

/**
 * Two independent card columns from `xl` up (mobile and 13" laptops stay one
 * column). Each column stacks on its own, so one tall card never stretches its
 * neighbour across a grid row (design-system.md, desktop density trap 4).
 */
export function SettingsColumns({
	left,
	right,
}: {
	left: ReactNode;
	right: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-6 pt-2 xl:grid xl:grid-cols-2 xl:items-start">
			<div className="flex min-w-0 flex-col gap-6">{left}</div>
			<div className="flex min-w-0 flex-col gap-6">{right}</div>
		</div>
	);
}

/** A labelled group of cards on a tab: "Identity", then its cards. */
export function SettingsSection({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-2.5">
			<SectionLabel>{label}</SectionLabel>
			<div className="flex min-w-0 flex-col gap-4">{children}</div>
		</div>
	);
}

/** Full-width save button on mobile, right-aligned and comfortable on desktop.
 * Shared so every tab's primary action lands in the same place. */
export const SAVE_BTN_CLASS =
	"h-11 lg:h-10 lg:w-auto lg:self-end lg:min-w-[160px]";
