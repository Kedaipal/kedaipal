/**
 * The Deliveries page body (86eye9xd4, 6A) — presentational: the overview in,
 * links and the print dialog out. It adapts to how the store ships, the same
 * question the rest of the app keys on:
 *
 *  - parcels the seller hands to a courier → **To ship** (packed, no
 *    consignment number yet, labels one tap away) and **In transit**;
 *  - bookings made through Kedaipal (Lalamove riders, Delyva couriers) →
 *    **Courier bookings**, filterable, each row carrying the one action its
 *    state needs (track, see the proof, rebook).
 *
 * Order by urgency: what the seller must do today first, what is merely
 * moving last. A store that does neither gets one empty state that says how
 * deliveries get here, never a blank page.
 */

import { Link } from "@tanstack/react-router";
import {
	ExternalLink,
	PackageCheck,
	Printer,
	TriangleAlert,
	Truck,
	Wallet,
} from "lucide-react";
import { useState } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import type {
	DeliveriesOverview,
	DeliveryJobRow,
	JobGroup,
	ParcelRow,
} from "../../../convex/deliveries";
import { GATED_CELL_LABEL } from "../../../convex/lib/credits";
import {
	JOB_TONE_CLASS,
	jobStatusLabel,
	jobStatusTone,
} from "../../lib/delivery-job-status";
import { formatPrice } from "../../lib/format";
import { cn } from "../../lib/utils";
import { PrintLabelsDialog } from "../dashboard/print-labels-dialog";
import { Card, Glance, SectionHeading } from "../settings/settings-primitives";
import { Button } from "../ui/button";
import { FilterChip, FilterChipRow } from "../ui/filter-chip";

const MONTH = new Intl.DateTimeFormat("en-MY", { month: "short" });

/** "Oct · 23 · RM 412.00" — the month's bookings at a glance. */
export function monthGlance(o: DeliveriesOverview): string {
	const spend = formatPrice(o.month.cost, o.currency);
	return `${MONTH.format(o.month.start)} · ${o.month.partial ? `${o.month.bookings}+` : o.month.bookings} · ${spend}`;
}

export function WalletGlance({
	wallet,
}: {
	wallet: DeliveriesOverview["wallet"];
}) {
	if (!wallet) return null;
	return (
		<Glance tone={wallet.low ? "warn" : "grey"}>
			<Wallet aria-hidden className="mr-1 size-3" />
			Wallet {formatPrice(wallet.balance, wallet.currency)}
		</Glance>
	);
}

/** Warns BEFORE a booking fails on an empty wallet — Home and this page. */
export function LowWalletBanner({
	wallet,
}: {
	wallet: DeliveriesOverview["wallet"];
}) {
	if (!wallet?.low) return null;
	return (
		<section
			aria-label="Lalamove wallet low"
			className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
		>
			<TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
			<p className="text-sm">
				<span className="font-semibold">
					Lalamove wallet low — {formatPrice(wallet.balance, wallet.currency)}{" "}
					left.
				</span>{" "}
				Top up the Lalamove Business account your keys belong to before your
				next booking fails.
			</p>
		</section>
	);
}

export function DeliveriesView({
	overview,
	retailerId,
	paperLabel,
}: {
	overview: DeliveriesOverview;
	retailerId: Id<"retailers">;
	/** The store's saved label size, for the print dialog. */
	paperLabel: string;
}) {
	const { booksCouriers, shipsParcels } = overview;
	if (!booksCouriers && !shipsParcels) return <NothingYet />;
	return (
		<div className="flex flex-col gap-6">
			<LowWalletBanner wallet={overview.wallet} />
			{shipsParcels ? (
				<ToShipCard
					overview={overview}
					retailerId={retailerId}
					paperLabel={paperLabel}
				/>
			) : null}
			{booksCouriers ? <BookingsCard overview={overview} /> : null}
			{shipsParcels ? <InTransitCard overview={overview} /> : null}
		</div>
	);
}

// --- Parcels -----------------------------------------------------------------

