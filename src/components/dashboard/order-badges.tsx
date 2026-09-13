import {
	CalendarRange, Package, Truck } from "lucide-react";
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
	/** Seen-state: a confirmation-push order the seller hasn't opened escalates
	 * on age exactly as a `pending` order used to (86eyf1rck). */
	seenAt?: number;
	confirmationPushStatus?: string;
	/** Collection service (86eyg0n8e) — see isCollectedCollection below. */
	deliveryDirection?: string;
	collectedAt?: number;
}

/** A terminal order is finished — its due date can no longer be "late". */
function isTerminalStatus(status: string): boolean {
	return status === "delivered" || status === "cancelled";
}

/**
 * A COLLECTION order's fulfilment date is the day the rider collects FROM the
 * buyer — the START of the seller's work, not a deadline to finish it. Once
 * the goods are in (`collectedAt`, stamped by the rider webhook) that date is
 * history, so the urgency colouring must stop.
 *
 * Without this, every in-flight collection order goes permanently red: the
 * date passes on day one and the only other mute is `delivered`, which a
 * collection order never reaches on its own (the webhook deliberately doesn't
 * advance it — 86eyg0n8e). A three-week tent clean would show "Overdue" for
 * three weeks, and because this badge is a strict priority list it would also
 * suppress every other contextual badge underneath — exactly the alarm
 * fatigue the badge diet exists to prevent.
 *
 * Deliberately keyed on the goods arriving, not on the order status: a seller
 * may anchor their own "Collected" stage at `confirmed`, so status proves
 * nothing. Before collection a passed date still reads red — that genuinely
 * means "the collection day came and went and nothing has arrived".
 */
function isCollectedCollection(order: BadgeOrder): boolean {
	return (
		order.deliveryDirection === "collection" && order.collectedAt !== undefined
	);
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
				muted={isTerminalStatus(order.status) || isCollectedCollection(order)}
			/>
		);
	}
	const severity = statusAgeSeverity(
		{
			status: order.status as OrderStatus,
			seenAt: order.seenAt,
			confirmationPushStatus: order.confirmationPushStatus,
		},
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
	method: "delivery" | "self_collect" | "booking";
}) {
	const Icon =
		method === "self_collect"
			? Package
			: method === "booking"
				? CalendarRange
				: Truck;
	const label =
		method === "self_collect"
			? "Self-collect"
			: method === "booking"
				? "Booking"
				: "Delivery";
	return (
		<span title={label} className="text-muted-foreground/70">
			<Icon className="size-4" aria-hidden="true" />
			<span className="sr-only">{label}</span>
		</span>
	);
}
