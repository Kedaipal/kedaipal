import { Package, Truck } from "lucide-react";
import {
	type OrderStatus,
	statusAgeMs,
	statusAgeSeverity,
} from "../../../convex/lib/orderBuckets";
import { FulfilmentDateBadge } from "./fulfilment-date-badge";
import { OrderTimeBadge } from "./order-time-badge";

interface BadgeOrder {
	status: string;
	statusChangedAt?: number;
	updatedAt?: number;
	createdAt: number;
	fulfilmentDate?: number;
	mockupStatus?: string;
	/** Checkout surface — counter orders get a defaulted date, so no date badge. */
	source?: string;
}

/** A terminal order is finished — its due date can no longer be "late". */
function isTerminalStatus(status: string): boolean {
	return status === "delivered" || status === "cancelled";
}

/**
 * The badge diet: an order row carries the status badge plus AT MOST ONE
 * contextual badge, so names and money keep the visual hierarchy. Priority:
 *
 * 1. Mockup pending — blocks production, the seller must act.
 * 2. Fulfilment date — when the order is due (urgency-coloured, but neutral once
 *    the order is terminal; hidden entirely for counter orders, whose date is
 *    defaulted-to-today, not buyer-chosen — see ClickUp 86ey8r734).
 * 3. Time-in-status — only when it has escalated (amber/red); a quiet age
 *    belongs in the card's meta line, not a badge.
 */
export function OrderContextBadge({
	order,
	now,
}: {
	order: BadgeOrder;
	now: number;
}) {
	if (
		order.mockupStatus === "pending" ||
		order.mockupStatus === "changes_requested"
	) {
		return (
			<span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
				Mockup pending
			</span>
		);
	}
	// Counter orders carry a date only because checkout defaults it to today — it's
	// not a promised-by date, so it would only add noise (and false "Overdue").
	if (order.fulfilmentDate !== undefined && order.source !== "counter") {
		return (
			<FulfilmentDateBadge
				epoch={order.fulfilmentDate}
				now={now}
				muted={isTerminalStatus(order.status)}
			/>
		);
	}
	const severity = statusAgeSeverity(
		order.status as OrderStatus,
		statusAgeMs(order, now),
	);
	if (severity !== "normal") {
		return <OrderTimeBadge order={order} now={now} />;
	}
	return null;
}

/**
 * How the buyer receives the order, as a quiet icon (not a labelled badge) —
 * sellers only need to spot pickups at a glance. Sits on the card's right edge.
 */
export function DeliveryMethodIcon({
	method,
}: {
	method: "delivery" | "self_collect";
}) {
	const isPickup = method === "self_collect";
	const Icon = isPickup ? Package : Truck;
	const label = isPickup ? "Self-collect" : "Delivery";
	return (
		<span title={label} className="text-muted-foreground/70">
			<Icon className="size-4" aria-hidden="true" />
			<span className="sr-only">{label}</span>
		</span>
	);
}