function ToShipCard({
	overview,
	retailerId,
	paperLabel,
}: {
	overview: DeliveriesOverview;
	retailerId: Id<"retailers">;
	paperLabel: string;
}) {
	const [printing, setPrinting] = useState(false);
	const { toShip, counts, currency } = overview;
	const labels = counts.labelsReady;
	return (
		<Card>
			<SectionHeading
				title="To ship"
				description="Book with your courier, then add each consignment number — your buyer sees it on their order page."
				glance={
					counts.toShip > 0 ? (
						<Glance tone="warn">
							{counts.toShip} {counts.toShip === 1 ? "parcel" : "parcels"}
						</Glance>
					) : (
						<Glance tone="grey">All out</Glance>
					)
				}
			/>
			{/* Despatch labels live here now (6A) — the queue they print is this
			    one. Shown at zero too, disabled with its reason: the count is
			    how a seller learns the feature exists. */}
			<div className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5">
				<PackageCheck
					aria-hidden
					className="size-5 shrink-0 text-muted-foreground"
				/>
				<p className="min-w-0 flex-1 text-xs text-muted-foreground">
					{labels > 0
						? `${labels} packed and paid — labels ready to print.`
						: "Packed and paid orders print their despatch labels from here."}
				</p>
				<Button
					type="button"
					size="sm"
					variant={labels > 0 ? "default" : "outline"}
					className="tap-target shrink-0"
					disabled={labels === 0}
					title={
						labels === 0
							? "Nothing is packed and paid for yet"
							: `Choose and print ${labels} label${labels === 1 ? "" : "s"}`
					}
					onClick={() => setPrinting(true)}
				>
					<Printer className="size-4" />
					Print labels
					{labels > 0 ? (
						<span className="font-bold tabular-nums">{labels}</span>
					) : null}
				</Button>
			</div>
			{toShip.length === 0 ? (
				<p className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
					Nothing waiting. Packed delivery orders show up here until they have a
					consignment number.
				</p>
			) : (
				<ul className="flex flex-col divide-y divide-border">
					{toShip.map((row) => (
						<ParcelLine
							key={row.orderId}
							row={row}
							currency={currency}
							action="add"
						/>
					))}
				</ul>
			)}
			{counts.toShip > toShip.length ? (
				<p className="text-xs text-muted-foreground">
					Showing the {toShip.length} that have waited longest of{" "}
					{counts.toShip}.
				</p>
			) : null}
			<PrintLabelsDialog
				mode="queue"
				open={printing}
				onOpenChange={setPrinting}
				retailerId={retailerId}
				paperLabel={paperLabel}
			/>
		</Card>
	);
}

function InTransitCard({ overview }: { overview: DeliveriesOverview }) {
	const { inTransit, counts, currency } = overview;
	if (counts.inTransit === 0) return null;
	return (
		<Card>
			<SectionHeading
				title="In transit"
				description="Out with your courier. Mark each one delivered on its order when it arrives."
				glance={<Glance tone="grey">{counts.inTransit}</Glance>}
			/>
			<ul className="flex flex-col divide-y divide-border">
				{inTransit.map((row) => (
					<ParcelLine
						key={row.orderId}
						row={row}
						currency={currency}
						action="track"
					/>
				))}
			</ul>
		</Card>
	);
}

function ParcelLine({
	row,
	currency,
	action,
}: {
	row: ParcelRow;
	currency: string;
	action: "add" | "track";
}) {
	const detail =
		action === "add"
			? [
					row.gated ? GATED_CELL_LABEL : row.destination,
					row.deliveryFee !== undefined
						? `${formatPrice(row.deliveryFee, currency)} charged`
						: undefined,
					row.labelPrintedAt ? "label printed" : undefined,
				]
			: [row.courierName, row.trackingNo];
	return (
		<li className="flex min-h-14 items-center gap-3 py-2">
			<div className="min-w-0 flex-1">
				<Link
					to="/app/orders/$shortId"
					params={{ shortId: row.shortId }}
					className="font-mono text-sm font-semibold text-foreground hover:underline"
				>
					{row.shortId}
				</Link>
				<p className="truncate text-xs text-muted-foreground">
					{detail.filter(Boolean).join(" · ") || "—"}
				</p>
			</div>
			{action === "add" ? (
				<Button asChild size="sm" variant="outline" className="tap-target">
					<Link to="/app/orders/$shortId" params={{ shortId: row.shortId }}>
						Add number
					</Link>
				</Button>
			) : row.trackingUrl ? (
				<Button asChild size="sm" variant="outline" className="tap-target">
					<a href={row.trackingUrl} target="_blank" rel="noopener noreferrer">
						Track <ExternalLink className="size-3" />
					</a>
				</Button>
			) : null}
		</li>
	);
}

// --- Bookings ----------------------------------------------------------------

const FILTERS: Array<{ id: "all" | JobGroup; label: string }> = [
	{ id: "all", label: "All" },
	{ id: "active", label: "Active" },
	{ id: "completed", label: "Completed" },
	{ id: "failed", label: "Failed" },
];

