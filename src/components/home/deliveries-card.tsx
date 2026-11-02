/**
 * Home → Deliveries (86eye9xd4, 6A): the courier side of today in three rows,
 * then a way into the full page. It reads the SAME `deliveries.overview` the
 * Deliveries page does, so the two never disagree and the page opens from
 * cache.
 *
 * Rows follow how the store ships: a store that books couriers sees what's on
 * the road, what failed and still waits, and the month's bookings; a store
 * that hands parcels over sees what still needs a consignment number and
 * what's in transit. A store that does both sees both, urgent rows first.
 * Renders nothing for a store with no deliveries at all — Home doesn't carry
 * empty cards. Courier WALLETS are not here: they sit in Home's Balances card
 * beside the Kedaipal credits (z8r3fdx34j), the one place Home answers "can I
 * take and ship today's orders?".
 */

import { Link } from "@tanstack/react-router";
import { ChevronRight, Truck } from "lucide-react";
import type { DeliveriesOverview } from "../../../convex/deliveries";
import { formatPrice } from "../../lib/format";
import { cn } from "../../lib/utils";

type Row = { label: string; value: string; tone?: "warn" };

export function deliveriesHomeRows(o: DeliveriesOverview): Row[] {
	const rows: Row[] = [];
	const plural = (n: number, one: string, many: string) =>
		`${n} ${n === 1 ? one : many}`;
	if (o.counts.needsAttention > 0)
		rows.push({
			label: "Needs attention",
			value: `${o.counts.needsAttention} to rebook`,
			tone: "warn",
		});
	if (o.shipsParcels && o.counts.toShip > 0)
		rows.push({
			label: "To ship",
			value: plural(o.counts.toShip, "parcel", "parcels"),
			tone: "warn",
		});
	if (o.booksCouriers && o.counts.active > 0)
		rows.push({
			label: "On the road",
			value: plural(o.counts.active, "booking", "bookings"),
		});
	if (o.shipsParcels && o.counts.inTransit > 0)
		rows.push({
			label: "In transit",
			value: plural(o.counts.inTransit, "parcel", "parcels"),
		});
	if (o.booksCouriers && o.month.bookings > 0)
		rows.push({
			label: "This month",
			value: `${plural(o.month.bookings, "booking", "bookings")} · ${formatPrice(o.month.cost, o.currency)}`,
		});
	return rows;
}

export function DeliveriesHomeCard({
	overview,
}: {
	overview: DeliveriesOverview;
}) {
	const rows = deliveriesHomeRows(overview);
	if (rows.length === 0) return null;
	return (
		<article className="flex flex-col gap-3 rounded-[20px] border border-border bg-card p-4 shadow-[0_1px_2px_rgb(15_23_41/0.04)]">
			<div className="flex items-center gap-2">
				<span className="flex size-[26px] shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent-emphasis">
					<Truck className="size-3.5" aria-hidden="true" />
				</span>
				<h2 className="font-heading text-[17px] font-extrabold tracking-tight">
					Deliveries
				</h2>
			</div>
			{rows.length > 0 ? (
				<dl className="flex flex-col divide-y divide-border">
					{rows.map((row) => (
						<div
							key={row.label}
							className="flex min-h-11 items-center justify-between gap-3 py-1.5"
						>
							<dt className="text-sm text-muted-foreground">{row.label}</dt>
							<dd
								className={cn(
									"text-sm font-semibold tabular-nums",
									row.tone === "warn"
										? "text-amber-700 dark:text-amber-300"
										: "text-foreground",
								)}
							>
								{row.value}
							</dd>
						</div>
					))}
				</dl>
			) : (
				<p className="text-sm text-muted-foreground">Nothing out right now.</p>
			)}
			<Link
				to="/app/deliveries"
				className="-mb-1 flex min-h-11 items-center justify-between rounded-xl text-sm font-semibold text-accent-emphasis hover:underline"
			>
				View all deliveries
				<ChevronRight className="size-4" aria-hidden="true" />
			</Link>
		</article>
	);
}
