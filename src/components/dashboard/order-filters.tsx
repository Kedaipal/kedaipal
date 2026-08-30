import { CalendarDays, Palette, SlidersHorizontal, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useState } from "react";
import { sourceLabel } from "../../../convex/lib/attribution";
import type { Country } from "../../../convex/lib/country";
import type { FulfilmentWindow } from "../../../convex/lib/fulfilmentDate";
import {
	ORDER_SOURCE_KEYS,
	ORDER_SOURCE_LABELS,
	PAYMENT_STATUS_KEYS,
	PAYMENT_STATUS_LABELS,
} from "../../../convex/lib/orderCsv";
import {
	COUNTRY_PAYMENT_METHODS,
	ORDER_PAYMENT_METHODS,
	type OrderPaymentMethod,
	PAYMENT_METHOD_LABELS,
} from "../../../convex/lib/paymentMethod";
import { ORDER_STATUS_KEYS } from "../../lib/orderStatus";
import { cn } from "../../lib/utils";
import { BulkSelectRow } from "../ui/bulk-select-row";
import { Button } from "../ui/button";
import { FilterChip } from "../ui/filter-chip";
import { FilterOptionRow } from "../ui/filter-option-row";
import type { OrderFilterFacets } from "./order-column-filters";

export type PaymentStatus = "unpaid" | "claimed" | "received";

/** Checkout surface the order came through (mirrors orders.source). */
export type OrderSource = "storefront" | "counter" | "claim";

// Both derived from the registry's maps rather than restated here: the Order
// type column printed `storefront` while this panel said "Online" precisely
// because the label lived in one place and the column in another (86eyrtz74).
// Claim-link orders (86eyq0epn) are seller-keyed at a locked price and
// completed by the buyer — the TikTok Live funnel.
const SOURCE_OPTIONS: { value: OrderSource; label: string }[] =
	ORDER_SOURCE_KEYS.map((value) => ({
		value: value as OrderSource,
		label: ORDER_SOURCE_LABELS[value],
	}));

const PAYMENT_OPTIONS: { value: PaymentStatus; label: string }[] =
	PAYMENT_STATUS_KEYS.map((value) => ({
		value: value as PaymentStatus,
		label: PAYMENT_STATUS_LABELS[value],
	}));

const DUE_WINDOWS: { value: FulfilmentWindow; label: string }[] = [
	{ value: "today", label: "Today" },
	{ value: "tomorrow", label: "Tomorrow" },
	{ value: "this_week", label: "This week" },
];

export interface OrderFilterValue {
	payment: PaymentStatus[];
	/** Concrete settlement methods (see lib/paymentMethod.ts). */
	method: OrderPaymentMethod[];
	/** Match orders with NO recorded method (online / WA self-claim / legacy). */
	methodUnspecified: boolean;
	/** Epoch ms, start-of-day. */
	from?: number;
	/** Epoch ms, end-of-day. */
	to?: number;
	/** Cross-cutting "only orders awaiting a mockup" toggle. */
	mockup: boolean;
	/** Fulfilment-date urgency window (Today / Tomorrow / This week). */
	fwin?: FulfilmentWindow;
	/**
	 * Checkout surfaces to keep (online / counter / claim link). MULTI since
	 * 86eyrtz74, matching every other enumerable filter — "everything that isn't
	 * a walk-in" is a real question and one value could not ask it. Empty = all
	 * surfaces.
	 */
	sources: OrderSource[];
	/**
	 * Exact order statuses to keep (86eyrtz74). Mirrors the Status column's own
	 * header filter — both write this, so a filter set in the table is visible
	 * and clearable here, and a cards-view seller (who has no table headers) can
	 * still set it.
	 */
	statuses: string[];
	/** Frozen line categories to keep (86eyrtz74). Same mirroring rule. */
	categories: string[];
	/** Keep orders with NO categories — the twin of `methodUnspecified`. Without
	 * it "select every category" silently drops them, and categories are
	 * optional so that is the common case (PR #235 review). */
	categoriesUnspecified: boolean;
	/**
	 * Marketing origins to keep (86eyq0eq9) — `attributionBucket` keys, e.g.
	 * "tiktok" / "direct" / "counter". Multi-select: several channels OR
	 * together, because "how did my socials do" spans more than one. Empty =
	 * no attribution filtering. Distinct from `source`, which is the checkout
	 * SURFACE rather than where the buyer came from.
	 */
	attributionSources: string[];
}

