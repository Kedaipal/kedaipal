/**
 * Dispatch hub — order detail (86eyjpv6z, 3 Sep). When a store has BOTH
 * booking providers armed, stacking two full cards put two spend buttons on
 * one screen ("Book delivery" and "Book Instant Delivery" a scroll apart) —
 * a mis-tap books a rider when the seller meant a courier. The hub renders a
 * segmented switch and ONE provider's card at a time, so exactly one primary
 * action is ever visible.
 *
 * A tab is only ever offered for a provider that actually RENDERS something
 * on this order (`dispatch-surface.ts`, the same predicate the cards use to
 * decide). Offering one for a provider whose card returns null hands the
 * seller a tab that opens onto nothing — which is exactly what a delivered
 * order did: Delyva held the history, Lalamove had no job and a delivered
 * order is not bookable, so its pane came up blank. With one (or neither)
 * provider showing a card, the cards render directly and nothing is grouped.
 *
 * The switch is grouped INTO the card it drives — one bordered shell, tabs on
 * top of the pane they swap — because a floating segmented control above a
 * separate card reads as two unrelated things (Zaki, 2 Sep).
 *
 * The switch is a VIEW control, not a setting: nothing persists server-side,
 * and the per-order one-active-job reservation still arbitrates the actual
 * booking. Defaults follow the facts on the ground: a provider with a live
 * job wins (its card is where the tracking/cancel lives), then the seller's
 * last choice on this device, then rider-first for a live-quote store.
 */

import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { isActiveJobStatus } from "../../../convex/lib/deliveryJobs";
import { delyvaSurface, lalamoveSurface } from "../../lib/dispatch-surface";
import { BookDeliveryCard } from "./book-delivery-card";
import { DelyvaDispatchCard } from "./delyva-dispatch-card";

type Provider = "lalamove" | "delyva";

const STORAGE_KEY = "kp:dispatch-provider";

function storedChoice(): Provider | null {
	try {
		const v = localStorage.getItem(STORAGE_KEY);
		return v === "lalamove" || v === "delyva" ? v : null;
	} catch {
		return null;
	}
}

export function DispatchHub({
	order,
	bookRequestToken,
	advanceWithoutRider,
	onAdvanceBookUnavailable,
}: {
	order: Doc<"orders">;
	bookRequestToken?: number;
	advanceWithoutRider?: Parameters<
		typeof BookDeliveryCard
	>[0]["advanceWithoutRider"];
	onAdvanceBookUnavailable?: () => void;
}) {
	// The same subscriptions the cards themselves hold — Convex dedupes, so
	// the hub's peek costs nothing extra.
	const lalamove = useQuery(
		convexQuery(api.lalamove.getDeliveryJob, { shortId: order.shortId }),
	).data;
	const delyva = useQuery(
		convexQuery(api.delyva.getDispatchState, { shortId: order.shortId }),
	).data;

	// "Has a card", not "is switched on": a discoverability hint is a nudge,
	// not a dispatch surface, and a provider with nothing to show must never
	// get a tab.
	const lalamoveCard = lalamoveSurface(order, lalamove) === "card";
	const delyvaCard = delyvaSurface(order, delyva) === "card";

	const lalamoveActive =
		lalamove?.job != null && isActiveJobStatus(lalamove.job.status);
	const delyvaActive =
		delyva?.job != null && isActiveJobStatus(delyva.job.status);

	const [choice, setChoice] = useState<Provider | null>(null);

	// One primary action at a time only matters when both compete.
	if (!lalamoveCard || !delyvaCard) {
		return (
			<>
				<BookDeliveryCard
					order={order}
					bookRequestToken={bookRequestToken}
					advanceWithoutRider={advanceWithoutRider}
					onAdvanceBookUnavailable={onAdvanceBookUnavailable}
				/>
				<DelyvaDispatchCard order={order} />
			</>
		);
	}

	// Facts beat preference: a live booking's card is where tracking and
	// cancel live, so it always wins the default.
	const selected: Provider =
		choice ??
		(lalamoveActive
			? "lalamove"
			: delyvaActive
				? "delyva"
				: (storedChoice() ??
					(lalamove?.riderOnlyStore === true ? "lalamove" : "delyva")));

	function pick(next: Provider) {
		setChoice(next);
		try {
			localStorage.setItem(STORAGE_KEY, next);
		} catch {
			// Private windows — the default chain covers it next time.
		}
	}

	return (
		<section className="overflow-hidden rounded-2xl border border-border bg-card">
			<div
				role="tablist"
				aria-label="Booking provider"
				className="grid grid-cols-2 gap-1 border-b border-border bg-muted/60 p-2"
			>
				<ProviderTab
					label="Lalamove rider"
					active={selected === "lalamove"}
					hasLiveJob={lalamoveActive}
					onClick={() => pick("lalamove")}
				/>
				<ProviderTab
					label="Delyva courier"
					active={selected === "delyva"}
					hasLiveJob={delyvaActive}
					onClick={() => pick("delyva")}
				/>
			</div>
			<div className="p-4">
				{/* The order's booking slot is singular (cross-provider
				    reservation), so fronting the OTHER provider while one holds a
				    live job would offer a Book button the server refuses. Say
				    what's happening instead, with the way back. */}
				{selected === "lalamove" && delyvaActive ? (
					<OtherProviderNotice
						holder="Delyva courier"
						here="a Lalamove rider"
						onView={() => pick("delyva")}
					/>
				) : selected === "delyva" && lalamoveActive ? (
					<OtherProviderNotice
						holder="Lalamove rider"
						here="a Delyva courier"
						onView={() => pick("lalamove")}
					/>
				) : selected === "lalamove" ? (
					<BookDeliveryCard
						order={order}
						bookRequestToken={bookRequestToken}
						advanceWithoutRider={advanceWithoutRider}
						onAdvanceBookUnavailable={onAdvanceBookUnavailable}
						embedded
					/>
				) : (
					<DelyvaDispatchCard order={order} embedded />
				)}
			</div>
		</section>
	);
}

/** One booking at a time, said in place of an empty pane: the fronted
 * provider can't book while the other holds the order's slot. */
function OtherProviderNotice({
	holder,
	here,
	onView,
}: {
	holder: string;
	here: string;
	onView: () => void;
}) {
	return (
		<section className="flex flex-col items-start gap-2">
			<p className="text-sm text-muted-foreground">
				A <span className="font-medium text-foreground">{holder}</span> is
				already on this order — one booking at a time. Cancel it first if you
				want to send this by {here} instead.
			</p>
			<button
				type="button"
				onClick={onView}
				className="min-h-9 text-sm font-medium text-accent underline-offset-2 hover:underline"
			>
				View the {holder} booking
			</button>
		</section>
	);
}

function ProviderTab({
	label,
	active,
	hasLiveJob,
	onClick,
}: {
	label: string;
	active: boolean;
	hasLiveJob: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			role="tab"
			aria-selected={active}
			onClick={onClick}
			className={`flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors ${
				active
					? "bg-card text-foreground shadow-sm ring-1 ring-border"
					: "text-muted-foreground hover:text-foreground"
			}`}
		>
			{label}
			{/* A live booking marks its tab even while the other is fronted, so
			    "where is my courier?" is answerable without switching. */}
			{hasLiveJob ? (
				<span
					role="img"
					aria-label="has a live booking"
					className="size-2 rounded-full bg-accent"
				/>
			) : null}
		</button>
	);
}
