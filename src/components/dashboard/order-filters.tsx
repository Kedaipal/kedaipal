import { CalendarDays, Palette, SlidersHorizontal, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useState } from "react";
import type { FulfilmentWindow } from "../../../convex/lib/fulfilmentDate";
import {
	ORDER_PAYMENT_METHODS,
	type OrderPaymentMethod,
	PAYMENT_METHOD_LABELS,
} from "../../../convex/lib/paymentMethod";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { FilterChip } from "../ui/filter-chip";

export type PaymentStatus = "unpaid" | "claimed" | "received";

/** Checkout surface the order came through (mirrors orders.source). */
export type OrderSource = "storefront" | "counter";

const SOURCE_OPTIONS: { value: OrderSource; label: string }[] = [
	{ value: "storefront", label: "Online" },
	{ value: "counter", label: "Counter" },
];

const PAYMENT_OPTIONS: { value: PaymentStatus; label: string }[] = [
	{ value: "unpaid", label: "Unpaid" },
	{ value: "claimed", label: "Claimed" },
	{ value: "received", label: "Paid" },
];

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
	/** Checkout surface (online vs counter). Unset = both. */
	source?: OrderSource;
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
		(v.source != null ? 1 : 0)
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
): FilterToken[] {
	const tokens: FilterToken[] = [];
	if (v.source) {
		tokens.push({
			key: `source-${v.source}`,
			label:
				SOURCE_OPTIONS.find((o) => o.value === v.source)?.label ?? v.source,
			clear: (x) => ({ ...x, source: undefined }),
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
		source: undefined,
	};
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
	mockupCount,
	resultCount,
}: {
	value: OrderFilterValue;
	onChange: (next: OrderFilterValue) => void;
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
	const tokens = activeFilterTokens(value, mockupCount);
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
						className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col gap-5 overflow-y-auto rounded-t-3xl border-t border-border bg-background p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-1/2 sm:w-[min(92vw,560px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:shadow-xl"
						aria-describedby={undefined}
					>
						<div
							className="mx-auto h-1 w-10 shrink-0 rounded-full bg-border sm:hidden"
							aria-hidden="true"
						/>
						<div className="flex items-center justify-between">
							<Dialog.Title className="font-heading text-lg font-bold">
								Filters
							</Dialog.Title>
							{count > 0 ? (
								<button
									type="button"
									onClick={clearFilters}
									className="text-sm font-medium text-muted-foreground hover:text-foreground"
								>
									Reset
								</button>
							) : (
								<Dialog.Close asChild>
									<button
										type="button"
										className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
										aria-label="Close"
									>
										<X className="size-5" />
									</button>
								</Dialog.Close>
							)}
						</div>

						<div className="flex flex-col gap-2">
							<span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
								Due date
							</span>
							<div className="flex flex-wrap gap-2">
								{DUE_WINDOWS.map((w) => (
									<FilterChip
										key={w.value}
										tone="accent"
										selected={value.fwin === w.value}
										onClick={() =>
											onChange({
												...value,
												fwin: value.fwin === w.value ? undefined : w.value,
											})
										}
									>
										<CalendarDays className="size-3.5" aria-hidden="true" />
										{w.label}
									</FilterChip>
								))}
							</div>
						</div>

						<div className="flex flex-col gap-2">
							<span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
								Order type
							</span>
							<div className="flex flex-wrap gap-2">
								{SOURCE_OPTIONS.map((opt) => (
									<FilterChip
										key={opt.value}
										tone="accent"
										selected={value.source === opt.value}
										onClick={() =>
											onChange({
												...value,
												source:
													value.source === opt.value ? undefined : opt.value,
											})
										}
									>
										{opt.label}
									</FilterChip>
								))}
							</div>
						</div>

						<div className="flex flex-col gap-2">
							<span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
								Payment
							</span>
							<div className="flex flex-wrap gap-2">
								{PAYMENT_OPTIONS.map((opt) => (
									<FilterChip
										key={opt.value}
										tone="accent"
										selected={value.payment.includes(opt.value)}
										onClick={() => togglePayment(opt.value)}
									>
										{opt.label}
									</FilterChip>
								))}
							</div>
						</div>

						<div className="flex flex-col gap-2">
							<span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
								Payment method
							</span>
							<div className="flex flex-wrap gap-2">
								{ORDER_PAYMENT_METHODS.map((m) => (
									<FilterChip
										key={m}
										tone="accent"
										selected={value.method.includes(m)}
										onClick={() => toggleMethod(m)}
									>
										{PAYMENT_METHOD_LABELS[m]}
									</FilterChip>
								))}
								{/* Orders with no recorded method — online / WhatsApp
								    self-claim / legacy. The only way to filter those. */}
								<FilterChip
									tone="accent"
									selected={value.methodUnspecified}
									onClick={() =>
										onChange({
											...value,
											methodUnspecified: !value.methodUnspecified,
										})
									}
								>
									Unspecified
								</FilterChip>
							</div>
						</div>

						<div className="flex flex-col gap-2">
							<span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
								Order date
							</span>
							<div className="flex flex-wrap items-center gap-2">
								{DATE_PRESETS.map((p) => {
									const r = presetRange(p.kind);
									const active = value.from === r.from && value.to === r.to;
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
								<div className="flex items-center gap-2">
									<input
										type="date"
										value={toInputDate(value.from)}
										max={toInputDate(value.to) || undefined}
										onChange={(e) =>
											onChange({ ...value, from: startOfDay(e.target.value) })
										}
										className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm text-muted-foreground outline-none focus:border-ring focus:text-foreground focus:ring-2 focus:ring-ring/50"
										aria-label="From date"
									/>
									<span className="shrink-0 text-muted-foreground">–</span>
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
						</div>

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

						<Button
							type="button"
							onClick={() => setOpen(false)}
							className="h-12 w-full text-[15px]"
						>
							{resultCount != null
								? `Show ${resultCount} order${resultCount === 1 ? "" : "s"}`
								: "Done"}
						</Button>
					</Dialog.Content>
				</Dialog.Portal>
			</Dialog.Root>
		</>
	);
}

function isPresetRange(v: OrderFilterValue): boolean {
	return DATE_PRESETS.some((p) => {
		const r = presetRange(p.kind);
		return v.from === r.from && v.to === r.to;
	});
}
