import { CalendarDays, Palette, SlidersHorizontal, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useState } from "react";
import {
	ORDER_PAYMENT_METHODS,
	type OrderPaymentMethod,
	PAYMENT_METHOD_LABELS,
} from "../../../convex/lib/paymentMethod";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

export type PaymentStatus = "unpaid" | "claimed" | "received";

const PAYMENT_OPTIONS: { value: PaymentStatus; label: string }[] = [
	{ value: "unpaid", label: "Unpaid" },
	{ value: "claimed", label: "Claimed" },
	{ value: "received", label: "Paid" },
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
}

export function activeFilterCount(v: OrderFilterValue): number {
	// A date range is one filter (not two), even with both bounds set; each
	// payment + method selection (incl. "unspecified") and the mockup toggle
	// each increment.
	return (
		v.payment.length +
		v.method.length +
		(v.methodUnspecified ? 1 : 0) +
		(v.from != null || v.to != null ? 1 : 0) +
		(v.mockup ? 1 : 0)
	);
}

type DatePreset = { label: string; kind: "today" | "7d" | "30d" | "month" };
const DATE_PRESETS: DatePreset[] = [
	{ label: "Today", kind: "today" },
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
		case "today":
			return { from: new Date(y, mo, d, 0, 0, 0, 0).getTime(), to: endToday };
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

function activeFilterLabels(
	v: OrderFilterValue,
	mockupCount?: number,
): string[] {
	const labels = [
		...(v.mockup
			? [`Needs mockup${mockupCount ? ` (${mockupCount})` : ""}`]
			: []),
		...v.payment.map(
			(p) => PAYMENT_OPTIONS.find((opt) => opt.value === p)?.label ?? p,
		),
		...v.method.map((m) => PAYMENT_METHOD_LABELS[m]),
		...(v.methodUnspecified ? ["Unspecified method"] : []),
	];
	const from = formatShortDate(v.from);
	const to = formatShortDate(v.to);
	if (from || to) labels.push(`${from ?? "Any"} - ${to ?? "Any"}`);
	return labels;
}

/**
 * Payment-status + date-range filters for the order inbox. Inline on desktop;
 * collapses into a bottom-sheet on phones (mobile-first). The active count drives
 * a badge on the mobile trigger. State is owned by the route (URL search params).
 */
export function OrderFilters({
	value,
	onChange,
	mockupCount,
}: {
	value: OrderFilterValue;
	onChange: (next: OrderFilterValue) => void;
	/** Orders awaiting a mockup — drives the toggle's count badge. The toggle is
	 * hidden when there are none (and it isn't already on). */
	mockupCount?: number;
}) {
	const [open, setOpen] = useState(false);
	const count = activeFilterCount(value);
	const showMockup = (mockupCount ?? 0) > 0 || value.mockup;
	const activeLabels = activeFilterLabels(value, mockupCount);
	const clearFilters = () =>
		onChange({
			payment: [],
			method: [],
			methodUnspecified: false,
			from: undefined,
			to: undefined,
			mockup: false,
		});

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

	const controls = (
		<div className="flex flex-col gap-5">
			{showMockup ? (
				<button
					type="button"
					aria-pressed={value.mockup}
					onClick={() => onChange({ ...value, mockup: !value.mockup })}
					className={cn(
						"inline-flex h-11 w-fit items-center gap-2 rounded-xl border px-3.5 text-sm font-medium transition-colors",
						value.mockup
							? "border-amber-500 bg-amber-500 text-white"
							: "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
					)}
				>
					<Palette className="size-3.5" aria-hidden="true" />
					Needs mockup
					{mockupCount ? (
						<span
							className={cn(
								"flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none",
								value.mockup
									? "bg-white/25 text-white"
									: "bg-amber-500 text-white",
							)}
						>
							{mockupCount > 99 ? "99+" : mockupCount}
						</span>
					) : null}
				</button>
			) : null}

			<div className="flex flex-col gap-2">
				<span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80 lg:shrink-0">
					Payment
				</span>
				<div className="flex flex-wrap gap-2">
					{PAYMENT_OPTIONS.map((opt) => {
						const on = value.payment.includes(opt.value);
						return (
							<button
								key={opt.value}
								type="button"
								onClick={() => togglePayment(opt.value)}
								aria-pressed={on}
								className={cn(
									"h-10 rounded-xl border px-3.5 text-sm font-medium transition-colors",
									on
										? "border-accent bg-accent text-accent-foreground"
										: "border-border bg-background text-muted-foreground hover:border-accent/40 hover:text-foreground",
								)}
							>
								{opt.label}
							</button>
						);
					})}
				</div>
			</div>

			<div className="flex flex-col gap-2">
				<span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80 lg:shrink-0">
					Method
				</span>
				<div className="flex flex-wrap gap-2">
					{ORDER_PAYMENT_METHODS.map((m) => {
						const on = value.method.includes(m);
						return (
							<button
								key={m}
								type="button"
								onClick={() => toggleMethod(m)}
								aria-pressed={on}
								className={cn(
									"h-10 rounded-xl border px-3.5 text-sm font-medium transition-colors",
									on
										? "border-accent bg-accent text-accent-foreground"
										: "border-border bg-background text-muted-foreground hover:border-accent/40 hover:text-foreground",
								)}
							>
								{PAYMENT_METHOD_LABELS[m]}
							</button>
						);
					})}
					{/* Orders with no recorded method — online / WhatsApp self-claim /
					    legacy. The only way to filter those. */}
					<button
						type="button"
						onClick={() =>
							onChange({
								...value,
								methodUnspecified: !value.methodUnspecified,
							})
						}
						aria-pressed={value.methodUnspecified}
						className={cn(
							"h-10 rounded-xl border px-3.5 text-sm font-medium transition-colors",
							value.methodUnspecified
								? "border-accent bg-accent text-accent-foreground"
								: "border-border bg-background text-muted-foreground hover:border-accent/40 hover:text-foreground",
						)}
					>
						Unspecified
					</button>
				</div>
			</div>

			<div className="flex flex-col gap-2">
				<span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80 lg:shrink-0">
					Date placed
				</span>
				<div className="flex flex-wrap items-center gap-1.5">
					{DATE_PRESETS.map((p) => {
						const r = presetRange(p.kind);
						const active = value.from === r.from && value.to === r.to;
						return (
							<button
								key={p.kind}
								type="button"
								aria-pressed={active}
								onClick={() => onChange({ ...value, from: r.from, to: r.to })}
								className={cn(
									"h-9 rounded-xl border px-3 text-xs font-medium transition-colors",
									active
										? "border-accent bg-accent text-accent-foreground"
										: "border-border bg-background text-muted-foreground hover:border-accent/40 hover:text-foreground",
								)}
							>
								{p.label}
							</button>
						);
					})}
				</div>
				<div className="flex items-center gap-2">
					<input
						type="date"
						value={toInputDate(value.from)}
						max={toInputDate(value.to) || undefined}
						onChange={(e) =>
							onChange({ ...value, from: startOfDay(e.target.value) })
						}
						className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm text-muted-foreground outline-none focus:border-ring focus:text-foreground focus:ring-2 focus:ring-ring/50 lg:w-[8.5rem] lg:flex-none"
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
						className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm text-muted-foreground outline-none focus:border-ring focus:text-foreground focus:ring-2 focus:ring-ring/50 lg:w-[8.5rem] lg:flex-none"
						aria-label="To date"
					/>
				</div>
			</div>

			{count > 0 ? (
				<button
					type="button"
					onClick={clearFilters}
					className="inline-flex h-9 w-fit items-center gap-1.5 self-start rounded-xl border border-border bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted hover:text-foreground"
				>
					<X className="size-3.5" aria-hidden="true" />
					Clear filters
				</button>
			) : null}
		</div>
	);

	return (
		<>
			<div className="flex flex-col gap-3">
				<div className="flex flex-wrap items-center gap-2">
					<button
						type="button"
						onClick={() => setOpen(true)}
						className={cn(
							"inline-flex h-11 items-center gap-2 rounded-xl border px-3.5 text-sm font-medium transition-colors",
							count > 0
								? "border-accent bg-accent text-accent-foreground"
								: "border-border bg-background text-muted-foreground hover:border-accent/40 hover:text-foreground",
						)}
					>
						<SlidersHorizontal className="size-4" />
						Filters
						{count > 0 ? (
							<span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-white/25 px-1 text-[11px] font-semibold leading-none text-accent-foreground">
								{count}
							</span>
						) : null}
					</button>

					{activeLabels.length > 0 ? (
						<div className="-mr-3 flex min-w-0 flex-1 gap-2 overflow-x-auto pr-3 [scrollbar-width:none] lg:mr-0 lg:flex-wrap lg:overflow-visible lg:pr-0 [&::-webkit-scrollbar]:hidden">
							{activeLabels.map((label) => (
								<span
									key={label}
									className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted/60 px-3 text-xs font-medium text-foreground"
								>
									{label}
								</span>
							))}
							<button
								type="button"
								onClick={clearFilters}
								className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
							>
								<X className="size-3.5" aria-hidden="true" />
								Clear
							</button>
						</div>
					) : (
						<span className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:inline-flex">
							<CalendarDays className="size-4" aria-hidden="true" />
							Payment, method, date
						</span>
					)}
				</div>
			</div>

			<Dialog.Root open={open} onOpenChange={setOpen}>
				<Dialog.Portal>
					<Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in" />
					<Dialog.Content
						className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col gap-4 overflow-y-auto rounded-t-3xl border-t border-border bg-background p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-1/2 sm:w-[min(92vw,560px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:shadow-xl"
						aria-describedby={undefined}
					>
						<div className="flex items-center justify-between">
							<Dialog.Title className="text-base font-semibold">
								Filters
							</Dialog.Title>
							<Dialog.Close asChild>
								<button
									type="button"
									className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
									aria-label="Close"
								>
									<X className="size-5" />
								</button>
							</Dialog.Close>
						</div>
						{controls}
						<Button
							type="button"
							onClick={() => setOpen(false)}
							className="h-11 w-full"
						>
							Done
						</Button>
					</Dialog.Content>
				</Dialog.Portal>
			</Dialog.Root>
		</>
	);
}
