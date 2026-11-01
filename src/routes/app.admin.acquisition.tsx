// /app/admin/acquisition — the CAC ledger (86eye3eyp,
// docs/acquisition-attribution.md). One month at a time: what each
// acquisition channel cost Kedaipal (cash + founder hours), how many stores
// tagged to it paid their first invoice that month, and the cost per store.
// Kedaipal's own spend, so it sits in the Admin group after Billing (money
// IN from sellers) and never inside it — mixing the two would muddy both.

import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import {
	ChevronLeft,
	ChevronRight,
	Clock,
	Coins,
	ShieldX,
	Store,
	Wallet,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import {
	ACQUISITION_NOTE_MAX,
	type AcquisitionChannel,
	FOUNDER_HOURLY_RATE_SEN,
} from "../../convex/lib/metrics";
import { addMonthsMyt, monthStartMyt } from "../../convex/lib/usagePeriod";
import type { AcquisitionMonth } from "../../convex/metrics";
import {
	StatTileGrid,
	type StatTileProps,
} from "../components/admin/stat-tile";
import { PageHeader } from "../components/dashboard/page-header";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import {
	changedEntries,
	draftFrom,
	formatCac,
	formatRinggit,
	monthParam,
	monthTitle,
	parseHours,
	parseRinggit,
	resolveMonth,
	type SpendDraft,
} from "../lib/acquisition-ledger";
import { convexErrorMessage } from "../lib/format";
import { searchText } from "../lib/search-params";
import { TONE_PANEL } from "../lib/tone";
import { cn } from "../lib/utils";

export interface AcquisitionSearch {
	/** `2026-09`. Absent = the current month. */
	month?: string;
}

export const Route = createFileRoute("/app/admin/acquisition")({
	// Every key returned (src/lib/search-params.ts): an omitted key lets the
	// raw parsed value leak into useSearch().
	validateSearch: (search: Record<string, unknown>): AcquisitionSearch => ({
		month: searchText(search.month),
	}),
	component: AdminAcquisitionRoute,
});

const RATE_RM = FOUNDER_HOURLY_RATE_SEN / 100;

function AdminAcquisitionRoute() {
	// Client gate is cosmetic — every metrics function is requireAdmin.
	const isAdmin = useQuery(convexQuery(api.billing.amIAdmin, {})).data;
	if (isAdmin === undefined) {
		return (
			<div className="flex flex-col gap-4 lg:max-w-5xl">
				<Skeleton className="h-7 w-40" />
				<Skeleton className="h-24 w-full rounded-2xl" />
			</div>
		);
	}
	if (!isAdmin) {
		return (
			<div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-16 text-center">
				<ShieldX className="size-8 text-muted-foreground" />
				<p className="font-medium">Not authorized</p>
				<p className="max-w-xs text-sm text-muted-foreground">
					This area is for Kedaipal admins only.
				</p>
			</div>
		);
	}
	return <AcquisitionContent />;
}

function AcquisitionContent() {
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const now = Date.now();
	const periodStart = resolveMonth(search.month, now);
	const isCurrent = periodStart === monthStartMyt(now);
	const month = useQuery(
		convexQuery(api.metrics.getMonth, { periodStart }),
	).data;

	function goTo(next: number) {
		void navigate({
			search: {
				month:
					next === monthStartMyt(Date.now()) ? undefined : monthParam(next),
			},
		});
	}

	const subtitle = `What each channel cost Kedaipal. Founder time is costed at RM${RATE_RM} an hour. A store counts towards a channel once it's tagged in All sellers.`;

	return (
		<div className="flex flex-col gap-5 lg:max-w-5xl">
			<PageHeader
				title="Admin · Acquisition"
				subtitle={subtitle}
				actions={
					<MonthSwitcher
						periodStart={periodStart}
						isCurrent={isCurrent}
						onGo={goTo}
					/>
				}
			/>
			<section className="flex flex-col gap-3 lg:hidden">
				<div className="flex flex-col gap-1">
					<h2 className="text-xl font-bold">Admin · Acquisition</h2>
					<p className="text-sm text-muted-foreground">{subtitle}</p>
				</div>
				<MonthSwitcher
					periodStart={periodStart}
					isCurrent={isCurrent}
					onGo={goTo}
				/>
			</section>

			{month === undefined ? (
				<div className="flex flex-col gap-3">
					<div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
						{[0, 1, 2, 3].map((n) => (
							<Skeleton key={n} className="h-20 rounded-2xl" />
						))}
					</div>
					<Skeleton className="h-96 w-full rounded-2xl" />
				</div>
			) : (
				// Keyed by month so switching months starts from the saved figures,
				// never the last month's unsaved typing.
				<MonthLedger key={month.periodStart} month={month} />
			)}
		</div>
	);
}

function MonthSwitcher({
	periodStart,
	isCurrent,
	onGo,
}: {
	periodStart: number;
	isCurrent: boolean;
	onGo: (next: number) => void;
}) {
	return (
		<fieldset className="flex items-center gap-1">
			<legend className="sr-only">Month</legend>
			<Button
				type="button"
				variant="outline"
				size="icon"
				className="tap-target"
				aria-label="Previous month"
				onClick={() => onGo(addMonthsMyt(periodStart, -1))}
			>
				<ChevronLeft className="size-4" />
			</Button>
			<span
				className="min-w-36 text-center font-heading text-base font-bold"
				aria-live="polite"
			>
				{monthTitle(periodStart)}
			</span>
			<Button
				type="button"
				variant="outline"
				size="icon"
				className="tap-target"
				aria-label="Next month"
				title={
					isCurrent ? "Spend is recorded once a month has started" : undefined
				}
				disabled={isCurrent}
				onClick={() => onGo(addMonthsMyt(periodStart, 1))}
			>
				<ChevronRight className="size-4" />
			</Button>
		</fieldset>
	);
}

export function MonthLedger({ month }: { month: AcquisitionMonth }) {
	const recordSpend = useMutation(api.metrics.recordSpend);
	const saved = useMemo(
		() => month.rows.map((r) => ({ channel: r.channel, draft: draftFrom(r) })),
		[month.rows],
	);
	const [drafts, setDrafts] = useState<Record<string, SpendDraft>>(() =>
		Object.fromEntries(saved.map((s) => [s.channel, s.draft])),
	);
	const [saving, setSaving] = useState(false);
	const { entries, invalid } = changedEntries(drafts, saved);
	const dirty = entries.length + invalid.length;
	const title = monthTitle(month.periodStart);

	function edit(channel: AcquisitionChannel, patch: Partial<SpendDraft>) {
		setDrafts((prev) => ({
			...prev,
			[channel]: { ...prev[channel], ...patch },
		}));
	}

	function startFromPrevious() {
		if (!month.previous) return;
		setDrafts((prev) => {
			const next = { ...prev };
			for (const p of month.previous ?? []) next[p.channel] = draftFrom(p);
			return next;
		});
	}

	function discard() {
		setDrafts(Object.fromEntries(saved.map((s) => [s.channel, s.draft])));
	}

	async function save() {
		setSaving(true);
		try {
			await recordSpend({ periodStart: month.periodStart, entries });
			toast.success(`${title} saved`, {
				description: `${entries.length} channel${entries.length === 1 ? "" : "s"} updated.`,
			});
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	const { totals } = month;
	const spentChannels = month.rows.filter((r) => r.cashSpend > 0).length;
	const tiles: StatTileProps[] = [
		{
			label: "Cash spent",
			value: formatRinggit(totals.cashSpend),
			helper: `across ${spentChannels} channel${spentChannels === 1 ? "" : "s"}`,
			icon: <Wallet className="size-4" />,
			tone: "neutral",
		},
		{
			label: "Founder time",
			value: `${totals.founderHours} h`,
			helper: `${formatRinggit(totals.founderHours * FOUNDER_HOURLY_RATE_SEN)} at RM${RATE_RM}/h`,
			icon: <Clock className="size-4" />,
			tone: "neutral",
		},
		{
			label: "Total cost",
			value: formatRinggit(totals.costSen),
			helper: "cash + founder time",
			icon: <Coins className="size-4" />,
			tone: "neutral",
		},
		{
			label: "New paying stores",
			value: String(totals.newPayers),
			helper:
				totals.cacSen !== null
					? `blended CAC ${formatCac(totals.cacSen)}`
					: "none tagged yet",
			icon: <Store className="size-4" />,
			tone: totals.newPayers > 0 ? "success" : "neutral",
		},
	];

	return (
		<>
			<StatTileGrid tiles={tiles} />

			{month.untaggedNewPayers > 0 ? (
				<div
					className={cn(
						"flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm",
						TONE_PANEL.warn,
					)}
				>
					<span>
						{month.untaggedNewPayers} store
						{month.untaggedNewPayers === 1 ? "" : "s"} paid a first invoice in{" "}
						{title} with no confirmed channel, so the CAC above leaves{" "}
						{month.untaggedNewPayers === 1 ? "it" : "them"} out.
					</span>
					<Button
						asChild
						variant="outline"
						size="sm"
						className="tap-target bg-background"
					>
						<Link
							to="/app/admin/sellers"
							search={{ status: "untagged_payers" }}
						>
							Tag them
						</Link>
					</Button>
				</div>
			) : null}

			{!month.recorded ? (
				<div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-border px-4 py-4">
					<div className="flex flex-col gap-1">
						<p className="font-heading font-bold">
							Nothing recorded for {title} yet
						</p>
						<p className="text-sm text-muted-foreground">
							Fill in the channels that cost something. A channel left blank
							counts as no spend.
						</p>
					</div>
					{month.previous ? (
						<Button
							type="button"
							variant="outline"
							className="tap-target"
							onClick={startFromPrevious}
						>
							Start from{" "}
							{monthTitle(addMonthsMyt(month.periodStart, -1)).split(" ")[0]}'s
							figures
						</Button>
					) : null}
				</div>
			) : null}

			<div className="overflow-hidden rounded-2xl border border-border">
				<div className="hidden grid-cols-[minmax(0,1.3fr)_9rem_7rem_minmax(0,2fr)_6rem_7rem] gap-3 border-b border-border bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground lg:grid">
					<span>Channel</span>
					<span>Cash (RM)</span>
					<span>Founder hours</span>
					<span>Note</span>
					<span className="text-right">New payers</span>
					<span className="text-right">CAC</span>
				</div>
				<ul className="divide-y divide-border">
					{month.rows.map((row) => (
						<SpendRowEditor
							key={row.channel}
							row={row}
							draft={drafts[row.channel] ?? draftFrom(row)}
							invalid={invalid.includes(row.channel)}
							onEdit={(patch) => edit(row.channel, patch)}
						/>
					))}
				</ul>
			</div>
			<p className="text-xs text-muted-foreground">
				CAC = (cash + founder hours × RM{RATE_RM}) ÷ stores tagged to that
				channel whose first invoice was paid in {title}. “—” means no paying
				store yet, not zero cost.
				{month.scanCapped
					? " Payer counts stop at the newest 5,000 paid invoices."
					: ""}
			</p>

			{/* Sticky just above the phone's bottom tab bar (it publishes its
			    height), at the viewport's foot on desktop — always in reach
			    while the admin is half-way down the channels. */}
			<div className="sticky bottom-[calc(var(--app-bottomnav-h,0px)+0.5rem)] z-20 rounded-2xl border border-border bg-background/95 px-4 py-3 shadow-lg backdrop-blur lg:bottom-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<span className="text-sm text-muted-foreground">
						{invalid.length > 0
							? `Fix ${invalid.length} amount${invalid.length === 1 ? "" : "s"} to save`
							: dirty === 0
								? "No unsaved changes"
								: `${dirty} unsaved change${dirty === 1 ? "" : "s"}`}
					</span>
					<div className="flex gap-2">
						<Button
							type="button"
							variant="ghost"
							className="tap-target"
							onClick={discard}
							disabled={dirty === 0 || saving}
						>
							Discard
						</Button>
						<Button
							type="button"
							className="tap-target"
							onClick={save}
							disabled={entries.length === 0 || invalid.length > 0 || saving}
							isLoading={saving}
						>
							Save {title.split(" ")[0]}
						</Button>
					</div>
				</div>
			</div>
		</>
	);
}

function SpendRowEditor({
	row,
	draft,
	invalid,
	onEdit,
}: {
	row: AcquisitionMonth["rows"][number];
	draft: SpendDraft;
	invalid: boolean;
	onEdit: (patch: Partial<SpendDraft>) => void;
}) {
	const cashBad = parseRinggit(draft.cash) === null;
	const hoursBad = parseHours(draft.hours) === null;
	const id = `spend-${row.channel}`;
	return (
		<li className="grid grid-cols-2 items-start gap-x-3 gap-y-2 px-4 py-3 lg:grid-cols-[minmax(0,1.3fr)_9rem_7rem_minmax(0,2fr)_6rem_7rem] lg:items-center">
			<div className="col-span-2 flex items-start justify-between gap-3 lg:col-span-1 lg:flex-col lg:gap-0">
				<span className="flex min-w-0 flex-col">
					<span className="text-sm font-semibold">{row.label}</span>
					<span className="text-xs text-muted-foreground">{row.hint}</span>
				</span>
				{/* On a phone the outcome sits beside the name; the desktop
				    columns carry it at the row's end. */}
				<span className="shrink-0 text-right text-xs text-muted-foreground lg:hidden">
					{row.newPayers} new · CAC{" "}
					<span
						className={
							row.cacSen !== null ? "font-semibold text-foreground" : ""
						}
					>
						{row.cacSen !== null ? formatCac(row.cacSen) : "—"}
					</span>
				</span>
			</div>
			<label className="flex flex-col gap-1">
				<span className="text-xs text-muted-foreground lg:sr-only">
					Cash (RM)
				</span>
				<Input
					id={`${id}-cash`}
					variant="field"
					inputMode="decimal"
					placeholder="0.00"
					value={draft.cash}
					aria-label={`${row.label} cash spend in ringgit`}
					aria-invalid={cashBad}
					onChange={(e) => onEdit({ cash: e.target.value })}
					className="text-right tabular-nums"
				/>
			</label>
			<label className="flex flex-col gap-1">
				<span className="text-xs text-muted-foreground lg:sr-only">
					Founder hours
				</span>
				<Input
					id={`${id}-hours`}
					variant="field"
					inputMode="decimal"
					placeholder="0"
					value={draft.hours}
					aria-label={`${row.label} founder hours`}
					aria-invalid={hoursBad}
					onChange={(e) => onEdit({ hours: e.target.value })}
					className="text-right tabular-nums"
				/>
			</label>
			<label className="col-span-2 flex flex-col gap-1 lg:col-span-1">
				<span className="text-xs text-muted-foreground lg:sr-only">Note</span>
				<Input
					id={`${id}-note`}
					variant="field"
					placeholder="What the spend was"
					maxLength={ACQUISITION_NOTE_MAX}
					value={draft.note}
					aria-label={`${row.label} note`}
					onChange={(e) => onEdit({ note: e.target.value })}
				/>
			</label>
			<span className="hidden text-right text-sm tabular-nums lg:block">
				{row.newPayers}
			</span>
			<span
				className={cn(
					"hidden text-right text-sm tabular-nums lg:block",
					row.cacSen !== null ? "font-semibold" : "text-muted-foreground",
				)}
			>
				{row.cacSen !== null ? formatCac(row.cacSen) : "—"}
			</span>
			{invalid ? (
				<p className="col-span-2 text-xs text-destructive lg:col-span-6">
					{cashBad
						? "Cash must be a ringgit amount like 120 or 120.50."
						: "Hours must be a number like 3 or 1.5."}
				</p>
			) : null}
		</li>
	);
}
