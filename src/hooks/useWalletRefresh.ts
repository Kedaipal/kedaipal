/**
 * "Ask this courier for its balance now" — the one action behind the wallet
 * row's Refresh, the top-up sheet's "I've topped up — check again" and the
 * re-read when the seller comes back from topping up. Only the pull-model
 * couriers can be asked: EasyParcel (`GET /wallet`) and Delyva (its customer
 * profile, since 31 Oct 2026). Both answer in the same shape.
 */

import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { CourierProviderId } from "../../convex/lib/courierProviders";

export function useWalletRefresh(provider: CourierProviderId) {
	const easyparcel = useAction(api.easyparcel.refreshBalance);
	const delyva = useAction(api.delyva.refreshBalance);
	return provider === "delyva" ? delyva : easyparcel;
}
