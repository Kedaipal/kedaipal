import type { Doc } from "../../../convex/_generated/dataModel";
import { MASK_PII } from "../../lib/analytics-privacy";

type OrderAddress = NonNullable<Doc<"orders">["deliveryAddress"]>;

interface DeliveryAddressDisplayProps {
	address: OrderAddress;
}

/**
 * Read-only multi-line render of a delivery address. Used inside both the
 * customer tracking page and the retailer dashboard order detail page.
 */
export function DeliveryAddressDisplay({
	address,
}: DeliveryAddressDisplayProps) {
	return (
		<div {...MASK_PII} className="flex flex-col gap-0.5 text-sm">
			<p className="font-medium">{address.line1}</p>
			{address.line2 ? <p>{address.line2}</p> : null}
			<p>
				{address.postcode} {address.city}
			</p>
			<p>{address.state}</p>
			{address.notes ? (
				<p className="mt-1.5 text-xs text-muted-foreground">
					<span className="font-medium">Notes:</span> {address.notes}
				</p>
			) : null}
		</div>
	);
}

export function formatAddressInline(address: OrderAddress): string {
	const parts = [address.line1];
	if (address.line2) parts.push(address.line2);
	parts.push(`${address.postcode} ${address.city}`);
	parts.push(address.state);
	return parts.join(", ");
}
