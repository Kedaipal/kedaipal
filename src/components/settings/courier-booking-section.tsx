/**
 * Courier booking — on the Delivery pricing page (86eye9xd4, 3A: it rides
 * along with pricing), reached from Settings → Fulfilment → Delivery's
 * "Courier booking" row (86eyjpv6z IA rework, 2 Sep, Zaki). Which booking tools this store has ARMED — not which one it
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
import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { DeliveryBookingSummary } from "../../../convex/retailers";
import { useActAsRetailerId } from "../../hooks/useActAs";
import { useUpdateSettings } from "../../hooks/useUpdateSettings";
import { convexErrorMessage } from "../../lib/format";
import {
	type EasyparcelVisibility,
	easyparcelCardShown,
} from "../../lib/integrations-glance";
import { TONE_CHIP } from "../../lib/tone";
import { ProBadge } from "../app/pro-gate";
import { AppImage } from "../ui/app-image";
import { DelyvaLogo } from "../ui/delyva-logo";
import { EasyparcelLogo } from "../ui/easyparcel-logo";
import { ToggleSwitch } from "../ui/toggle-switch";

/** The card's id on the Delivery pricing page — the Fulfilment row and the
 * order page's "turn it on" hints land here (`#courier-booking`). */
export const COURIER_BOOKING_ANCHOR = "courier-booking";

/**
 * EasyParcel books only when the seller's switch is on AND the connection is
 * live (not signed out at EasyParcel's end) AND it serves this store — the
 * client mirror of `easyparcelBookingArmed`, so the row and the switch's copy
 * never claim booking that the order page won't offer.
 */
export function easyparcelBookingOn(
	settings:
		| (EasyparcelVisibility & { enabled: boolean; needsReconnect: boolean })
		| undefined,
): boolean {
	return (
		settings?.available === true &&
		settings.connected &&
		settings.enabled &&
		!settings.needsReconnect
	);
}

/**
 * What the Fulfilment row says about this section: the services ARMED, in
 * the order the section lists them, or "Off". Lalamove live-quote pricing
 * arms riders by itself (the toggle shows locked-on), so it counts.
 */
