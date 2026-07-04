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
}

/**
 * The badge diet: an order row carries the status badge plus AT MOST ONE
 * contextual badge, so names and money keep the visual hierarchy. Priority:
 *
 * 1. Mockup pending — blocks production, the seller must act.
 * 2. Fulfilment date — when the order is due (urgency-coloured).
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
	if (order.fulfilmentDate !== undefined) {
		return <FulfilmentDateBadge epoch={order.fulfilmentDate} now={now} />;
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