function BookingsCard({ overview }: { overview: DeliveriesOverview }) {
	const { jobs, counts, currency, month } = overview;
	const [filter, setFilter] = useState<"all" | JobGroup>("all");
	const shown =
		filter === "all" ? jobs : jobs.filter((j) => j.group === filter);
	const countFor = (id: "all" | JobGroup) =>
		id === "all" ? jobs.length : jobs.filter((j) => j.group === id).length;
	return (
		<Card>
			<SectionHeading
				title="Courier bookings"
				description="Every rider and courier booked from an order — newest first."
				glance={
					counts.needsAttention > 0 ? (
						<Glance tone="warn">{counts.needsAttention} to rebook</Glance>
					) : counts.active > 0 ? (
						<Glance>{counts.active} on the road</Glance>
					) : (
						<Glance tone="grey">{month.bookings} this month</Glance>
					)
				}
			/>
			{jobs.length === 0 ? (
				<p className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
					No bookings yet — book a rider or courier from any delivery order and
					it shows up here.
				</p>
			) : (
				<>
					<FilterChipRow>
						{FILTERS.map((f) => (
							<FilterChip
								key={f.id}
								selected={filter === f.id}
								count={countFor(f.id)}
								countTone={
									f.id === "failed" && counts.needsAttention > 0
										? "attention"
										: "muted"
								}
								onClick={() => setFilter(f.id)}
							>
								{f.label}
							</FilterChip>
						))}
					</FilterChipRow>
					{shown.length === 0 ? (
						<p className="py-4 text-center text-sm text-muted-foreground">
							No {filter} bookings.
						</p>
					) : (
						<div className="-mx-1 overflow-x-auto">
							<table className="w-full min-w-0 text-sm">
								<thead className="sr-only sm:not-sr-only">
									<tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
										<th className="px-1 pb-2 font-semibold">Order</th>
										<th className="px-1 pb-2 font-semibold">Status</th>
										<th className="hidden px-1 pb-2 font-semibold sm:table-cell">
											Rider / courier
										</th>
										<th className="px-1 pb-2 text-right font-semibold">Cost</th>
										<th className="px-1 pb-2">
											<span className="sr-only">Action</span>
										</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-border">
									{shown.map((job) => (
										<BookingLine
											key={job.jobId}
											job={job}
											currency={currency}
										/>
									))}
								</tbody>
							</table>
						</div>
					)}
				</>
			)}
		</Card>
	);
}

function BookingLine({
	job,
	currency,
}: {
	job: DeliveryJobRow;
	currency: string;
}) {
	const tone = jobStatusTone(job.status);
	const carrier = [job.carrier, job.vehicle?.toLowerCase()]
		.filter(Boolean)
		.join(" · ");
	return (
		<tr className="align-middle">
			<td className="px-1 py-2.5">
				<Link
					to="/app/orders/$shortId"
					params={{ shortId: job.shortId }}
					className="font-mono text-sm font-semibold hover:underline"
				>
					{job.shortId}
				</Link>
				{/* The carrier column folds under the order on a phone. */}
				<p className="truncate text-xs text-muted-foreground sm:hidden">
					{carrier || (job.provider === "delyva" ? "Delyva" : "Lalamove")}
				</p>
			</td>
			<td className="px-1 py-2.5">
				<span
					className={cn(
						"whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
						JOB_TONE_CLASS[tone],
					)}
				>
					{jobStatusLabel(job.status, {
						provider: job.provider,
						collection: job.direction === "collection",
					})}
				</span>
			</td>
			<td className="hidden px-1 py-2.5 text-muted-foreground sm:table-cell">
				{carrier || "—"}
			</td>
			<td className="px-1 py-2.5 text-right tabular-nums">
				{tone === "failed" ? "—" : formatPrice(job.cost, currency)}
			</td>
			<td className="px-1 py-2.5 text-right">
				<BookingAction job={job} />
			</td>
		</tr>
	);
}

/** The one thing this booking's state asks for — never a menu. */
function BookingAction({ job }: { job: DeliveryJobRow }) {
	const toOrder = (label: string, emphasis = false) => (
		<Button
			asChild
			size="sm"
			variant={emphasis ? "default" : "outline"}
			className="tap-target"
		>
			<Link to="/app/orders/$shortId" params={{ shortId: job.shortId }}>
				{label}
			</Link>
		</Button>
	);
	if (job.group === "failed")
		return job.orderSettled ? null : toOrder("Rebook", true);
	if (job.group === "active" && job.shareLink)
		return (
			<Button asChild size="sm" variant="outline" className="tap-target">
				<a href={job.shareLink} target="_blank" rel="noopener noreferrer">
					Track <ExternalLink className="size-3" />
				</a>
			</Button>
		);
	if (job.group === "completed" && job.hasProof) return toOrder("Photo");
	return toOrder("View");
}

// --- Empty --------------------------------------------------------------------

function NothingYet() {
	return (
		<section className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-10 text-center">
			<span className="flex size-11 items-center justify-center rounded-full bg-muted">
				<Truck aria-hidden className="size-5 text-muted-foreground" />
			</span>
			<div className="flex max-w-sm flex-col gap-1">
				<h2 className="font-heading text-base font-bold">No deliveries yet</h2>
				<p className="text-sm text-muted-foreground">
					Parcels you send and riders or couriers you book show up here once
					your store delivers.
				</p>
			</div>
			<Button asChild variant="outline" className="tap-target">
				<Link to="/app/settings" search={{ tab: "fulfilment" }}>
					Set up delivery
				</Link>
			</Button>
		</section>
	);
}
