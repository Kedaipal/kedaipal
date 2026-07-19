import { formatFulfilmentDate } from "../../convex/lib/fulfilmentDate";
import { deriveMapsUrl } from "../../convex/lib/mapsUrl";
import { formatPrice } from "./format";

/**
 * Builds the buyer→seller WhatsApp order message from an order's frozen
 * snapshot (items, address/pickup, note, date — all immutable after create),
 * so the tracking page can rebuild the exact handoff message on any render.
 *
 * This lives on the tracking page — NOT in the checkout sheet — because the
 * checkout submit can't open WhatsApp itself: `window.open` after the awaited
 * `orders.create` round-trip falls outside the tap's transient user
 * activation, so popup blockers (iOS Safari, IG/FB in-app webviews) silently
 * eat it. Checkout instead same-tab-navigates to `/track/<token>`, where the
 * buyer taps a plain anchor — a fresh gesture browsers always allow.
 */
export interface WaOrderMessageInput {
	shortId: string;
	storeName: string;
	items: ReadonlyArray<{
		name: string;
		variantLabel?: string;
		price: number;
		quantity: number;
	}>;
	currency: string;
	total: number;
	pickupFee?: number;
	deliveryMethod?: "delivery" | "self_collect";
	deliveryAddress?: {
		line1: string;
		line2?: string;
		city: string;
		state: string;
		postcode: string;
		notes?: string;
		mapsUrl?: string;
		latitude?: number;
		longitude?: number;
		placeId?: string;
	};
	pickupSnapshot?: {
		label: string;
		address: string;
		locationType?: "self_collect" | "drop_off";
		scheduleNote?: string;
		notes?: string;
		mapsUrl?: string;
		latitude?: number;
		longitude?: number;
		placeId?: string;
	};
	fulfilmentDate?: number;
	customerNote?: string;
	/** True while a made-to-order line's price is still an open quote (order
	 * has a mockup gate that hasn't been approved/waived). Price-0 lines then
	 * read "price on quote" instead of a confusing bare RM0. */
	quotePending?: boolean;
}

function formatAddressOneLine(
	addr: NonNullable<WaOrderMessageInput["deliveryAddress"]>,
): string {
	const parts = [addr.line1];
	if (addr.line2) parts.push(addr.line2);
	parts.push(`${addr.postcode} ${addr.city}`);
	parts.push(addr.state);
	return parts.join(", ");
}

export function buildOrderWaMessage(order: WaOrderMessageInput): string {
	const lines: string[] = [];
	lines.push(`Hi ${order.storeName}, I'd like to place this order:`);
	lines.push("");
	lines.push(`Order: ${order.shortId}`);
	let hasQuoteItem = false;
	for (const item of order.items) {
		const name = item.variantLabel
			? `${item.name} (${item.variantLabel})`
			: item.name;
		const isQuoteLine = Boolean(order.quotePending) && item.price === 0;
		if (isQuoteLine) hasQuoteItem = true;
		lines.push(
			`• ${item.quantity}x ${name}${isQuoteLine ? " — price on quote" : ""}`,
		);
	}
	lines.push("");
	// `total` is the server-computed order total (subtotal + pickup fee), so the
	// message always matches what the tracking page and receipt show.
	if (order.pickupFee && order.pickupFee > 0)
		lines.push(`Pickup fee: ${formatPrice(order.pickupFee, order.currency)}`);
	lines.push(`Total: ${formatPrice(order.total, order.currency)}`);
	if (hasQuoteItem) lines.push("(Custom item price to be confirmed by seller)");
	const method = order.deliveryMethod ?? "delivery";
	if (method === "self_collect") {
		const snap = order.pickupSnapshot;
		if (snap) {
			const verb =
				snap.locationType === "drop_off" ? "Drop-off at" : "Self Collect at";
			lines.push(`📍 ${verb}: ${snap.label}`);
			lines.push(snap.address);
			if (snap.scheduleNote) lines.push(`🗓️ ${snap.scheduleNote}`);
			const mapsUrl = deriveMapsUrl(snap);
			if (mapsUrl) lines.push(mapsUrl);
			if (snap.notes) lines.push(snap.notes);
		} else {
			lines.push("📍 Pickup");
		}
	} else if (order.deliveryAddress) {
		lines.push(`🚚 Deliver to: ${formatAddressOneLine(order.deliveryAddress)}`);
		const mapsUrl = deriveMapsUrl(order.deliveryAddress);
		if (mapsUrl) lines.push(`📍 ${mapsUrl}`);
		if (order.deliveryAddress.notes)
			lines.push(`📝 ${order.deliveryAddress.notes}`);
	} else {
		lines.push("🚚 Delivery");
	}
	if (order.fulfilmentDate !== undefined) {
		const verb = method === "self_collect" ? "Collect" : "Deliver";
		lines.push(`🗓️ ${verb} on: ${formatFulfilmentDate(order.fulfilmentDate)}`);
	}
	// Order note last, in a clearly delimited section. It sits AFTER the
	// "Order: ORD-XXXX" line, so even if the note text contains something that
	// looks like an order token, the inbound parser still matches the real ID
	// (first match) — see SHORT_ID_REGEX in whatsappCopy.
	if (order.customerNote) {
		lines.push("");
		lines.push("📝 Note for seller:");
		lines.push(order.customerNote);
	}
	return lines.join("\n");
}

/** wa.me deep link to the shared checkout number with the message prefilled. */
export function waOrderUrl(checkoutPhone: string, message: string): string {
	return `https://wa.me/${checkoutPhone}?text=${encodeURIComponent(message)}`;
}
