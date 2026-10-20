/**
 * Dispatch hub — order detail (86eyjpv6z, 3 Sep; N-provider since
 * z8r3fdcje2). When a store has MORE THAN ONE booking provider armed,
 * stacking full cards put multiple spend buttons on one screen ("Book
 * delivery" and "Book Instant Delivery" a scroll apart) — a mis-tap books a
 * rider when the seller meant a courier. The hub renders a segmented switch
 * and ONE provider's card at a time, so exactly one primary action is ever
 * visible.
 *
 * A tab is only ever offered for a provider that actually RENDERS something
 * on this order (`dispatch-surface.ts`, the same predicate the cards use to
 * decide). Offering one for a provider whose card returns null hands the
 * seller a tab that opens onto nothing — which is exactly what a delivered
 * order did: Delyva held the history, Lalamove had no job and a delivered
 * order is not bookable, so its pane came up blank. With one (or no)
 * provider showing a card, the cards render directly and nothing is grouped.
 *
 * The providers come from the registry (`COURIER_PROVIDER_IDS`), so a fourth
 * provider joins this switch by existing — the hub holds per-provider labels
 * and render arms as `Record`s, which makes a missing arm a compile error.
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
import type { ReactNode } from "react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import {
	COURIER_PROVIDER_IDS,
	type CourierProviderId,
} from "../../../convex/lib/courierProviders";
import { isActiveJobStatus } from "../../../convex/lib/deliveryJobs";
import {
	delyvaSurface,
	easyparcelSurface,
	lalamoveSurface,
} from "../../lib/dispatch-surface";
import { BookDeliveryCard } from "./book-delivery-card";
import { DelyvaDispatchCard } from "./delyva-dispatch-card";
import { EasyparcelDispatchCard } from "./easyparcel-dispatch-card";

type Provider = CourierProviderId;

/** What a tab (and the one-booking notice) calls each provider. */
const PROVIDER_LABEL: Record<Provider, string> = {
	lalamove: "Lalamove rider",
	delyva: "Delyva courier",
	easyparcel: "EasyParcel courier",
};

/** The label with its article, for "send this by …" sentences. */
const PROVIDER_INDEFINITE: Record<Provider, string> = {
	lalamove: "a Lalamove rider",
	delyva: "a Delyva courier",
	easyparcel: "an EasyParcel courier",
};

const STORAGE_KEY = "kp:dispatch-provider";

function storedChoice(): Provider | null {
	try {
		const v = localStorage.getItem(STORAGE_KEY);
		return v !== null && (COURIER_PROVIDER_IDS as readonly string[]).includes(v)
			? (v as Provider)
			: null;
	} catch {
		return null;
	}
}

