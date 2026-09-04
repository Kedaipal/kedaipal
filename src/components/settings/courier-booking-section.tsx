/**
 * Courier booking — Settings → Fulfilment → Delivery (86eyjpv6z IA rework,
 * 2 Sep, Zaki). Which booking tools this store has ARMED — not which one it
 * must use: a seller may run Lalamove riders AND Delyva couriers side by
 * side and pick per order at dispatch (the one-active-job-per-order
 * reservation arbitrates a single order; the buyer's fee was already
 * collected at checkout, so which tool sends the parcel afterwards is purely
 * the seller's margin call — and the dispatch card shows "buyer paid X"
 * beside every price).
 *
 * So this section is TOGGLES, not a radio: independent switches per
 * provider, each disabled-with-reason + a link to Settings → Integrations
 * when its account isn't connected yet. Arranging your own courier is the
 * ever-present baseline, not an option to pick.
 *
 * The one coupling that remains: Lalamove live-quote PRICING implies rider
 * booking (the checkout quote runs on those credentials), so under that
 * charge mode the rider toggle shows locked-on with the reason.
 */

import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { DeliveryBookingSummary } from "../../../convex/retailers";
import { useActAsRetailerId } from "../../hooks/useActAs";
import { useUpdateSettings } from "../../hooks/useUpdateSettings";
import { convexErrorMessage } from "../../lib/format";
import { ProBadge } from "../app/pro-gate";
import { AppImage } from "../ui/app-image";
import { ToggleSwitch } from "../ui/toggle-switch";

export function CourierBookingSection({
	deliveryBooking,
	chargeMode,
	canUse,
	riderBookingAvailable,
}: {
	deliveryBooking: DeliveryBookingSummary | undefined;
	/** Active delivery-charge mode — "lalamove" locks the rider toggle ON. */
	chargeMode?: string;
	/** Client mirror of PLAN_FEATURES.delivery (server is the lock). */
	canUse: boolean;
	/** Country allows Lalamove riders at all (MY-only) — SG stores see just
	 * the Delyva row rather than a dead toggle. */
	riderBookingAvailable: boolean;
}) {
	const actAsRetailerId = useActAsRetailerId();
	const updateSettings = useUpdateSettings();
	const updateDelyva = useMutation(api.delyva.updateSettings);
	const delyva = useQuery(
		convexQuery(api.delyva.getSettings, { retailerId: actAsRetailerId }),
	).data;

	const [busy, setBusy] = useState(false);

	const lalamoveConnected = deliveryBooking?.hasCredentials === true;
	const lalamovePricing = chargeMode === "lalamove";
	const delyvaConnected = delyva?.connected === true;
	const delyvaCountryOk = delyva ? delyva.countryAllowed : true;

	async function run(fn: () => Promise<unknown>, message: string) {
		setBusy(true);
		try {
			await fn();
			toast.success(message);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-0.5">
				<span className="flex items-center gap-2 text-sm font-medium">
					Courier booking
					{!canUse ? <ProBadge /> : null}
				</span>
				<p className="text-xs text-muted-foreground">
					Book riders or couriers straight from an order. Separate from the
					delivery charge above — that decides what your buyer pays. Turn on
					every service you use; you pick per order when booking.
				</p>
			</div>

			{riderBookingAvailable ? (
				<div className="flex items-start justify-between gap-4 rounded-xl border border-input p-3">
					<div className="min-w-0">
						<p className="flex items-center gap-2 text-sm font-medium">
							<AppImage
								src="/img/lalamove-logo.svg"
								alt=""
								aspect="h-3.5 w-auto"
								fill={false}
								className="shrink-0"
							/>
							Lalamove riders
						</p>
						<p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
							{lalamovePricing
								? "On — your delivery charge runs on Lalamove live quotes, so rider booking comes with it. Switch the charge mode above to change this."
								: lalamoveConnected
									? "Same-day riders across your city. Book from any confirmed delivery order."
									: null}
							{!lalamovePricing && !lalamoveConnected ? (
								<>
									Same-day riders across your city.{" "}
									<Link
										to="/app/settings"
										search={{ tab: "integrations" }}
										className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
									>
										Connect Lalamove in Integrations{" "}
										<ExternalLink className="size-3" />
									</Link>{" "}
									to turn this on.
								</>
							) : null}
						</p>
					</div>
					<ToggleSwitch
						on={lalamovePricing || deliveryBooking?.enabled === true}
						disabled={
							busy ||
							lalamovePricing ||
							!lalamoveConnected ||
							(!canUse && deliveryBooking?.enabled !== true)
						}
						label="Lalamove rider booking"
						onChange={(next) =>
							void run(
								() =>
									updateSettings({
										deliveryBooking: {
											enabled: next,
											vehicleType: deliveryBooking?.vehicleType ?? "MOTORCYCLE",
										},
									}),
								next
									? "Lalamove rider booking on"
									: "Lalamove rider booking off",
							)
						}
					/>
				</div>
			) : null}

			{delyvaCountryOk ? (
				<div className="flex items-start justify-between gap-4 rounded-xl border border-input p-3">
					<div className="min-w-0">
						<p className="flex items-center gap-2 text-sm font-medium">
							<AppImage
								src="/img/delyva-logo.png"
								alt=""
								aspect="h-3.5 w-auto"
								fill={false}
								className="shrink-0"
							/>
							Delyva couriers
							{delyva?.isDemo ? (
								<span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
									Demo
								</span>
							) : null}
						</p>
						<p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
							{delyvaConnected ? (
								<>
									Nationwide + cold-chain parcels (J&amp;T, DHL, Ninja…). Pick
									the courier and price per order.{" "}
									<Link
										to="/app/settings"
										search={{ tab: "integrations" }}
										className="font-medium text-accent hover:underline"
									>
										Manage account
									</Link>
								</>
							) : (
								<>
									Nationwide + cold-chain parcels (J&amp;T, DHL, Ninja…).{" "}
									<Link
										to="/app/settings"
										search={{ tab: "integrations" }}
										className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
									>
										Connect Delyva in Integrations{" "}
										<ExternalLink className="size-3" />
									</Link>{" "}
									to turn this on.
								</>
							)}
						</p>
					</div>
					<ToggleSwitch
						on={delyva?.enabled === true}
						disabled={
							busy ||
							!delyvaConnected ||
							(!canUse && delyva?.enabled !== true)
						}
						label="Delyva courier booking"
						onChange={(next) =>
							void run(
								() =>
									updateDelyva({
										retailerId: actAsRetailerId,
										enabled: next,
									}),
								next ? "Delyva booking on" : "Delyva booking off",
							)
						}
					/>
				</div>
			) : null}

			{/* The baseline is not an option — it can't be turned off. Saying so
			    is what stops "which one do I pick?" confusion for the seller who
			    books nothing through Kedaipal. */}
			<p className="text-xs text-muted-foreground">
				Arranging your own courier always works too — mark the order shipped
				and add the tracking number there.
			</p>
		</div>
	);
}
