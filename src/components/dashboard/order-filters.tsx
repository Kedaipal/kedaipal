import { Palette, SlidersHorizontal, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useState } from "react";
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
	/** Epoch ms, start-of-day. */
	from?: number;
	/** Epoch ms, end-of-day. */
	to?: number;
	/** Cross-cutting "only orders awaiting a mockup" toggle. */
	mockup: boolean;
}

export function activeFilterCount(v: OrderFilterValue): number {
	// A date range is one filter (not two), even with both bounds set; each
	// payment selection + the mockup toggle each increment.
	return (
		v.payment.length +
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

	function togglePayment(p: PaymentStatus) {
		onChange({
			...value,
			payment: value.payment.includes(p)
				? value.payment.filter((x) => x !== p)
				: [...value.payment, p],
		});
	}

	const controls = (
		<div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-5 lg:gap-y-3">
			{showMockup ? (
				<button
					type="button"
					aria-pressed={value.mockup}
					onClick={() => onChange({ ...value, mockup: !value.mockup })}
					className={cn(
						"inline-flex h-9 w-fit items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors",
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

			<div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-2.5">
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
									"h-9 rounded-full border px-3.5 text-sm transition-colors",
									on
										? "border-foreground bg-foreground text-background"
										: "border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground",
								)}
							>
								{opt.label}
							</button>
						);
					})}
				</div>
			</div>

			<div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-2.5">
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
									"h-8 rounded-full border px-3 text-xs font-medium transition-colors",
									active
										? "border-foreground bg-foreground text-background"
										: "border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground",
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
					onClick={() =>
						onChange({
							payment: [],
							from: undefined,
							to: undefined,
							mockup: false,
						})
					}
					className="inline-flex h-8 w-fit items-center gap-1.5 self-start rounded-full border border-border bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted hover:text-foreground lg:self-auto"
				>
					<X className="size-3.5" aria-hidden="true" />
					Clear filters
				</button>
			) : null}
		</div>
	);

	return (
		<>
			{/* Desktop: inline */}
			<div className="hidden lg:block">{controls}</div>

			{/* Mobile: trigger → bottom-sheet */}
			<div className="lg:hidden">
				<button
					type="button"
					onClick={() => setOpen(true)}
					className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-background px-3.5 text-sm text-muted-foreground"
				>
					<SlidersHorizontal className="size-4" />
					Filters
					{count > 0 ? (
						<span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground px-1 text-[11px] font-semibold leading-none text-background">
							{count}
						</span>
					) : null}
				</button>
				<Dialog.Root open={open} onOpenChange={setOpen}>
					<Dialog.Portal>
						<Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in" />
						<Dialog.Content
							className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col gap-4 rounded-t-3xl border-t border-border bg-background p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom"
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
			</div>
		</>
	);
}