export function activeFilterCount(v: OrderFilterValue): number {
	// A date range is one filter (not two), even with both bounds set; each
	// payment + method selection (incl. "unspecified"), the due window, the
	// order-type choice, and the mockup toggle each increment.
	return (
		v.payment.length +
		v.method.length +
		(v.methodUnspecified ? 1 : 0) +
		(v.from != null || v.to != null ? 1 : 0) +
		(v.mockup ? 1 : 0) +
		(v.fwin != null ? 1 : 0) +
		v.sources.length +
		v.statuses.length +
		v.categories.length +
		(v.categoriesUnspecified ? 1 : 0) +
		v.attributionSources.length
	);
}

type DatePreset = { label: string; kind: "7d" | "30d" | "month" };
const DATE_PRESETS: DatePreset[] = [
	{ label: "7 days", kind: "7d" },
	{ label: "30 days", kind: "30d" },
	{ label: "This month", kind: "month" },
];

function presetRange(kind: DatePreset["kind"]): { from: number; to: number } {
	const n = new Date();
	const y = n.getFullYear();
	const mo = n.getMonth();
	const d = n.getDate();
	const endToday = new Date(y, mo, d, 23, 59, 59, 999).getTime();
	switch (kind) {
		case "7d":
			return {
				from: new Date(y, mo, d - 6, 0, 0, 0, 0).getTime(),
				to: endToday,
			};
		case "30d":
			return {
				from: new Date(y, mo, d - 29, 0, 0, 0, 0).getTime(),
				to: endToday,
			};
		default:
			return {
				from: new Date(y, mo, 1, 0, 0, 0, 0).getTime(),
				to: new Date(y, mo + 1, 0, 23, 59, 59, 999).getTime(),
			};
	}
}

