import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { consumeOrderConfirmedToastSuppression } from "../lib/orderToastSuppression";

interface ActionableCounts {
	pending: number;
	confirmed: number;
}

export function useOrderToastNotifications(
	counts: ActionableCounts | undefined,
): void {
	const prevRef = useRef<ActionableCounts | null>(null);
	const initializedRef = useRef(false);

	useEffect(() => {
		if (counts === undefined) return;

		// Skip the first load — don't toast for orders that already exist.
		if (!initializedRef.current) {
			initializedRef.current = true;
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
	}, [counts]);
}
