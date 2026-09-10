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

import type { ReactNode } from "react";
import type { Doc } from "../../../convex/_generated/dataModel";
import type { Country } from "../../../convex/lib/country";
import type {
	DeliveryBookingSummary,
	HitpaySummary,
} from "../../../convex/retailers";
import type { useUpdateSettings } from "../../hooks/useUpdateSettings";
import {
	type CardTarget,
	type FixHighlight,
	highlightRingClass,
} from "../../lib/country-setup-copy";
import { SPOTLIGHT_ANCHOR } from "../../lib/spotlight";
import { hasFeature, type SubscriptionView } from "../../lib/subscription";
import { DelyvaCard } from "./delyva-card";
import { LalamoveIntegrationCard } from "./lalamove-integration-card";
import { OnlinePaymentsCard } from "./online-payments-card";

/**
 * One account card per provider. Each is a `section` with a stable `id` so a
 * deep link can land on the exact card and ring it (the post-switch checklist
 * on HitPay, a What's-new note on any of the three — src/lib/spotlight.ts).
 */
function AccountCard({
	id,
	highlight,
	children,
}: {
	id: string;
	highlight: FixHighlight | undefined;
	children: ReactNode;
}) {
	return (
		<section
			id={id}
			data-fix-highlight={highlight ?? undefined}
			className={`flex flex-col gap-4 rounded-2xl border bg-background p-5 scroll-mt-24 lg:p-6 ${highlightRingClass(highlight)}`}
		>
			{children}
		</section>
	);
}

export function IntegrationsTab({
	target,
	retailerId,
	country,
	deliveryBooking,
	hitpay,
	subscription,
	onSave,
}: {
	/** Deep-link target — which card to ring, and how (see FulfilmentTab). */
	target?: CardTarget;
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
	const ring = (anchor: string): FixHighlight | undefined =>
		target?.anchor === anchor ? target.highlight : undefined;
	return (
		<div className="flex flex-col gap-6 pt-2">
			<p className="px-1 text-xs text-muted-foreground">
				Your own accounts with the services Kedaipal can drive. Connecting one
				doesn&apos;t switch anything on by itself — delivery and booking
				behaviour is chosen under Fulfilment, online payments under Payments.
			</p>

			<AccountCard
				id={SPOTLIGHT_ANCHOR.lalamove.anchor}
				highlight={ring(SPOTLIGHT_ANCHOR.lalamove.anchor)}
			>
				<LalamoveIntegrationCard
					deliveryBooking={deliveryBooking}
					onSave={onSave}
				/>
			</AccountCard>

			<AccountCard
				id={SPOTLIGHT_ANCHOR.delyva.anchor}
				highlight={ring(SPOTLIGHT_ANCHOR.delyva.anchor)}
			>
				<DelyvaCard
					retailerId={retailerId}
					canUse={hasFeature(subscription, "delivery")}
					country={country}
				/>
			</AccountCard>

			{/* The id doubles as the post-switch checklist's `hitpay` anchor
			    (SETTINGS_ANCHOR.hitpay) — one string, asserted equal by test. */}
			<AccountCard
				id={SPOTLIGHT_ANCHOR.hitpay.anchor}
				highlight={ring(SPOTLIGHT_ANCHOR.hitpay.anchor)}
			>
				<OnlinePaymentsCard
					hitpay={hitpay}
					canUse={hasFeature(subscription, "onlinePayments")}
					country={country}
					onSave={onSave}
				/>
			</AccountCard>
		</div>
	);
}