const pad = (n: number) => String(n).padStart(2, "0");
function toInputDate(ms?: number): string {
	if (ms == null) return "";
	const d = new Date(ms);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function startOfDay(value: string): number | undefined {
	if (!value) return undefined;
	const [y, m, d] = value.split("-").map(Number);
	return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}
function endOfDay(value: string): number | undefined {
	if (!value) return undefined;
	const [y, m, d] = value.split("-").map(Number);
	return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}

function formatShortDate(ms?: number): string | null {
	if (ms == null) return null;
	return new Intl.DateTimeFormat("en-MY", {
		day: "numeric",
		month: "short",
	}).format(new Date(ms));
}

/** One applied-filter token: its label + how to clear just that filter. */
type FilterToken = {
	key: string;
	label: string;
	clear: (v: OrderFilterValue) => OrderFilterValue;
};

function activeFilterTokens(
	v: OrderFilterValue,
	mockupCount?: number,
	/** Resolves a raw status to the retailer's own stage wording, so a token
	 * reads the same as the Status column it came from. */
	statusLabel?: (status: string) => string,
): FilterToken[] {
	const tokens: FilterToken[] = [];
	for (const st of v.statuses) {
		tokens.push({
			key: `status-${st}`,
			label: statusLabel?.(st) ?? st,
			clear: (x) => ({ ...x, statuses: x.statuses.filter((y) => y !== st) }),
		});
	}
	for (const c of v.categories) {
		tokens.push({
			key: `cat-${c}`,
			label: c,
			clear: (x) => ({ ...x, categories: x.categories.filter((y) => y !== c) }),
		});
	}
	if (v.categoriesUnspecified) {
		tokens.push({
			key: "cat-none",
			label: "Uncategorized",
			clear: (x) => ({ ...x, categoriesUnspecified: false }),
		});
	}
	for (const src of v.sources) {
		tokens.push({
			key: `source-${src}`,
			label: SOURCE_OPTIONS.find((o) => o.value === src)?.label ?? src,
			clear: (x) => ({ ...x, sources: x.sources.filter((y) => y !== src) }),
		});
	}
	for (const a of v.attributionSources) {
		tokens.push({
			key: `asrc-${a}`,
			label: sourceLabel(a),
			clear: (x) => ({
				...x,
				attributionSources: x.attributionSources.filter((y) => y !== a),
			}),
		});
	}
	if (v.fwin) {
		const label = DUE_WINDOWS.find((w) => w.value === v.fwin)?.label ?? v.fwin;
		tokens.push({
			key: `fwin-${v.fwin}`,
			label: `Due ${label.toLowerCase()}`,
			clear: (x) => ({ ...x, fwin: undefined }),
		});
	}
	if (v.mockup) {
		tokens.push({
			key: "mockup",
			label: `Needs mockup${mockupCount ? ` (${mockupCount})` : ""}`,
			clear: (x) => ({ ...x, mockup: false }),
		});
	}
	for (const p of v.payment) {
		tokens.push({
			key: `pay-${p}`,
			label: PAYMENT_OPTIONS.find((opt) => opt.value === p)?.label ?? p,
			clear: (x) => ({ ...x, payment: x.payment.filter((y) => y !== p) }),
		});
	}
	for (const m of v.method) {
		tokens.push({
			key: `method-${m}`,
			label: PAYMENT_METHOD_LABELS[m],
			clear: (x) => ({ ...x, method: x.method.filter((y) => y !== m) }),
		});
	}
	if (v.methodUnspecified) {
		tokens.push({
			key: "munspec",
			label: "Unspecified method",
			clear: (x) => ({ ...x, methodUnspecified: false }),
		});
	}
	if (v.from != null || v.to != null) {
		const from = formatShortDate(v.from);
		const to = formatShortDate(v.to);
		tokens.push({
			key: "dates",
			label: `${from ?? "Any"} – ${to ?? "Any"}`,
			clear: (x) => ({ ...x, from: undefined, to: undefined }),
		});
	}
	return tokens;
}

export function clearedFilters(): OrderFilterValue {
	return {
		payment: [],
		method: [],
		methodUnspecified: false,
		from: undefined,
		to: undefined,
		mockup: false,
		fwin: undefined,
		sources: [],
		statuses: [],
		categories: [],
		categoriesUnspecified: false,
		attributionSources: [],
	};
}

/**
 * Which method chips this store's seller is offered, in display order. The
 * store's country list, plus anything ALREADY selected that it doesn't contain
 * — a gateway-stamped rail (HitPay MY can settle a GrabPay order) or a
 * deep-linked `?method=` can hold a value the picker never offers, and a
 * selected chip the seller can't see is a filter they can't switch off.
 */
export function methodChoicesFor(
	country: Country,
	selected: readonly OrderPaymentMethod[],
	/**
	 * Rails that actually appear in the seller's orders (from
	 * `searchOrders.facets.paymentMethod`). Folded in alongside the selected
	 * ones because `paymentMethod.ts` says it plainly: never gate a label, a
	 * filter MATCH or a stamp on the country list — only the pickers.
	 *
	 * Without this, an MY seller whose HitPay settled a GrabPay order could not
	 * see a GrabPay option at all, and "select all" quietly excluded those
	 * orders while the panel claimed nothing was filtered (PR #235 review).
	 */
	present: readonly OrderPaymentMethod[] = [],
): OrderPaymentMethod[] {
	const offered = COUNTRY_PAYMENT_METHODS[country];
	const extra: OrderPaymentMethod[] = [];
	for (const m of [...selected, ...present]) {
		if (!offered.includes(m) && !extra.includes(m)) extra.push(m);
	}
	return [...offered, ...extra];
}

/** The rails a facet tally actually saw, in registry order so the picker stays
 * stable as counts move. `""` (unspecified) is not a rail. */
export function methodsPresentIn(
	facets: OrderFilterFacets | undefined,
): OrderPaymentMethod[] {
	if (!facets) return [];
	return ORDER_PAYMENT_METHODS.filter(
		(m) => (facets.paymentMethod[m] ?? 0) > 0,
	);
}

/**
 * The one filter sheet for the order inbox — owns every secondary axis (due
 * window, payment status, method, order date, mockup toggle) so the page keeps
 * a single control row (search + this trigger). Filters apply live to the URL;
 * the apply button shows the live result count before the seller commits back
 * to the list. State is owned by the route (URL search params).
 */
export function OrderFilters({
	value,
	onChange,
	country,
	availableSources,
	availableCategories,
	statusLabel,
	facets,
	mockupCount,
	resultCount,
}: {
	value: OrderFilterValue;
	onChange: (next: OrderFilterValue) => void;
	/** The store's country — decides which settlement rails are offered
	 * (SG has no DuitNow/TnG/FPX; MY has no PayNow). See lib/paymentMethod.ts. */
	country: Country;
	/**
	 * Marketing origins present in this seller's order window, most-used first
	 * (from `searchOrders`). Free-form tags mean the list can't be hardcoded —
	 * and offering an origin that would match nothing is worse than offering
	 * none, so the section hides itself when this has fewer than two entries
	 * (one origin = every order, nothing to narrow).
	 */
	availableSources?: string[];
	/** Category names present in the seller's window, most-used first — the same
	 * list the Categories header filter offers (86eyrtz74). */
	availableCategories?: string[];
	/** Per-option row counts from `searchOrders`, tallied over the UNFILTERED
	 * window. Optional so the dialog still renders while the query is in
	 * flight — a missing facet shows 0 rather than blocking the panel. */
	facets?: OrderFilterFacets;
	/** The retailer's own wording for each raw status, so this panel and the
	 * Status column never call the same state two different things. */
	statusLabel?: (status: string) => string;
	/** Orders awaiting a mockup — drives the toggle's count badge. The toggle is
	 * hidden when there are none (and it isn't already on). */
	mockupCount?: number;
	/** Live match count for the current filters — shown on the apply button. */
	resultCount?: number;
}) {
	const [open, setOpen] = useState(false);
	// Custom date inputs stay collapsed behind the calendar icon unless a custom
	// range is already applied — presets cover the common cases.
	const [customDates, setCustomDates] = useState(false);
	const count = activeFilterCount(value);
	const showMockup = (mockupCount ?? 0) > 0 || value.mockup;
	const tokens = activeFilterTokens(value, mockupCount, statusLabel);
	const clearFilters = () => onChange(clearedFilters());

	function togglePayment(p: PaymentStatus) {
		onChange({
			...value,
			payment: value.payment.includes(p)
				? value.payment.filter((x) => x !== p)
				: [...value.payment, p],
		});
	}

	function toggleMethod(m: OrderPaymentMethod) {
		onChange({
			...value,
			method: value.method.includes(m)
				? value.method.filter((x) => x !== m)
				: [...value.method, m],
		});
	}

	function toggleAttributionSource(src: string) {
		onChange({
			...value,
			attributionSources: value.attributionSources.includes(src)
				? value.attributionSources.filter((x) => x !== src)
				: [...value.attributionSources, src],
		});
	}

	// ONE list drives the options, the total AND the select-all set. They were
	// three separate expressions, and only the rendered options folded in a rail
	// the country doesn't offer — so select-all excluded orders whose method the
	// picker was happily showing (PR #235 review).
	const methodChoices = methodChoicesFor(
		country,
		value.method,
		methodsPresentIn(facets),
	);

	const showCustomDates =
		customDates ||
		((value.from != null || value.to != null) && !isPresetRange(value));

	return (
		<>
			{/* Trigger — joins the search row as a 44px icon button; navy with a
			    mint count dot while any filter is active. */}
			<button
				type="button"
				onClick={() => setOpen(true)}
				aria-label={count > 0 ? `Filters (${count} active)` : "Filters"}
				className={cn(
					"relative flex size-11 shrink-0 items-center justify-center rounded-xl border transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
					count > 0
						? "border-primary bg-primary text-primary-foreground"
						: "border-border bg-card text-muted-foreground hover:border-accent/40 hover:text-foreground",
				)}
			>
				<SlidersHorizontal className="size-5" aria-hidden="true" />
				{count > 0 ? (
					<span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-background bg-accent px-0.5 text-[10px] font-bold leading-none text-accent-foreground">
						{count}
					</span>
				) : null}
			</button>

			{/* Applied-filter tokens — each removable in place, so undoing one
			    filter never requires reopening the sheet. Rendered by the parent
			    below the chip row via this portal-free block. */}
			{tokens.length > 0 ? (
				<div className="order-last flex w-full flex-wrap items-center gap-1.5">
					{tokens.map((t) => (
						<button
							key={t.key}
							type="button"
							onClick={() => onChange(t.clear(value))}
							aria-label={`Remove filter: ${t.label}`}
							className="inline-flex h-8 items-center gap-1 rounded-full bg-accent/15 py-0 pl-3 pr-1.5 text-xs font-semibold text-accent-emphasis transition-colors hover:bg-accent/25"
						>
							{t.label}
							<X className="size-3.5" aria-hidden="true" />
						</button>
					))}
					<button
						type="button"
						onClick={clearFilters}
						className="inline-flex h-8 items-center rounded-full px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
					>
						Clear all
					</button>
				</div>
			) : null}

			<Dialog.Root open={open} onOpenChange={setOpen}>
				<Dialog.Portal>
					<Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in" />
					<Dialog.Content
						// The panel no longer scrolls as one block: the OPTIONS scroll
						// and the apply bar stays put, so "Show N orders" — the whole
						// point of the panel — is never below the fold on a phone.
						// Wider at `sm` because the body is two columns now.
						className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col overflow-hidden rounded-t-3xl border-t border-border bg-background data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-1/2 sm:max-h-[88dvh] sm:w-[min(94vw,720px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:shadow-xl"
						aria-describedby={undefined}
					>
						<div
							className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border sm:hidden"
							aria-hidden="true"
						/>
						<div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-4">
							<div className="min-w-0">
								<Dialog.Title className="font-heading text-lg font-bold">
									Filters
								</Dialog.Title>
								{/* States what is on WITHOUT making the seller read the
								    chips back. "Reset" alone never said how much it undid. */}
								<p className="text-[12.5px] text-muted-foreground">
									{count > 0
										? `${count} active`
										: "Nothing selected — showing every order"}
								</p>
							</div>
							<Dialog.Close asChild>
								<button
									type="button"
									className="-mr-1 flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
									aria-label="Close"
								>
									<X className="size-5" />
								</button>
							</Dialog.Close>
						</div>

						{/* Active selections, above the fold and removable in place —
						    so a seller who opened the panel to undo ONE thing never has
						    to hunt nine sections for the lit option. */}
						{tokens.length > 0 ? (
							<div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-5 pb-3">
								{tokens.map((t) => (
									<button
										key={t.key}
										type="button"
										onClick={() => onChange(t.clear(value))}
										aria-label={`Remove filter: ${t.label}`}
										className="inline-flex h-7 items-center gap-1 rounded-full bg-accent/15 py-0 pl-2.5 pr-1.5 text-[12px] font-semibold text-accent-emphasis transition-colors hover:bg-accent/25 dark:text-accent"
									>
										{t.label}
										<X className="size-3" aria-hidden="true" />
									</button>
								))}
							</div>
						) : null}

						<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
							{/* ── The sheet ──────────────────────────────────────────
						    Two columns of checkbox rows, each option carrying its
						    row count. Deliberately the SAME control the column
						    header menus use (`FilterOptionRow`): the dialog used to
						    speak in chips and the headers in rows, which made one
						    idea look like two and taught the seller the same filter
						    twice.

						    Order is by how often a seller reaches for it, not by
						    what happened to be here already: Status, then what's in
						    the order, then how it was paid. The left column is the
						    two dimensions with the most options, so the columns end
						    up roughly level.                                      */}
							<div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
								<div className="flex flex-col gap-4">
									<FilterSection
										title="Status"
										selected={value.statuses.length}
										total={ORDER_STATUS_KEYS.length}
										onToggleAll={(all) =>
											onChange({
												...value,
												statuses: all ? [...ORDER_STATUS_KEYS] : [],
											})
										}
									>
										{ORDER_STATUS_KEYS.map((st) => (
											<FilterOptionRow
												key={st}
												label={statusLabel?.(st) ?? st}
												count={facets?.status[st] ?? 0}
												selected={value.statuses.includes(st)}
												onToggle={() =>
													onChange({
														...value,
														statuses: value.statuses.includes(st)
															? value.statuses.filter((x) => x !== st)
															: [...value.statuses, st],
													})
												}
											/>
										))}
									</FilterSection>

									<FilterSection
										title="Payment"
										selected={value.payment.length}
										total={PAYMENT_OPTIONS.length}
										onToggleAll={(all) =>
											onChange({
												...value,
												payment: all ? PAYMENT_OPTIONS.map((o) => o.value) : [],
											})
										}
									>
										{PAYMENT_OPTIONS.map((o) => (
											<FilterOptionRow
												key={o.value}
												label={o.label}
												count={facets?.paymentStatus[o.value] ?? 0}
												selected={value.payment.includes(o.value)}
												onToggle={() => togglePayment(o.value)}
											/>
										))}
									</FilterSection>

									{/* `methodChoicesFor`, not the raw country list: a rail the
									    country doesn't offer but the seller HAS selected
									    (HitPay MY can settle a GrabPay order; a deep link can
									    carry any value) still renders, or it is a filter they
									    can neither see nor switch off. */}
									<FilterSection
										title="Payment method"
										hint="how they settled"
										// "Unspecified" counts as one of the choices: it is a real answer a
										// seller can filter on, so a section reading "all selected" while it
										// was off would be wrong.
										selected={
											value.method.length + (value.methodUnspecified ? 1 : 0)
										}
										total={methodChoices.length + 1}
										onToggleAll={(all) =>
											onChange({
												...value,
												method: all ? methodChoices : [],
												methodUnspecified: all,
											})
										}
									>
										{methodChoices.map((m) => (
											<FilterOptionRow
												key={m}
												label={PAYMENT_METHOD_LABELS[m]}
												count={facets?.paymentMethod[m] ?? 0}
												selected={value.method.includes(m)}
												onToggle={() => toggleMethod(m)}
											/>
										))}
										<FilterOptionRow
											label="Unspecified"
											muted
											count={facets?.paymentMethod[""] ?? 0}
											selected={value.methodUnspecified}
											onToggle={() =>
												onChange({
													...value,
													methodUnspecified: !value.methodUnspecified,
												})
											}
										/>
									</FilterSection>
								</div>

								<div className="flex flex-col gap-4">
									{/* Only once there is more than one to choose between: a
								    single-option filter can only narrow to what you already
								    have. */}
									{(availableCategories?.length ?? 0) > 1 ? (
										<FilterSection
											title="Categories"
											// "Uncategorized" counts as one of the choices, so selecting
											// the whole section genuinely matches every order — without it,
											// select-all silently dropped every uncategorized order while
											// the hint claimed nothing was filtered (PR #235 review).
											selected={
												value.categories.length +
												(value.categoriesUnspecified ? 1 : 0)
											}
											total={(availableCategories?.length ?? 0) + 1}
											onToggleAll={(all) =>
												onChange({
													...value,
													categories: all
														? [...(availableCategories ?? [])]
														: [],
													categoriesUnspecified: all,
												})
											}
										>
											{availableCategories?.map((c) => (
												<FilterOptionRow
													key={c}
													label={c}
													count={facets?.category[c] ?? 0}
													selected={value.categories.includes(c)}
													onToggle={() =>
														onChange({
															...value,
															categories: value.categories.includes(c)
																? value.categories.filter((x) => x !== c)
																: [...value.categories, c],
														})
													}
												/>
											))}
											{/* Last and muted, like "Unspecified" under Payment method: it
											    names an absence, not one of the seller's own categories. */}
											<FilterOptionRow
												label="Uncategorized"
												muted
												count={facets?.category[""] ?? 0}
												selected={value.categoriesUnspecified}
												onToggle={() =>
													onChange({
														...value,
														categoriesUnspecified: !value.categoriesUnspecified,
													})
												}
											/>
										</FilterSection>
									) : null}

									<FilterSection
										title="Order type"
										selected={value.sources.length}
										total={SOURCE_OPTIONS.length}
										onToggleAll={(all) =>
											onChange({
												...value,
												sources: all ? SOURCE_OPTIONS.map((o) => o.value) : [],
											})
										}
									>
										{SOURCE_OPTIONS.map((o) => (
											<FilterOptionRow
												key={o.value}
												label={o.label}
												count={facets?.source[o.value] ?? 0}
												selected={value.sources.includes(o.value)}
												onToggle={() =>
													onChange({
														...value,
														sources: value.sources.includes(o.value)
															? value.sources.filter((x) => x !== o.value)
															: [...value.sources, o.value],
													})
												}
											/>
										))}
									</FilterSection>

									{(availableSources?.length ?? 0) > 1 ? (
										<FilterSection
											title="Came from"
											hint="tag your links on Home"
											selected={value.attributionSources.length}
											total={availableSources?.length ?? 0}
											onToggleAll={(all) =>
												onChange({
													...value,
													attributionSources: all
														? [...(availableSources ?? [])]
														: [],
												})
											}
										>
											{availableSources?.map((src) => (
												<FilterOptionRow
													key={src}
													label={sourceLabel(src)}
													count={facets?.attribution[src] ?? 0}
													selected={value.attributionSources.includes(src)}
													onToggle={() => toggleAttributionSource(src)}
												/>
											))}
										</FilterSection>
									) : null}

									{/* Due windows OVERLAP (today is inside this week), so they
								    are round and mutually exclusive — a square box would
								    promise a set you can build, and the result would read
								    as an intersection while behaving as a union. */}
									<FilterSection title="Due date">
										{DUE_WINDOWS.map((w) => (
											<FilterOptionRow
												key={w.value}
												label={w.label}
												shape="radio"
												selected={value.fwin === w.value}
												onToggle={() =>
													onChange({
														...value,
														fwin: value.fwin === w.value ? undefined : w.value,
													})
												}
											/>
										))}
									</FilterSection>

									<FilterSection title="Order date">
										<div className="flex flex-wrap gap-1.5 px-0.5">
											{DATE_PRESETS.map((p) => {
												const r = presetRange(p.kind);
												const active =
													value.from === r.from && value.to === r.to;
												return (
													<FilterChip
														key={p.kind}
														tone="accent"
														selected={active}
														onClick={() =>
															onChange(
																active
																	? { ...value, from: undefined, to: undefined }
																	: { ...value, from: r.from, to: r.to },
															)
														}
													>
														{p.label}
													</FilterChip>
												);
											})}
											<button
												type="button"
												onClick={() => setCustomDates((x) => !x)}
												aria-pressed={showCustomDates}
												aria-label="Custom date range"
												className={cn(
													"flex size-10 items-center justify-center rounded-full border transition-colors",
													showCustomDates
														? "border-accent bg-accent/15 text-accent-emphasis"
														: "border-border bg-card text-muted-foreground hover:border-accent/40 hover:text-foreground",
												)}
											>
												<CalendarDays className="size-4.5" aria-hidden="true" />
											</button>
										</div>
										{showCustomDates ? (
											<div className="flex items-center gap-2 px-0.5 pt-1.5">
												<input
													type="date"
													value={toInputDate(value.from)}
													max={toInputDate(value.to) || undefined}
													onChange={(e) =>
														onChange({
															...value,
															from: startOfDay(e.target.value),
														})
													}
													className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm text-muted-foreground outline-none focus:border-ring focus:text-foreground focus:ring-2 focus:ring-ring/50"
													aria-label="From date"
												/>
												<span className="shrink-0 text-muted-foreground">
													–
												</span>
												<input
													type="date"
													value={toInputDate(value.to)}
													min={toInputDate(value.from) || undefined}
													onChange={(e) =>
														onChange({ ...value, to: endOfDay(e.target.value) })
													}
													className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm text-muted-foreground outline-none focus:border-ring focus:text-foreground focus:ring-2 focus:ring-ring/50"
													aria-label="To date"
												/>
											</div>
										) : null}
									</FilterSection>
								</div>
							</div>

							{/* Not a column filter and not any column — a cross-cutting
						    state, so it keeps its own full-width row at the end. */}
							{showMockup ? (
								<button
									type="button"
									aria-pressed={value.mockup}
									onClick={() => onChange({ ...value, mockup: !value.mockup })}
									className={cn(
										"flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors",
										value.mockup
											? "border-amber-500 bg-amber-50 dark:bg-amber-950"
											: "border-amber-200 bg-amber-50/60 hover:bg-amber-50 dark:border-amber-800 dark:bg-amber-950/60",
									)}
								>
									<span className="flex items-center gap-2.5 text-sm font-semibold text-amber-800 dark:text-amber-300">
										<Palette className="size-4.5" aria-hidden="true" />
										Needs mockup
										{mockupCount ? (
											<span className="font-bold">· {mockupCount}</span>
										) : null}
									</span>
									<span
										aria-hidden="true"
										className={cn(
											"relative inline-block h-[26px] w-11 shrink-0 rounded-full transition-colors",
											value.mockup ? "bg-amber-500" : "bg-border",
										)}
									>
										<span
											className={cn(
												"absolute top-[3px] size-5 rounded-full bg-white shadow transition-all",
												value.mockup ? "left-[21px]" : "left-[3px]",
											)}
										/>
									</span>
								</button>
							) : null}
						</div>

						<div className="flex shrink-0 items-center gap-3 border-t border-border bg-muted/40 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
							{/* Clear-all carries its own count: "Reset" never said how
							    much would go. Absent entirely when there is nothing to
							    undo, rather than sitting there disabled. */}
							{count > 0 ? (
								<button
									type="button"
									onClick={clearFilters}
									className="shrink-0 text-[13px] font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
								>
									Clear all ({count})
								</button>
							) : null}
							<Button
								type="button"
								onClick={() => setOpen(false)}
								className="ml-auto h-11 min-w-[9rem] text-[15px]"
							>
								{resultCount != null
									? `Show ${resultCount} order${resultCount === 1 ? "" : "s"}`
									: "Done"}
							</Button>
						</div>
					</Dialog.Content>
				</Dialog.Portal>
			</Dialog.Root>
		</>
	);
}

/**
 * One labelled group of options. A hairline card rather than a bare heading:
 * with nine dimensions on screen at once, the eye needs the group boundary more
 * than it needs another uppercase label to read.
 */
/**
 * One labelled group of options. A hairline card rather than a bare heading:
 * with nine dimensions on screen at once, the eye needs the group boundary more
 * than it needs another uppercase label to read.
 *
 * Where the group is a MULTI-select, its heading becomes the same tri-state
 * `BulkSelectRow` the column picker uses — select-all and clear-this-group on
 * one control, so a seller narrowing to "everything except Cancelled" ticks
 * once and unticks once instead of ticking five times.
 *
 * ⚠️ **A filter is not a column picker**, and the difference matters here:
 * selecting EVERY option in a dimension narrows nothing — "Unpaid OR Claimed OR
 * Paid" is every order. That is a legitimate stop on the way to "all except X",
 * so it is allowed, but the section says so plainly rather than leaving a
 * seller wondering why their list didn't move. Clicking a full parent clears
 * it, which is the honest way back.
 *
 * Sections with no `onToggleAll` (single-select due windows, the date range,
 * the mockup toggle) keep a plain heading — a select-all there would be
 * meaningless, and forcing the pattern everywhere is how a good idea becomes
 * clutter.
 */
function FilterSection({
	title,
	hint,
	selected,
	total,
	onToggleAll,
	children,
}: {
	title: string;
	hint?: string;
	selected?: number;
	total?: number;
	onToggleAll?: (selectAll: boolean) => void;
	children: React.ReactNode;
}) {
	const bulk =
		onToggleAll !== undefined && selected !== undefined && total !== undefined;
	return (
		<section className="rounded-xl border border-border/70 p-2">
			{bulk ? (
				<BulkSelectRow
					label={title}
					selected={selected}
					total={total}
					onToggle={onToggleAll}
				/>
			) : (
				<div className="flex items-baseline justify-between gap-2 px-1.5 pb-1 pt-0.5">
					<h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
						{title}
					</h3>
					{hint ? (
						<span className="truncate text-[11px] text-muted-foreground/70">
							{hint}
						</span>
					) : null}
				</div>
			)}
			{bulk && hint ? (
				<p className="px-2.5 pb-0.5 text-[11px] text-muted-foreground/70">
					{hint}
				</p>
			) : null}
			{children}
			{bulk && total > 0 && selected === total ? (
				<p className="px-2.5 pb-0.5 pt-1 text-[11px] text-muted-foreground">
					Every option selected — same as no {title.toLowerCase()} filter.
				</p>
			) : null}
		</section>
	);
}

function isPresetRange(v: OrderFilterValue): boolean {
	return DATE_PRESETS.some((p) => {
		const r = presetRange(p.kind);
		return v.from === r.from && v.to === r.to;
	});
}
