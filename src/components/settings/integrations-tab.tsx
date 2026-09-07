/**
 * Integrations — Settings tab (86eyjpv6z IA rework, 2 Sep, Zaki). One home
 * for every third-party ACCOUNT the store connects: API keys, connection
 * health, and each service's own operational details. What those connections
 * are USED for lives where the behaviour lives — delivery pricing and
 * courier-booking toggles under Fulfilment, the buyer's Pay-now under
 * Payments — and each of those surfaces links here when its account isn't
 * wired up yet.
 *
 * The split exists because the two questions have different rhythms: keys
 * are pasted once and rotated rarely (and deserve the guides, the env badges
 * and the webhook rows around them), while the behavioural switches are
 * day-to-day. Mixing them made the Fulfilment tab carry credential forms
 * inside a pricing section — the thing this rework undid.
 */

import type { Doc } from "../../../convex/_generated/dataModel";
import type { Country } from "../../../convex/lib/country";
import type {
	DeliveryBookingSummary,
	HitpaySummary,
} from "../../../convex/retailers";
import type { useUpdateSettings } from "../../hooks/useUpdateSettings";
import { hasFeature, type SubscriptionView } from "../../lib/subscription";
import { DelyvaCard } from "./delyva-card";
import { LalamoveIntegrationCard } from "./lalamove-integration-card";
import { OnlinePaymentsCard } from "./online-payments-card";

export function IntegrationsTab({
	retailerId,
	country,
	deliveryBooking,
	hitpay,
	subscription,
	onSave,
}: {
	retailerId: Doc<"retailers">["_id"];
	country: Country;
	deliveryBooking: DeliveryBookingSummary | undefined;
	hitpay: HitpaySummary | undefined;
	subscription: SubscriptionView | undefined;
	/** The act-as-aware settings mutation, threaded from the route (the
	 * presentational cards patch through it; the Delyva card owns its own
	 * Convex namespace and act-as internally). */
	onSave: ReturnType<typeof useUpdateSettings>;
}) {
	return (
		<div className="flex flex-col gap-6 pt-2">
			<p className="px-1 text-xs text-muted-foreground">
				Your own accounts with the services Kedaipal can drive. Connecting one
				doesn&apos;t switch anything on by itself — delivery and booking
				behaviour is chosen under Fulfilment, online payments under Payments.
			</p>

			<section className="flex flex-col gap-4 rounded-2xl border bg-background p-5 scroll-mt-24 lg:p-6">
				<LalamoveIntegrationCard
					deliveryBooking={deliveryBooking}
					onSave={onSave}
				/>
			</section>

			<section className="flex flex-col gap-4 rounded-2xl border bg-background p-5 scroll-mt-24 lg:p-6">
				<DelyvaCard
					retailerId={retailerId}
					canUse={hasFeature(subscription, "delivery")}
					country={country}
				/>
			</section>

			<section
				id="settings-hitpay"
				className="flex flex-col gap-4 rounded-2xl border bg-background p-5 scroll-mt-24 lg:p-6"
			>
				<OnlinePaymentsCard
					hitpay={hitpay}
					canUse={hasFeature(subscription, "onlinePayments")}
					country={country}
					onSave={onSave}
				/>
			</section>
		</div>
	);
}
