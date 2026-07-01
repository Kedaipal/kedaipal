import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { consumeOrderConfirmedToastSuppression } from "../lib/orderToastSuppression";

interface ActionableCounts {
	pending: number;
	confirmed: number;
}

export function useOrderToastNotifications(
	counts: ActionableCounts | undefined,
	// The store the counts belong to (retailer id). When it changes — e.g. an admin
	// entering/leaving act-as — the counts jump to a DIFFERENT store's numbers, which
	// must not be mistaken for newly placed/confirmed orders. We re-baseline silently.
	storeKey?: string,
): void {
	const prevRef = useRef<ActionableCounts | null>(null);
	const storeKeyRef = useRef<string | undefined>(undefined);
	const initializedRef = useRef(false);

	useEffect(() => {
		if (counts === undefined) return;

		// Skip the first load, and re-baseline (no toast) whenever the operated store
		// changes — a different store's existing orders aren't "new".
		if (!initializedRef.current || storeKeyRef.current !== storeKey) {
			initializedRef.current = true;
			storeKeyRef.current = storeKey;
			prevRef.current = { ...counts };
			return;
		}

		const prev = prevRef.current;
		if (!prev) {
			prevRef.current = { ...counts };
			return;
		}

		const newPending = counts.pending - prev.pending;
		const newConfirmed = counts.confirmed - prev.confirmed;

		if (newPending > 0) {
			toast.info(
				newPending === 1
					? "New order placed"
					: `${newPending} new orders placed`,
				{ description: "Check your Orders tab" },
			);
		}

		if (newConfirmed > 0 && !consumeOrderConfirmedToastSuppression()) {
			toast.success(
				newConfirmed === 1
					? "Order confirmed"
					: `${newConfirmed} orders confirmed`,
				{ description: "Ready for next steps" },
			);
		}

		prevRef.current = { ...counts };
	}, [counts, storeKey]);
}
