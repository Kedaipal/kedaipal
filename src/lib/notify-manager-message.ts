// The ready-to-forward message a seller sends whoever runs a pickup point
// (86ey30yhr), lifted out of the order page so it can be tested — it is pure,
// and inside a ~2,800-line route it could not be.
//
// z8r3fdff97 added the WHEN. A manager told "new pickup order, prepare for
// collection" with no day or time had to ask; now the second line says
// "Collect on: Thu, 18 Sep 2026 · 11:30 AM" (or "Meet on" at a drop-off
// point), omitted only for an order with no date.

import { formatFulfilmentDateTime } from "../../convex/lib/fulfilmentDate";
import type { PickupSnapshot } from "../../convex/lib/whatsappCopy";
import { formatPhone } from "./customer";
import { formatPrice } from "./format";

export function buildNotifyManagerMessage({
	shortId,
	location,
	customerName,
	customerWaPhone,
	items,
	total,
	currency,
	fulfilmentDate,
	fulfilmentTimeMinutes,
}: {
	shortId: string;
	location: PickupSnapshot;
	customerName: string | undefined;
	customerWaPhone: string | undefined;
	items: ReadonlyArray<{
		name: string;
		quantity: number;
		price: number;
		variantLabel?: string;
	}>;
	total: number;
	currency: string;
	fulfilmentDate?: number;
	fulfilmentTimeMinutes?: number;
}): string {
	const lines: string[] = [];
	lines.push(`📦 New pickup order ${shortId} — ${location.label}`);
	if (fulfilmentDate !== undefined) {
		const verb =
			location.locationType === "drop_off" ? "Meet on" : "Collect on";
		lines.push(
			`${verb}: ${formatFulfilmentDateTime(fulfilmentDate, fulfilmentTimeMinutes)}`,
		);
	}
	const customerLine = customerName
		? customerWaPhone
			? `Customer: ${customerName} (${formatPhone(customerWaPhone)})`
			: `Customer: ${customerName}`
		: customerWaPhone
			? `Customer: ${formatPhone(customerWaPhone)}`
			: "Customer: Anonymous";
	lines.push(customerLine);
	lines.push("");
	lines.push("Items:");
	for (const item of items) {
		const name = item.variantLabel
			? `${item.name} (${item.variantLabel})`
			: item.name;
		lines.push(
			`• ${item.quantity}× ${name} (${formatPrice(item.price * item.quantity, currency)})`,
		);
	}
	lines.push("");
	lines.push(`Total: ${formatPrice(total, currency)}`);
	lines.push("");
	lines.push("Please prepare for collection.");
	return lines.join("\n");
}