export function courierBookingGlance({
	riderBookingAvailable,
	lalamoveArmed,
	lalamovePricing,
	delyvaArmed,
	easyparcelArmed = false,
}: {
	riderBookingAvailable: boolean;
	lalamoveArmed: boolean;
	lalamovePricing: boolean;
	delyvaArmed: boolean;
	easyparcelArmed?: boolean;
}): string {
	const on = [
		...(riderBookingAvailable && (lalamoveArmed || lalamovePricing)
			? ["Lalamove riders"]
			: []),
		...(delyvaArmed ? ["Delyva"] : []),
		...(easyparcelArmed ? ["EasyParcel"] : []),
	];
	return on.length > 0 ? on.join(" · ") : "Off";
}

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
	const updateEasyparcel = useMutation(api.easyparcel.updateSettings);
	const delyva = useQuery(
		convexQuery(api.delyva.getSettings, { retailerId: actAsRetailerId }),
	).data;
	// Same args as the Integrations card, so the switch and the card share one
	// cache entry and can't disagree about whether it's on.
	const easyparcel = useQuery(
		convexQuery(api.easyparcel.getSettings, { retailerId: actAsRetailerId }),
	).data;

	const [busy, setBusy] = useState(false);

	const lalamoveConnected = deliveryBooking?.hasCredentials === true;
	const lalamovePricing = chargeMode === "lalamove";
	const delyvaConnected = delyva?.connected === true;
	const delyvaCountryOk = delyva ? delyva.countryAllowed : true;
	// Provider-aware live pricing (z8r3fdbvdy) quotes exactly what these
	// toggles say, so vendors pick their providers freely — EXCEPT the last
	// one standing: switching it off would make every delivery checkout
	// refuse. Disabled-with-reason, never a silent no-op (Zaki, 6 Sep).
	const livePricing = chargeMode === "live";
	const lalamoveArmed = deliveryBooking?.enabled === true;
	const delyvaArmed = delyvaConnected && delyva?.enabled === true;
	const lalamoveIsLastBidder = livePricing && lalamoveArmed && !delyvaArmed;
	const delyvaIsLastBidder = livePricing && delyvaArmed && !lalamoveArmed;
	// Switching Delyva on would make this live store price every order by
	// parcel weight (23 Oct 2026); the server refuses while buyable choices
	// are unweighed, and the summary carries that count so the toggle says
	// so BEFORE the tap — disabled-with-reason, with the one page that fixes
	// it. Undefined whenever the flip would be accepted.
	const delyvaHeldForWeights = delyva?.bookingHeldForWeights;
	// EasyParcel books at dispatch only — it never quotes the buyer's live
	// charge, so it neither counts as a "last bidder" nor waits on weights
	// (the dispatch card asks for the parcel weight per order).
	const easyparcelConnected = easyparcel?.connected === true;
	const easyparcelSignedOut = easyparcel?.needsReconnect === true;

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
						{/* A div, not a <p>: AppImage renders a block skeleton, and a
						    block inside a <p> is invalid HTML React warns about on
						    every hydration of this page. */}
						<div className="flex items-center gap-2 text-sm font-medium">
							<AppImage
								src="/img/lalamove-logo.svg"
								alt=""
								aspect="h-3.5 w-auto"
								fill={false}
								className="shrink-0"
							/>
							Lalamove riders
						</div>
						<p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
							{lalamovePricing
								? "On — your delivery charge runs on Lalamove live quotes, so rider booking comes with it. Switch the charge mode above to change this."
								: lalamoveIsLastBidder
									? "On — the only service pricing your live delivery charge right now. Turn on Delyva too, or switch the charge mode above, to switch this off."
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
							lalamoveIsLastBidder ||
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
						<div className="flex items-center gap-2 text-sm font-medium">
							<DelyvaLogo heightClass="h-3.5" />
							Delyva couriers
							{delyva?.isDemo ? (
								<span
									className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TONE_CHIP.warn}`}
								>
									Demo
								</span>
							) : null}
						</div>
						<p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
							{delyvaIsLastBidder ? (
								<>
									On — the only service pricing your live delivery charge right
									now. Turn on Lalamove too, or switch the charge mode above, to
									switch this off.{" "}
									<Link
										to="/app/settings"
										search={{ tab: "integrations" }}
										className="font-medium text-accent hover:underline"
									>
										Manage account
									</Link>
								</>
							) : delyvaHeldForWeights ? (
								<>
									Couriers price by weight, and {delyvaHeldForWeights} of your
									products {delyvaHeldForWeights === 1 ? "has" : "have"} no
									parcel weight — switch this on once they do.{" "}
									<Link
										to="/app/products/weights"
										className="font-medium text-accent hover:underline"
									>
										Set parcel weights
									</Link>
								</>
							) : delyvaConnected ? (
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
							delyvaIsLastBidder ||
							!delyvaConnected ||
							delyvaHeldForWeights !== undefined ||
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

			{easyparcelCardShown(easyparcel) ? (
				<div className="flex items-start justify-between gap-4 rounded-xl border border-input p-3">
					<div className="min-w-0">
						<div className="flex items-center gap-2 text-sm font-medium">
							<EasyparcelLogo heightClass="h-3.5" />
							EasyParcel couriers
							{easyparcel?.environment === "sandbox" ? (
								<span
									className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TONE_CHIP.warn}`}
								>
									Test mode
								</span>
							) : null}
						</div>
						<p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
							{easyparcelSignedOut ? (
								<>
									Paused — EasyParcel signed Kedaipal out of your account, so
									nothing can be booked until you{" "}
									<Link
										to="/app/settings"
										search={{ tab: "integrations" }}
										className="font-medium text-accent hover:underline"
									>
										reconnect in Integrations
									</Link>
									.
								</>
							) : easyparcelConnected ? (
								<>
									Parcel couriers (J&amp;T, Ninja Van, Teleport…), ambient goods
									only. Pick the courier and price per order
									{livePricing
										? " — it books, but doesn't quote your buyers' live delivery charge"
										: ""}
									.{" "}
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
									Parcel couriers (J&amp;T, Ninja Van, Teleport…).{" "}
									<Link
										to="/app/settings"
										search={{ tab: "integrations" }}
										className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
									>
										Connect EasyParcel in Integrations{" "}
										<ExternalLink className="size-3" />
									</Link>{" "}
									to turn this on.
								</>
							)}
						</p>
					</div>
					<ToggleSwitch
						on={easyparcel?.enabled === true && !easyparcelSignedOut}
						disabled={
							busy ||
							!easyparcelConnected ||
							easyparcelSignedOut ||
							(!canUse && easyparcel?.enabled !== true)
						}
						label="EasyParcel courier booking"
						onChange={(next) =>
							void run(
								async () => {
									const res = await updateEasyparcel({
										retailerId: actAsRetailerId,
										enabled: next,
									});
									if (!res.ok) throw new Error(res.message);
								},
								next ? "EasyParcel booking on" : "EasyParcel booking off",
							)
						}
					/>
				</div>
			) : null}

			{/* The baseline is not an option — it can't be turned off. Saying so
			    is what stops "which one do I pick?" confusion for the seller who
			    books nothing through Kedaipal. */}
			<p className="text-xs text-muted-foreground">
				Arranging your own courier always works too — mark the order shipped and
				add the tracking number there.
			</p>
		</div>
	);
}