export function DispatchHub({
	order,
	bookRequestToken,
	advanceWithoutRider,
	onAdvanceBookUnavailable,
	lockedReason,
}: {
	order: Doc<"orders">;
	bookRequestToken?: number;
	advanceWithoutRider?: Parameters<
		typeof BookDeliveryCard
	>[0]["advanceWithoutRider"];
	onAdvanceBookUnavailable?: () => void;
	/** Why the store can't book right now (out of credits, or view-only) —
	 * handed to whichever card is showing. */
	lockedReason?: string;
}) {
	// The same subscriptions the cards themselves hold — Convex dedupes, so
	// the hub's peek costs nothing extra.
	const lalamove = useQuery(
		convexQuery(api.lalamove.getDeliveryJob, { shortId: order.shortId }),
	).data;
	const delyva = useQuery(
		convexQuery(api.delyva.getDispatchState, { shortId: order.shortId }),
	).data;
	const easyparcel = useQuery(
		convexQuery(api.easyparcel.getDispatchState, { shortId: order.shortId }),
	).data;

	const [choice, setChoice] = useState<Provider | null>(null);

	// "Has a card", not "is switched on": a discoverability hint is a nudge,
	// not a dispatch surface, and a provider with nothing to show must never
	// get a tab.
	const hasCard: Record<Provider, boolean> = {
		lalamove: lalamoveSurface(order, lalamove) === "card",
		delyva: delyvaSurface(order, delyva) === "card",
		easyparcel: easyparcelSurface(order, easyparcel) === "card",
	};
	const hasLiveJob: Record<Provider, boolean> = {
		lalamove: lalamove?.job != null && isActiveJobStatus(lalamove.job.status),
		delyva: delyva?.job != null && isActiveJobStatus(delyva.job.status),
		easyparcel:
			easyparcel?.job != null && isActiveJobStatus(easyparcel.job.status),
	};
	/** Each provider's pane — `embedded` because the hub provides the shell. */
	const renderCard: Record<Provider, () => ReactNode> = {
		lalamove: () => (
			<BookDeliveryCard
				order={order}
				bookRequestToken={bookRequestToken}
				advanceWithoutRider={advanceWithoutRider}
				onAdvanceBookUnavailable={onAdvanceBookUnavailable}
				lockedReason={lockedReason}
				embedded
			/>
		),
		delyva: () => (
			<DelyvaDispatchCard order={order} lockedReason={lockedReason} embedded />
		),
		easyparcel: () => (
			<EasyparcelDispatchCard
				order={order}
				lockedReason={lockedReason}
				embedded
			/>
		),
	};

	const cardProviders = COURIER_PROVIDER_IDS.filter((p) => hasCard[p]);
	const liveProvider = COURIER_PROVIDER_IDS.find((p) => hasLiveJob[p]) ?? null;

	// One primary action at a time only matters when at least two compete.
	if (cardProviders.length < 2) {
		return (
			<>
				<BookDeliveryCard
					order={order}
					bookRequestToken={bookRequestToken}
					advanceWithoutRider={advanceWithoutRider}
					onAdvanceBookUnavailable={onAdvanceBookUnavailable}
					lockedReason={lockedReason}
				/>
				<DelyvaDispatchCard order={order} lockedReason={lockedReason} />
				<EasyparcelDispatchCard order={order} lockedReason={lockedReason} />
			</>
		);
	}

	// Facts beat preference: a live booking's card is where tracking and
	// cancel live, so it always wins the default. The stored choice only
	// counts while its provider actually has a tab here.
	const stored = storedChoice();
	const selected: Provider =
		choice ??
		liveProvider ??
		(stored !== null && cardProviders.includes(stored) ? stored : null) ??
		(lalamove?.riderOnlyStore === true && cardProviders.includes("lalamove")
			? "lalamove"
			: cardProviders.find((p) => p !== "lalamove")) ??
		cardProviders[0];

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
				className={`grid gap-1 border-b border-border bg-muted/60 p-2 ${
					cardProviders.length === 3 ? "grid-cols-3" : "grid-cols-2"
				}`}
			>
				{cardProviders.map((provider) => (
					<ProviderTab
						key={provider}
						label={PROVIDER_LABEL[provider]}
						active={selected === provider}
						hasLiveJob={hasLiveJob[provider]}
						onClick={() => pick(provider)}
					/>
				))}
			</div>
			<div className="p-4">
				{/* The order's booking slot is singular (cross-provider
				    reservation), so fronting ANOTHER provider while one holds a
				    live job would offer a Book button the server refuses. Say
				    what's happening instead, with the way back. */}
				{liveProvider !== null && liveProvider !== selected ? (
					<OtherProviderNotice
						holder={PROVIDER_LABEL[liveProvider]}
						here={PROVIDER_INDEFINITE[selected]}
						onView={() => pick(liveProvider)}
					/>
				) : (
					renderCard[selected]()
				)}
			</div>
		</section>
	);
}

/** One booking at a time, said in place of an empty pane: the fronted
 * provider can't book while another holds the order's slot. */
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
			{/* A live booking marks its tab even while another is fronted, so
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
