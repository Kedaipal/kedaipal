/**
 * "Courier wallets" — every connected courier account's wallet, one
 * `CourierWalletRow` each (Arif's artboard 2). The Deliveries page carries it
 * at the top, ALWAYS while a courier is connected (a healthy wallet is still
 * the answer to "can I book today?"); Home's Balances card carries the same
 * rows as a glance. Renders nothing when no courier is connected — that store
 * has no wallet to talk about.
 */

import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Country } from "../../../convex/lib/country";
import type { CourierProviderId } from "../../../convex/lib/courierProviders";
import { useMinuteClock } from "../../hooks/useMinuteClock";
import type { CourierWalletView } from "../../lib/courier-wallets";
import {
	Card,
	SectionHeading,
	SectionLabel,
} from "../settings/settings-primitives";
import { CourierWalletRow } from "./courier-wallet-row";

/** One line that says whose money this is — on every wallets surface. */
export const COURIER_WALLETS_HELPER =
	"You pay each courier from your own account with them. Kedaipal never holds this money.";

/** The rows alone, for a card that already has its own frame (Home). */
export function CourierWalletList({
	wallets,
	retailerId,
	country,
	editable,
}: {
	wallets: CourierWalletView[];
	retailerId: Id<"retailers">;
	country: Country;
	editable: boolean;
}) {
	const now = useMinuteClock();
	return (
		<ul className="flex flex-col divide-y divide-dashed divide-border">
			{wallets.map((view) => (
				<CourierWalletRow
					key={view.provider}
					view={view}
					retailerId={retailerId}
					country={country}
					now={now}
					editable={editable}
				/>
			))}
		</ul>
	);
}

export function CourierWalletsSection({
	wallets,
	retailerId,
	country,
}: {
	/** Absent when the page is newer than the server it reads (a deploy in
	 * flight, or another branch on the shared dev deployment): the page draws
	 * without the section rather than crashing (test-code, 30 Oct 2026). */
	wallets: CourierWalletView[] | undefined;
	retailerId: Id<"retailers">;
	country: Country;
}) {
	if (!wallets || wallets.length === 0) return null;
	return (
		<Card>
			<SectionHeading
				title="Courier wallets"
				description={COURIER_WALLETS_HELPER}
			/>
			<CourierWalletList
				wallets={wallets}
				retailerId={retailerId}
				country={country}
				editable
			/>
		</Card>
	);
}

/**
 * One courier's wallet inside its Settings → Integrations card — the
 * account's home, so Top up shows even on a healthy wallet. Reads the same
 * `courierWallets.list` every surface does. Renders nothing until the account
 * is connected (the list only carries connected accounts).
 */
export function IntegrationWalletBlock({
	retailerId,
	country,
	provider,
}: {
	retailerId: Id<"retailers">;
	country: Country;
	provider: CourierProviderId;
}) {
	const wallets = useQuery(
		convexQuery(api.courierWallets.list, { retailerId }),
	).data;
	const view = wallets?.find((w) => w.provider === provider);
	if (!view) return null;
	return (
		<div className="flex flex-col gap-2">
			<SectionLabel>Wallet</SectionLabel>
			<div className="rounded-xl border border-input bg-muted/30 px-3 py-3">
				<CourierWalletList
					wallets={[view]}
					retailerId={retailerId}
					country={country}
					editable
				/>
			</div>
		</div>
	);
}
