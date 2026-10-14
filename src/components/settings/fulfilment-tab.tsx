import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import {
	CalendarClock,
	Clock,
	ExternalLink,
	MapPin,
	Pencil,
	Phone,
	Plus,
	X,
} from "lucide-react";
import {
	Fragment,
	type ReactNode,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import {
	formatPickupAddress,
	sanitizeUnitLine,
	UNIT_LINE_MAX_LENGTH,
} from "../../../convex/lib/address";
import {
	resolveAwbConfig,
	type StoredAwbConfig,
} from "../../../convex/lib/awbConfig";
import {
	type ClosedDateRange,
	upcomingClosures,
} from "../../../convex/lib/closedDates";
import type { Country } from "../../../convex/lib/country";
import type { DeliveryConfig } from "../../../convex/lib/delivery";
import {
	DEFAULT_MIN_NOTICE_DAYS,
	hhmmFromMinutes,
	MAX_NOTICE_DAYS,
	timeMinutesFromHhmm,
} from "../../../convex/lib/fulfilmentDate";
import { MIN_ORDER_VALUE_MAX } from "../../../convex/lib/minOrderRules";
import {
	type DayHours,
	type DayHoursIssue,
	dayGaps,
	dayHoursIssue,
	hasSecondWindow,
	MAX_CLOSE_MINUTES,
	OPEN_ALL_DAY,
	type OpeningHours,
	WEEKDAY_NAMES,
	WEEKDAY_NAMES_SHORT,
} from "../../../convex/lib/openingHours";
import { useChecklistStamp } from "../../hooks/useChecklistStamp";
import { useUpdateSettings } from "../../hooks/useUpdateSettings";
import { MASK_PII } from "../../lib/analytics-privacy";
import {
	type CardTarget,
	type FixHighlight,
	SETTINGS_ANCHOR,
} from "../../lib/country-setup-copy";
import { formatPhone } from "../../lib/customer";
import {
	PRICING_MODE_UI,
	pricingModeOf,
	pricingSummary,
} from "../../lib/delivery-modes";
import {
	convexErrorMessage,
	currencySymbol,
	formatPrice,
	normalizePriceInput,
	parsePriceInput,
} from "../../lib/format";
import { hoursSummary, noticeSummary } from "../../lib/fulfilment-glance";
import { deriveMapsUrl } from "../../lib/google-address";
import { SPOTLIGHT_ANCHOR } from "../../lib/spotlight";
import { hasFeature, type SubscriptionView } from "../../lib/subscription";
import { cn } from "../../lib/utils";
import {
	GoogleAddressAutocomplete,
	type GoogleSelectedAddress,
} from "../forms/google-address-autocomplete";
import { DayWindowsStacked, TimeRange } from "../hours/hours-text";
import { Button } from "../ui/button";
import { FilterChip } from "../ui/filter-chip";
import { Input } from "../ui/input";
import { LinkifiedText } from "../ui/linkified-text";
import { ModeButton } from "../ui/mode-button";
import { Skeleton } from "../ui/skeleton";
import { SortableList } from "../ui/sortable-list";
import { TimePicker } from "../ui/time-picker";
import { ToggleSwitch } from "../ui/toggle-switch";
import { ClosedDatesCard } from "./closed-dates-card";
import type { BusinessAddress } from "./delivery-pricing";
import { DespatchLabelCard } from "./despatch-label-card";
import { PickupLocationEditDialog } from "./pickup-location-edit-dialog";
import {
	Card,
	ExpandableRow,
	Glance,
	HelperBullets,
	InfoDisclosure,
	SectionHeading,
	SummaryRow,
} from "./settings-primitives";

interface FulfilmentTabProps {
	retailerId: Id<"retailers">;
	/** Deep-link target: the anchor to scroll to and how loudly to ring it —
	 * red/amber from the post-switch checklist (86eyqgujv), mint from a
	 * What's-new note (`?spot=`). Undefined on a normal visit: the ring is
	 * contextual to having been sent here, never a permanent border. */
	target?: CardTarget;
	/** Storefront currency — every money input on this tab wears its symbol.
	 * Threaded rather than assumed: an SG store's delivery, pickup-fee and
	 * minimum-order fields quoted "RM" before this (86eyqgujv). */
	currency: string;
	/** The store's country (SG-lite) — SG stores see only the Free/Flat
	 * delivery-charge modes (the MY-only ones are server-refused), the address
	 * pickers search the store's own country, and the pickup-point editor's
	 * manager-contact phone plate/validator follows it. */
	country: Country;
	offerSelfCollect: boolean;
	offerDelivery: boolean;
	/** Current delivery-charge config (undefined = free delivery). */
	deliveryConfig: DeliveryConfig | undefined;
	/** Business address — origin for distance-based pricing. */
	businessAddress: BusinessAddress | undefined;
	minFulfilmentNoticeDays: number | undefined;
	/** Store opening hours (86eyp5rav) — undefined = open 24/7. Buyers can only
	 * pick fulfilment dates/times inside them. See convex/lib/openingHours.ts. */
	openingHours: OpeningHours | undefined;
	/** Closed dates (z8r3fdhpm7) — the weekly schedule's exceptions. */
	closedDates: ClosedDateRange[] | undefined;
	/** The store sells booking listings — the Closed dates card then says what
	 * a closure does to them (z8r3fdhpm7). */
	hasBookingListings: boolean;
	/** Store-wide minimum order value (minor units, 86ey9unyx) — undefined =
	 * no minimum. See convex/lib/minOrderRules.ts. */
	minOrderValue: number | undefined;
	/** Despatch-label template (86eyp63mp) — undefined = every default. */
	awbConfig: StoredAwbConfig | undefined;
	/** Resolved subscription — drives the Pro-gated pickup-fee input in the
	 * edit dialog (client mirror only; the server gate is the real lock). */
	subscription: SubscriptionView | undefined;
}

/**
 * The pickup-point list: drag-sorted active rows, a collapsible set of
 * inactive ones, and a caller-supplied empty state.
 *
 * Shared by BOTH cards (pickup points and event venues, `z8r3fdm32x`) rather
 * than copied, so the two can't drift into looking like different features —
 * they are the same objects, filtered. Only the heading, the empty state and
 * which segment a reorder writes differ.
 */
function LocationList({
	loading,
	active,
	inactive,
	currency,
	emptyState,
	showInactive,
	onToggleShowInactive,
	onReorder,
	onEdit,
	onToggleActive,
	eventNamesByVenue,
}: {
	loading: boolean;
	active: Doc<"pickupLocations">[];
	inactive: Doc<"pickupLocations">[];
	currency: string;
	emptyState: React.ReactNode;
	showInactive: boolean;
	onToggleShowInactive: () => void;
	onReorder: (orderedIds: string[]) => void;
	onEdit: (location: Doc<"pickupLocations">) => void;
	onToggleActive: (location: Doc<"pickupLocations">, next: boolean) => void;
	eventNamesByVenue: Map<string, string[]>;
}) {
	return (
		<>
			{loading ? (
				<LocationListSkeleton />
			) : active.length === 0 ? (
				emptyState
			) : (
				<SortableList
					items={active}
					getId={(loc) => loc._id}
					onReorder={onReorder}
					renderItem={(loc, handle, state) =>
						state.isSorting ? (
							// Collapsed one-line row while dragging (matches the
							// order-status editor) — a tall list stays easy to rearrange.
							<div
								className={`flex items-center gap-2 rounded-xl border bg-background p-3 ${
									state.isOverlay ? "border-accent shadow-lg" : "border-border"
								}`}
							>
								{handle}
								<MapPin
									className="size-4 shrink-0 text-accent"
									aria-hidden="true"
								/>
								<span className="truncate text-sm font-medium">
									{loc.label}
								</span>
							</div>
						) : (
							<div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
								<LocationRowBody
									currency={currency}
									location={loc}
									onEdit={() => onEdit(loc)}
									onToggleActive={(next) => onToggleActive(loc, next)}
									dragHandle={handle}
									eventNames={eventNamesByVenue.get(loc._id)}
								/>
							</div>
						)
					}
				/>
			)}

			{inactive.length > 0 ? (
				<div className="flex flex-col gap-2 border-t border-border pt-3">
					<button
						type="button"
						onClick={onToggleShowInactive}
						className="self-start text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
					>
						{showInactive
							? `Hide inactive (${inactive.length})`
							: `Show inactive (${inactive.length})`}
					</button>
					{showInactive ? (
						<ul className="flex flex-col gap-2">
							{inactive.map((loc) => (
								<LocationRow
									key={loc._id}
									location={loc}
									currency={currency}
									onEdit={() => onEdit(loc)}
									onToggleActive={(next) => onToggleActive(loc, next)}
									eventNames={eventNamesByVenue.get(loc._id)}
								/>
							))}
						</ul>
					) : null}
				</div>
			) : null}
		</>
	);
}

function PickupKindBadge({ kind }: { kind: "self_collect" | "drop_off" }) {
	return (
		<span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
			{kind === "drop_off" ? "Drop-off" : "Self-collect"}
		</span>
	);
}

export function FulfilmentTab({
	retailerId,
	target,
	currency,
	country,
	offerSelfCollect,
	offerDelivery,
	deliveryConfig,
	businessAddress,
	minFulfilmentNoticeDays,
	openingHours,
	closedDates,
	hasBookingListings,
	minOrderValue,
	awbConfig,
	subscription,
}: FulfilmentTabProps) {
	const locations = useQuery(
		convexQuery(api.pickupLocations.listForRetailer, { retailerId }),
	).data;
	const updateSettings = useUpdateSettings();
	const navigate = useNavigate();
	const pricing = pricingSummary(deliveryConfig, (sen) =>
		formatPrice(sen, currency),
	);
	/** Ring this card when it's the one the deep link sent the seller to.
	 * Undefined on a normal visit. */
	const ring = (anchor: string): FixHighlight | undefined =>
		target?.anchor === anchor ? target.highlight : undefined;
	const setActive = useMutation(api.pickupLocations.setActive);
	// Which points host a live event (`z8r3fdff9u`). A point can be hidden
	// from standard orders yet still be an event's venue (an RSVP-only
	// location), so the row that hides it must SAY it hosts events — "hide"
	// must never look like it made the point disappear everywhere.
	const venueUsage = useQuery(
		convexQuery(api.products.eventVenueUsage, { retailerId }),
	).data;
	const eventNamesByVenue = useMemo(() => {
		const map = new Map<string, string[]>();
		for (const u of venueUsage ?? []) {
			const names = map.get(u.venueId) ?? [];
			names.push(u.name);
			map.set(u.venueId, names);
		}
		return map;
	}, [venueUsage]);
	const reorder = useMutation(api.pickupLocations.reorder);
	const { stamp: markPickupSetupSeen } = useChecklistStamp(
		api.retailers.markPickupSetupSeen,
	);

	// Fire-and-forget on first mount so step 4 of the dashboard checklist
	// dismisses. Server-side is idempotent (no-op when already true) so a
	// double-render or re-mount doesn't double-write. We don't await or surface
	// errors — failing this is purely cosmetic for the checklist. The act-as
	// no-op lives in `useChecklistStamp` now, not here: this guard used to be
	// one of two spellings of the same rule, and three other call sites had
	// simply forgotten it.
	const seenFired = useRef(false);
	useEffect(() => {
		if (seenFired.current) return;
		seenFired.current = true;
		markPickupSetupSeen().catch(() => {
			seenFired.current = false; // allow retry on subsequent mount
		});
	}, [markPickupSetupSeen]);

	// "new" and "new-venue" differ only in what the dialog pre-selects — both
	// create a row in the same table.
	const [editing, setEditing] = useState<
		Doc<"pickupLocations"> | "new" | "new-venue" | null
	>(null);
	const [showInactive, setShowInactive] = useState(false);
	const [showInactiveVenues, setShowInactiveVenues] = useState(false);
	const [toggling, setToggling] = useState(false);

	// Two lists over ONE table (z8r3fdm32x). `eventsOnly` says a point hosts
	// events and is never offered at checkout — so it must not count towards
	// anything that asks "can a buyer collect here?", which is why the pickup
	// splits below filter it out rather than the whole-table reads doing it.
	const pickupPoints = locations?.filter((l) => l.eventsOnly !== true) ?? [];
	const eventVenues = locations?.filter((l) => l.eventsOnly === true) ?? [];
	const active = pickupPoints.filter((l) => l.isActive);
	const inactive = pickupPoints.filter((l) => !l.isActive);
	const activeVenues = eventVenues.filter((l) => l.isActive);
	const inactiveVenues = eventVenues.filter((l) => !l.isActive);
	// The venues section is shown to a store that can run events, and ALSO to
	// one that already has a venue — a downgrade must never make configured
	// data invisible (the per-kind order-flow posture).
	const showEventVenues =
		hasFeature(subscription, "events") || eventVenues.length > 0;

	// Fulfilment invariant (mirrors the server guard in retailers.updateSettings):
	// a storefront must keep ≥1 WORKING method. Self-collect only "works" with an
	// active location, so once we know the location list we can pre-disable the
	// toggle that would strand the store and show an actionable reason. The server
	// still enforces this — the disabled state is courtesy, not the gate.
	const selfCollectWorking = offerSelfCollect && active.length > 0;
	const deliveryIsLastMethod =
		locations !== undefined && offerDelivery && !selfCollectWorking;
	const selfCollectIsLastMethod = offerSelfCollect && !offerDelivery;
	/**
	 * Why "Only hosts events" can't be ticked for this point, or undefined.
	 *
	 * Mirrors the server guard in `pickupLocations.update`: flipping the last
	 * CHOOSABLE point to events-only takes it out of the buyer's picker exactly
	 * as deactivating it would, so a pickup-only store would be left accepting
	 * nothing. The server is the real lock — this exists so the seller is told
	 * before the tap, not by an error after the save (`z8r3fdm32x` review).
	 */
	const eventsOnlyLockReason = (
		loc: Doc<"pickupLocations"> | undefined,
	): string | undefined => {
		if (!loc || offerDelivery || !loc.isActive || loc.eventsOnly === true) {
			return undefined;
		}
		const othersLeft = active.some((l) => l._id !== loc._id);
		return othersLeft
			? undefined
			: "Delivery is off and this is the only place buyers can collect from. Turn delivery back on, or add another pickup point, before making this events-only.";
	};
	const deliveryToggleDisabled = toggling || deliveryIsLastMethod;
	const selfCollectToggleDisabled = toggling || selfCollectIsLastMethod;

	async function handleToggleDelivery(next: boolean) {
		setToggling(true);
		try {
			await updateSettings({ offerDelivery: next });
			toast.success(next ? "Delivery enabled." : "Delivery turned off.");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setToggling(false);
		}
	}

	async function handleToggleSelfCollect(next: boolean) {
		setToggling(true);
		try {
			await updateSettings({ offerSelfCollect: next });
			toast.success(next ? "Pickup enabled." : "Pickup turned off.");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setToggling(false);
		}
	}

	async function handleToggleActive(
		location: Doc<"pickupLocations">,
		next: boolean,
	) {
		try {
			await setActive({ pickupLocationId: location._id, isActive: next });
			// Hiding a point removes it from the standard-order picker, never
			// from an event it hosts — say so in the same breath, or "hidden"
			// reads as "gone everywhere".
			const hostsEvents = eventNamesByVenue.has(location._id);
			toast.success(
				next
					? `“${location.label}” restored.`
					: hostsEvents
						? `“${location.label}” hidden from standard orders. Events it hosts keep sending guests here.`
						: `“${location.label}” hidden.`,
			);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		}
	}

	// --- Drag-and-drop reorder ---
	//
	// We keep an optimistic `localOrder` of active ids that the SortableContext
	// renders in. On drop:
	//   1. Compute the new order via @dnd-kit/sortable's arrayMove.
	//   2. Apply it to `localOrder` immediately (UI updates instantly).
	//   3. Fire the reorder mutation. If it fails, revert localOrder so the UI
	//      snaps back and the seller sees the toast.
	// Convex's reactive query then ships the authoritative order back on
	// success, which matches localOrder so no flicker.
	//
	// Reconciliation is gated by a primitive string key (`activeIdsKey`) so the
	// effect only fires when the server's active set or order ACTUALLY changes
	// — adding the recomputed-each-render `activeIds` array to the deps would
	// re-sync on every parent render, clobbering optimistic state between drop
	// and mutation-ack and producing a visible "snap back, then re-jump"
	// stutter.
	// The whole active set, both segments — `reorder` is all-or-nothing.
	const activeIds = [...active, ...activeVenues].map((l) => l._id);
	const activeIdsKey = activeIds.join("|");
	const [localOrder, setLocalOrder] =
		useState<Array<Id<"pickupLocations">>>(activeIds);
	// Reconcile only on activeIdsKey (see the comment block above): activeIds is
	// read via closure on the render where the key actually changes, so we get
	// the latest server order without the per-render reset.
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on activeIdsKey, activeIds read via closure — see above.
	useEffect(() => {
		setLocalOrder(activeIds);
	}, [activeIdsKey]);

	const orderBy = (rows: Doc<"pickupLocations">[]) => {
		const byId = new Map(rows.map((l) => [l._id, l]));
		return localOrder
			.map((id) => byId.get(id))
			.filter((l): l is Doc<"pickupLocations"> => l !== undefined);
	};
	// biome-ignore lint/correctness/useExhaustiveDependencies: orderBy is a stable closure over localOrder, which IS a dep.
	const orderedActive = useMemo(() => orderBy(active), [active, localOrder]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: see above.
	const orderedVenues = useMemo(
		() => orderBy(activeVenues),
		[activeVenues, localOrder],
	);

	// `reorder` demands EVERY active row exactly once, so each card sends its
	// own segment and we compose the whole list here — pickup points first,
	// venues after. The other segment keeps its relative order, and the two
	// stay contiguous in `sortOrder`, which is what the picker's groups read.
	async function handleReorder(
		segment: "pickup" | "venue",
		orderedIds: string[],
	) {
		const ids = orderedIds as Array<Id<"pickupLocations">>;
		const others = (segment === "pickup" ? activeVenues : active).map(
			(l) => l._id,
		);
		const next =
			segment === "pickup" ? [...ids, ...others] : [...others, ...ids];
		const previous = localOrder;
		setLocalOrder(next); // optimistic
		try {
			await reorder({ retailerId, orderedIds: next });
		} catch (err) {
			setLocalOrder(previous); // revert on failure
			toast.error(convexErrorMessage(err));
		}
	}

	const closures = upcomingClosures(closedDates);
	const notice = minFulfilmentNoticeDays ?? DEFAULT_MIN_NOTICE_DAYS;
	const hours = hoursSummary(openingHours);
	const awb = resolveAwbConfig(awbConfig);

	// One set of cards in two arrangements, never rendered twice: mobile reads
	// them in 9A's order (Hours, Order rules, Delivery, Pickup); from xl the two
	// `contents` wrappers become 2A's columns (Delivery, Order rules, Hours |
	// Pickup, Event venues) and `xl:order-none` hands the order back to them.
	return (
		<div className="flex flex-col gap-6 pt-2 xl:grid xl:grid-cols-2 xl:items-start">
			<div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-6">
				<div className="order-3 min-w-0 xl:order-none">
					<Card
						id={SETTINGS_ANCHOR.delivery_mode}
						highlight={ring(SETTINGS_ANCHOR.delivery_mode)}
					>
						<div className="flex items-start justify-between gap-3">
							<SectionHeading
								title="Delivery"
								description="Buyers enter a delivery address at checkout."
								glance={
									offerDelivery ? (
										<Glance>
											{PRICING_MODE_UI[pricingModeOf(deliveryConfig)].title}
										</Glance>
									) : (
										<Glance tone="grey">Off</Glance>
									)
								}
							/>
							<ToggleSwitch
								on={offerDelivery}
								onChange={handleToggleDelivery}
								disabled={deliveryToggleDisabled}
								label="Offer delivery on the storefront"
							/>
						</div>
						{deliveryIsLastMethod ? (
							<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
								Delivery is your storefront&apos;s only working way to receive
								orders right now. Add an active pickup point (and keep pickup
								on) before switching it off.
							</p>
						) : null}
						<div className="flex flex-col">
							<SummaryRow
								label="Pricing"
								value={pricing}
								onClick={() =>
									void navigate({ to: "/app/settings/delivery-pricing" })
								}
								// The row reads "Pricing" inside the Delivery card; out of
								// that context a screen reader needs the noun and the value.
								ariaLabel={`Delivery pricing: ${pricing}`}
							/>
							<ExpandableRow
								id={SETTINGS_ANCHOR.business_address}
								highlight={ring(SETTINGS_ANCHOR.business_address)}
								label="Business address"
								value={
									businessAddress ? (
										<span className="max-w-[12rem] truncate font-normal text-muted-foreground">
											{businessAddress.label}
										</span>
									) : (
										<Glance tone="warn">Not set</Glance>
									)
								}
							>
								<BusinessAddressCard
									country={country}
									businessAddress={businessAddress}
								/>
							</ExpandableRow>
							{/* The paper that goes on a parcel once it's going out by
							    courier — delivery's, never pickup's (no address). */}
							<ExpandableRow
								label="Despatch labels"
								value={
									<span className="font-normal text-muted-foreground">
										{awb.paperSize === "a6" ? "A6 roll" : "A4 · 4 per sheet"}
									</span>
								}
							>
								<DespatchLabelCard
									key={JSON.stringify(awbConfig ?? {})}
									config={awb}
									onSave={(patch) => updateSettings({ awbConfig: patch })}
								/>
							</ExpandableRow>
						</div>
					</Card>
				</div>

				<div className="order-2 min-w-0 xl:order-none">
					<Card>
						<SectionHeading
							title="Order rules"
							description="How soon, and how much, a buyer can order."
							glance={
								<Glance tone="grey">
									{noticeSummary(notice)}
									{(minOrderValue ?? 0) > 0
										? ` · ${formatPrice(minOrderValue ?? 0, currency)} min`
										: ""}
								</Glance>
							}
						/>
						<div className="flex flex-col">
							<ExpandableRow
								label="Advance notice"
								value={notice === 0 ? "Same-day" : noticeSummary(notice)}
							>
								<MinNoticeCard initial={minFulfilmentNoticeDays} />
							</ExpandableRow>
							<ExpandableRow
								label="Minimum order"
								value={
									(minOrderValue ?? 0) > 0
										? formatPrice(minOrderValue ?? 0, currency)
										: "None"
								}
							>
								<MinOrderValueCard
									initial={minOrderValue}
									currency={currency}
								/>
							</ExpandableRow>
						</div>
					</Card>
				</div>

				<div className="order-1 min-w-0 xl:order-none">
					<Card>
						<SectionHeading
							title="Hours"
							description="When buyers can pick a delivery or pickup slot."
							glance={<Glance>{hours.glance}</Glance>}
						/>
						<div className="flex flex-col">
							<ExpandableRow
								id={SPOTLIGHT_ANCHOR.opening_hours.anchor}
								highlight={ring(SPOTLIGHT_ANCHOR.opening_hours.anchor)}
								label="Opening hours"
								value={
									<span className="max-w-[14rem] truncate">{hours.row}</span>
								}
							>
								<OpeningHoursCard initial={openingHours} />
							</ExpandableRow>
							{/* The weekly schedule's exceptions (z8r3fdhpm7). */}
							<ExpandableRow
								id={SPOTLIGHT_ANCHOR.closed_dates.anchor}
								highlight={ring(SPOTLIGHT_ANCHOR.closed_dates.anchor)}
								label="Closed dates"
								value={
									closures.length === 0 ? "None" : `${closures.length} upcoming`
								}
							>
								<ClosedDatesCard
									retailerId={retailerId}
									closedDates={closedDates}
									hasBookingListings={hasBookingListings}
								/>
							</ExpandableRow>
						</div>
					</Card>
				</div>
			</div>

			<div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-6">
				<div className="order-4 min-w-0 xl:order-none">
					<Card
						id={SETTINGS_ANCHOR.pickup_addresses}
						highlight={ring(SETTINGS_ANCHOR.pickup_addresses)}
					>
						<div className="flex items-start justify-between gap-3">
							<SectionHeading
								title="Pickup"
								description="Buyers collect from a point you set."
								glance={
									!offerSelfCollect ? (
										<Glance tone="grey">Off</Glance>
									) : active.length === 0 ? (
										<Glance tone="warn">No points</Glance>
									) : (
										<Glance>
											{active.length} point{active.length === 1 ? "" : "s"}
										</Glance>
									)
								}
							/>
							<ToggleSwitch
								on={offerSelfCollect}
								onChange={handleToggleSelfCollect}
								disabled={selfCollectToggleDisabled}
								label="Offer pickup on the storefront"
							/>
						</div>
						{selfCollectIsLastMethod ? (
							<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
								Pickup is your storefront&apos;s only working way to receive
								orders right now (delivery is off). Turn delivery back on before
								turning this off.
							</p>
						) : offerSelfCollect && active.length === 0 ? (
							<p className="rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
								Pickup is on but you have no active points yet — buyers
								won&apos;t see the option until you add one.
							</p>
						) : null}
						<LocationList
							loading={locations === undefined}
							active={orderedActive}
							inactive={inactive}
							currency={currency}
							emptyState={<EmptyState onAdd={() => setEditing("new")} />}
							showInactive={showInactive}
							onToggleShowInactive={() => setShowInactive((v) => !v)}
							onReorder={(ids) => handleReorder("pickup", ids)}
							onEdit={setEditing}
							onToggleActive={handleToggleActive}
							eventNamesByVenue={eventNamesByVenue}
						/>
						{pickupPoints.length > 0 ? (
							<Button
								type="button"
								variant="outline"
								className="h-11 gap-1.5"
								onClick={() => setEditing("new")}
							>
								<Plus className="size-4" />
								Add pickup point
							</Button>
						) : null}
						<InfoDisclosure summary="How pickup points work">
							<HelperBullets
								items={[
									"Self-collect is your own place; drop-off is an agreed meetup spot",
									"Pickup shows at checkout once at least one point is active",
									"Each order keeps the point it was placed with — editing or hiding a point later never rewrites past orders",
								]}
							/>
						</InfoDisclosure>
					</Card>
				</div>

				{/* After Pickup, NOT inside it: a store that runs events but never
				    offers pickup would otherwise find its venues inside a
				    switched-off section (z8r3fdm32x). */}
				{showEventVenues ? (
					<div className="order-5 min-w-0 xl:order-none">
						<Card
							id={SPOTLIGHT_ANCHOR.event_venues.anchor}
							highlight={ring(SPOTLIGHT_ANCHOR.event_venues.anchor)}
						>
							<SectionHeading
								title="Event venues"
								description="Where your events happen — never offered as a pickup choice."
								glance={
									activeVenues.length > 0 ? (
										<Glance tone="grey">
											{activeVenues.length} venue
											{activeVenues.length === 1 ? "" : "s"}
										</Glance>
									) : undefined
								}
							/>
							<LocationList
								loading={locations === undefined}
								active={orderedVenues}
								inactive={inactiveVenues}
								currency={currency}
								emptyState={
									<div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-8 text-center">
										<CalendarClock
											className="size-5 text-muted-foreground"
											aria-hidden="true"
										/>
										<p className="text-sm font-medium">No event venues yet</p>
										<p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
											Add a hall, a studio or anywhere else you host events.
											Guests are sent straight there.
										</p>
										<Button
											type="button"
											variant="outline"
											className="mt-1 h-11 gap-1.5"
											onClick={() => setEditing("new-venue")}
										>
											<Plus className="size-4" />
											Add event venue
										</Button>
									</div>
								}
								showInactive={showInactiveVenues}
								onToggleShowInactive={() => setShowInactiveVenues((v) => !v)}
								onReorder={(ids) => handleReorder("venue", ids)}
								onEdit={setEditing}
								onToggleActive={handleToggleActive}
								eventNamesByVenue={eventNamesByVenue}
							/>
							{eventVenues.length > 0 ? (
								<Button
									type="button"
									variant="outline"
									className="h-11 gap-1.5"
									onClick={() => setEditing("new-venue")}
								>
									<Plus className="size-4" />
									Add event venue
								</Button>
							) : null}
						</Card>
					</div>
				) : null}
			</div>

			<PickupLocationEditDialog
				// Remount per edit target so the dialog's local state (kind, geo,
				// fee, form defaults — all captured in initializers) can't leak
				// from one location into the next.
				key={typeof editing === "string" ? editing : (editing?._id ?? "closed")}
				open={editing !== null}
				onClose={() => setEditing(null)}
				location={
					typeof editing === "string" ? undefined : (editing ?? undefined)
				}
				eventsOnlyLockReason={eventsOnlyLockReason(
					typeof editing === "string" ? undefined : (editing ?? undefined),
				)}
				// Which card's Add was pressed. Only a default — the dialog's own
				// control still lets the seller change their mind before saving.
				defaultEventsOnly={editing === "new-venue"}
				retailerId={retailerId}
				currency={currency}
				country={country}
				canChargeFee={hasFeature(subscription, "chargeablePickup")}
			/>
		</div>
	);
}

/** Render order for the weekly editor/summary: Monday-first (MY convention),
 * while the underlying array stays 0 = Sunday (the getUTCDay index). */
const DAY_RENDER_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Editor draft — times as the native input's own "HH:MM" strings so a
 * half-typed value never fights the controlled input; parsed at save.
 * `second` is the optional lunch/dinner split (z8r3fdff8r), null when the day
 * runs straight through. */
type DraftWindow = { openHhmm: string; closeHhmm: string };
type DayDraft = DraftWindow & {
	closed: boolean;
	second: DraftWindow | null;
};

function draftFromHours(initial: OpeningHours | undefined): DayDraft[] {
	const week = initial ?? Array.from({ length: 7 }, () => OPEN_ALL_DAY);
	return week.map((day) => ({
		openHhmm: hhmmFromMinutes(day.open),
		closeHhmm: hhmmFromMinutes(day.close),
		closed: day.closed === true,
		second: hasSecondWindow(day)
			? {
					openHhmm: hhmmFromMinutes(day.open2 as number),
					closeHhmm: hhmmFromMinutes(day.close2 as number),
				}
			: null,
	}));
}

/** The draft as the `DayHours` the server would store — unparseable times come
 * through as NaN on purpose, so `dayHoursIssue` judges the row with the SAME
 * rule-set the save call will, and the seller reads the same sentence here as
 * they would from the server. */
function dayFromDraft(row: DayDraft): DayHours {
	const base: DayHours = {
		open: timeMinutesFromHhmm(row.openHhmm),
		close: timeMinutesFromHhmm(row.closeHhmm),
		...(row.closed ? { closed: true as const } : {}),
	};
	if (!row.second) return base;
	return {
		...base,
		open2: timeMinutesFromHhmm(row.second.openHhmm),
		close2: timeMinutesFromHhmm(row.second.closeHhmm),
	};
}

/** Whether two draft rows describe the same schedule — drives the "same every
 * day" derivation, so a week that shares one SPLIT schedule still reads as
 * "same" rather than being forced into the 7-row editor. */
function sameSchedule(a: DayDraft, b: DayDraft): boolean {
	return (
		a.openHhmm === b.openHhmm &&
		a.closeHhmm === b.closeHhmm &&
		(a.second?.openHhmm ?? null) === (b.second?.openHhmm ?? null) &&
		(a.second?.closeHhmm ?? null) === (b.second?.closeHhmm ?? null)
	);
}

/** Minutes of headroom a second window needs after the first one closes: one
 * minute to start, one to run. */
const SECOND_WINDOW_MIN_HEADROOM = 2;

/** Why this day can't take a second window — or null when it can. Drives a
 * DISABLED-with-reason button rather than a click that quietly does nothing. */
function secondWindowBlockedReason(row: DayDraft): string | null {
	const close = timeMinutesFromHhmm(row.closeHhmm);
	const open = timeMinutesFromHhmm(row.openHhmm);
	if (Number.isNaN(close) || Number.isNaN(open) || open >= close) {
		return "Set a valid first window before adding a second.";
	}
	if (open === 0 && close === MAX_CLOSE_MINUTES) {
		return "This day is already open 24 hours — narrow the first window to add a second.";
	}
	if (close > MAX_CLOSE_MINUTES - SECOND_WINDOW_MIN_HEADROOM) {
		return "The first window runs to the end of the day — close it earlier to add a second.";
	}
	return null;
}

/** Sensible starting times for a newly added second window: a two-hour break,
 * then a six-hour stretch, clamped inside the day. A cafe closing breakfast at
 * 10:00 lands on 12:00 – 6:00 PM, which is the shape that asked for this. */
function suggestSecondWindow(row: DayDraft): DraftWindow {
	const close = timeMinutesFromHhmm(row.closeHhmm);
	const open2 = Math.min(close + 120, MAX_CLOSE_MINUTES - 1);
	const close2 = Math.min(open2 + 360, MAX_CLOSE_MINUTES);
	return {
		openHhmm: hhmmFromMinutes(open2),
		closeHhmm: hhmmFromMinutes(close2),
	};
}

/** One window's two pickers. ONE control for both editor modes (z8r3fdff8r):
 * "same every day" and the 7-row grid express the identical idea, so they use
 * the identical component — two shapes for one concept is how a settings tab
 * starts looking like two settings tabs. */
function WindowPickers({
	window,
	onChange,
	disabled,
	isError,
	showIcon = true,
	ariaPrefix,
	windowLabel,
}: {
	window: DraftWindow;
	onChange: (patch: Partial<DraftWindow>) => void;
	disabled: boolean;
	isError: boolean;
	showIcon?: boolean;
	/** "Monday " in the per-day grid, "" in same-every-day mode. */
	ariaPrefix: string;
	/** "second window " once a day is split, "" while it runs straight
	 * through — so an unsplit store's labels read exactly as they always did. */
	windowLabel: string;
}) {
	// "Opening time" / "Monday opening time" / "Monday second window closing
	// time" — the prefix-less form is sentence-cased so an unsplit store's
	// labels read exactly as they always did.
	const ariaLabel = (which: "opening" | "closing") => {
		const raw = `${ariaPrefix}${windowLabel}${which} time`;
		return ariaPrefix ? raw : capitalizeFirst(raw);
	};
	return (
		<div className="flex min-w-0 flex-1 items-center gap-1.5">
			<TimePicker
				value={window.openHhmm}
				onChange={(next) => onChange({ openHhmm: next })}
				disabled={disabled}
				isError={isError}
				showIcon={showIcon}
				aria-label={ariaLabel("opening")}
				className="min-w-0 flex-1"
			/>
			<span className="shrink-0 text-muted-foreground" aria-hidden="true">
				–
			</span>
			<TimePicker
				value={window.closeHhmm}
				onChange={(next) => onChange({ closeHhmm: next })}
				disabled={disabled}
				isError={isError}
				showIcon={showIcon}
				aria-label={ariaLabel("closing")}
				className="min-w-0 flex-1"
			/>
		</div>
	);
}

/**
 * "+ Add a second window" and "× Remove second window": ONE control, in the
 * same place under a day's windows, in both editor modes. Adding and taking
 * away the split happen where it is read, and neither parks a 44px button
 * beside the pickers — that column cost each picker 25px, which on a 360px
 * phone cut every time to "6:30 …" and hid the AM/PM a split schedule is
 * about.
 *
 * Add is disabled WITH ITS REASON where the day can't take a second window —
 * a click that quietly does nothing is the thing this exists to avoid. Both
 * are full 44px targets, pulled back to text height with negative margins so
 * the column keeps its rhythm.
 */
function SecondWindowButton({
	action,
	blockedReason = null,
	dayName,
	disabled,
	onClick,
}: {
	action: "add" | "remove";
	blockedReason?: string | null;
	/** Per-day rows only: names the day for assistive tech, since seven rows
	 * carry the same visible label. */
	dayName?: string;
	disabled: boolean;
	onClick: () => void;
}) {
	const Icon = action === "add" ? Plus : X;
	const label =
		action === "add" ? "Add a second window" : "Remove second window";
	return (
		<div className="flex flex-col gap-1">
			<button
				type="button"
				onClick={onClick}
				disabled={disabled || blockedReason !== null}
				title={blockedReason ?? undefined}
				// The spoken name STARTS with the visible label, so voice control
				// ("click Remove second window") still finds it.
				aria-label={dayName ? `${label} on ${dayName}` : undefined}
				className={cn(
					"-my-2.5 flex min-h-11 items-center gap-1 self-start rounded-lg text-xs font-medium underline-offset-2 hover:underline disabled:pointer-events-none disabled:no-underline",
					action === "add"
						? "text-accent disabled:text-muted-foreground"
						: "text-muted-foreground hover:text-destructive",
				)}
			>
				<Icon className="size-3.5" aria-hidden="true" />
				{label}
			</button>
			{blockedReason ? (
				<span className="text-xs text-muted-foreground">{blockedReason}</span>
			) : null}
		</div>
	);
}

/** A day's rule sentence, placed directly under the window it is about. */
function WindowIssueLine({ issue }: { issue: DayHoursIssue }) {
	return (
		<p className="text-xs text-destructive">
			{capitalizeFirst(issue.message)}.
		</p>
	);
}

/** The consequence of a split, in the seller's own numbers: what buyers will
 * be kept OUT of. Only rendered for a valid split day — the error line speaks
 * for an invalid one. `compact` drops the explanation in the 7-row grid, where
 * the full sentence would repeat under every split day; same-every-day states
 * it once, in full.  */
function BreakLine({
	row,
	compact = false,
}: {
	row: DayDraft;
	compact?: boolean;
}) {
	if (!row.second || row.closed) return null;
	const day = dayFromDraft(row);
	if (dayHoursIssue(day) !== null) return null;
	const gaps = dayGaps(day);
	if (gaps.length === 0) return null;
	return (
		<p className="text-xs text-muted-foreground">
			Closed{" "}
			{gaps.map((gap, i) => (
				<Fragment key={gap.open}>
					{i > 0 ? " and " : null}
					<TimeRange range={gap} />
				</Fragment>
			))}
			{compact ? null : " — buyers can't pick a time in between."}
		</p>
	);
}

/** Sentence-case a rule message that is written to follow a weekday prefix. */
function capitalizeFirst(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Tuesday", "Tuesday and Friday", "Monday, Tuesday and Friday". Days come in
 * render order (Monday first), as the grid shows them. */
function joinDayNames(indexes: number[]): string {
	const names = indexes.map((i) => WEEKDAY_NAMES[i]);
	if (names.length <= 1) return names.join("");
	return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Store opening hours (86eyp5rav) — the weekly schedule buyers' fulfilment
 * dates/times must fall inside. Sits first in the tab: it's the most
 * fundamental checkout-wide timing rule (when the store operates at all),
 * above the notice window. Default (unset) = open 24/7; the server normalizes
 * an all-24h week back to unset and rejects an all-closed one.
 */
function OpeningHoursCard({ initial }: { initial: OpeningHours | undefined }) {
	const updateSettings = useUpdateSettings();
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState<DayDraft[]>(() => draftFromHours(initial));
	// "Same every day" (one range + day chips — the overwhelmingly common
	// schedule) vs "Different per day" (the 7-row editor). Derived on entry:
	// a schedule whose OPEN days all share one range reads as "same".
	const [mode, setMode] = useState<"same" | "perDay">("same");
	// The weekday whose hours "Same every day" just copied over days that were
	// different. Drives the note that says so. Null when nothing was replaced.
	const [unifiedFrom, setUnifiedFrom] = useState<string | null>(null);
	// The per-day hours that unifying replaced, kept so switching back restores
	// them — saved or not. Without it the note could only point at Cancel,
	// which restores the SAVED week and so threw away per-day hours typed in
	// this session while promising to keep them.
	const [perDayBeforeUnify, setPerDayBeforeUnify] = useState<DayDraft[] | null>(
		null,
	);
	const [saving, setSaving] = useState(false);

	const configured = initial !== undefined;

	function startEditing() {
		const rows = draftFromHours(initial);
		const open = rows.filter((row) => !row.closed);
		setMode(
			open.every((row) => sameSchedule(row, open[0])) ? "same" : "perDay",
		);
		setDraft(rows);
		setUnifiedFrom(null);
		setPerDayBeforeUnify(null);
		setEditing(true);
	}

	function setDay(index: number, patch: Partial<DayDraft>) {
		setDraft((prev) =>
			prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
		);
	}

	/** Same-mode range edit — one pair of pickers writes every day's times
	 * (closed days included, so re-opening a chip inherits the range). Also
	 * carries the second window, so adding a lunch break is ONE action for the
	 * whole week rather than seven (z8r3fdff8r). */
	function setAllDays(
		patch: Partial<Pick<DayDraft, "openHhmm" | "closeHhmm" | "second">>,
	) {
		setDraft((prev) => prev.map((row) => ({ ...row, ...patch })));
	}

	/** Per-day second-window edit — patches just that row's second window. */
	function setSecond(index: number, patch: Partial<DraftWindow>) {
		setDraft((prev) =>
			prev.map((row, i) =>
				i === index && row.second
					? { ...row, second: { ...row.second, ...patch } }
					: row,
			),
		);
	}

	/** Switching to "same" unifies every day onto the first open day's hours.
	 * When the days actually differed, that replaces the others' windows, so it
	 * is SAID in a note under the mode buttons rather than only being visible
	 * in pickers that show one day (z8r3fdff8r: a second window per day made
	 * the silent version cost more) — and the replaced week is kept, so
	 * switching back to "Different per day" puts every day's own hours back. */
	function switchMode(next: "same" | "perDay") {
		// Re-tapping the active mode must not re-run the unify: the week is
		// already uniform, so it would read as "nothing replaced" and drop the
		// kept per-day hours along with the note.
		if (next === mode) return;
		if (next === "same") {
			const sourceIndex = DAY_RENDER_ORDER.find((i) => !draft[i].closed) ?? 1;
			const source = draft[sourceIndex];
			const differed = draft.some(
				(row) => !row.closed && !sameSchedule(row, source),
			);
			setUnifiedFrom(differed ? WEEKDAY_NAMES[sourceIndex] : null);
			setPerDayBeforeUnify(differed ? draft : null);
			setAllDays({
				openHhmm: source.openHhmm,
				closeHhmm: source.closeHhmm,
				second: source.second ? { ...source.second } : null,
			});
		} else {
			if (perDayBeforeUnify) setDraft(perDayBeforeUnify);
			setPerDayBeforeUnify(null);
			setUnifiedFrom(null);
		}
		setMode(next);
	}

	// One rule-set, one sentence: `dayHoursIssue` is the SAME rule-set
	// sanitizeOpeningHours runs on save, so the inline copy here and the server's
	// refusal can never drift. It also says WHICH window is wrong, so only that
	// window's pickers turn red and the sentence sits under it (z8r3fdff8r).
	const dayIssues = draft.map((row) =>
		row.closed ? null : dayHoursIssue(dayFromDraft(row)),
	);
	const invalidDays = DAY_RENDER_ORDER.filter((i) => dayIssues[i] !== null);
	const allClosed = draft.every((row) => row.closed);
	const valid = invalidDays.length === 0 && !allClosed;
	// Same-mode reads its range off the first open row (all rows are kept in
	// sync); when every chip is off, fall back to Monday so the pickers keep
	// showing the last times instead of blanking.
	const rangeSource =
		draft[DAY_RENDER_ORDER.find((i) => !draft[i].closed) ?? 1];
	// Every row holds the same hours in this mode, so the source row's issue
	// is the week's.
	const sameIssue = allClosed ? null : dayHoursIssue(dayFromDraft(rangeSource));

	async function save() {
		if (!valid) return;
		setSaving(true);
		try {
			await updateSettings({
				openingHours: draft.map((row, i) => {
					const day = dayFromDraft(row);
					if (dayHoursIssue(day) === null) return day;
					// Only reachable for a CLOSED row holding an unparseable range
					// the seller never looked at (`valid` gates every open one) —
					// persist its last-known-good times (or all-day) so re-opening
					// the day restores something sensible.
					return initial?.[i]
						? { ...initial[i], closed: true }
						: { ...OPEN_ALL_DAY, closed: true };
				}),
			});
			toast.success("Opening hours updated.");
			setEditing(false);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	/** Back to open 24/7 as a DRAFT, not a save. It used to save on the spot,
	 * one tap beside Cancel, so a slip wiped a whole split week (up to fourteen
	 * windows) with no confirm and no undo. Now the pickers show the result,
	 * Save commits it — the server stores an all-day week as unset, exactly what
	 * the old instant clear wrote — and Cancel takes it back. */
	function resetDraftTo247() {
		setDraft(draftFromHours(undefined));
		setMode("same");
		setUnifiedFrom(null);
		setPerDayBeforeUnify(null);
	}
	// Nothing to reset once the draft already IS open 24/7, so the control
	// isn't offered — rather than a tap that visibly does nothing.
	const draftIsOpen247 = draft.every(
		(row) =>
			!row.closed &&
			row.second === null &&
			timeMinutesFromHhmm(row.openHhmm) === 0 &&
			timeMinutesFromHhmm(row.closeHhmm) === MAX_CLOSE_MINUTES,
	);

	return (
		<div className="flex flex-col gap-4">
			<p className="text-xs text-muted-foreground">
				Buyers can order any time, but only pick a delivery or pickup slot
				inside these hours. Counter sales aren&apos;t affected.
			</p>
			{!editing ? (
				<>
					{configured ? (
						<ul className="flex flex-col gap-1 text-sm tabular-nums">
							{DAY_RENDER_ORDER.map((i) => {
								const day = initial[i];
								return (
									<li key={WEEKDAY_NAMES[i]} className="flex justify-between">
										<span className="text-muted-foreground">
											{WEEKDAY_NAMES_SHORT[i]}
										</span>
										{/* Stacked like the storefront's schedule dialog,
										    so a split day reads the same on both sides
										    and never wraps mid-range on a phone. */}
										<span
											className={
												day.closed ? "text-muted-foreground" : "font-medium"
											}
										>
											{day.closed ? "Closed" : <DayWindowsStacked day={day} />}
										</span>
									</li>
								);
							})}
						</ul>
					) : (
						<p className="text-sm text-muted-foreground">
							Open 24 hours, every day — buyers can pick any date and time.
						</p>
					)}
					<div>
						<Button
							type="button"
							variant={configured ? "outline" : "default"}
							onClick={startEditing}
							className="h-11"
						>
							{configured ? "Edit hours" : "Set opening hours"}
						</Button>
					</div>
				</>
			) : (
				<>
					{/* Same-every-day is the overwhelmingly common schedule, so it
					    leads and is the default — the 7-row editor is the escape
					    hatch, not the entry fee. KindButton pattern (pickup dialog). */}
					<div className="grid grid-cols-2 gap-2">
						<ModeButton
							active={mode === "same"}
							onClick={() => switchMode("same")}
							title="Same every day"
							subtitle="One set of hours for the whole week"
						/>
						<ModeButton
							active={mode === "perDay"}
							onClick={() => switchMode("perDay")}
							title="Different per day"
							subtitle="Set each day's hours individually"
						/>
					</div>
					{mode === "same" && unifiedFrom ? (
						<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
							Every day now uses {unifiedFrom}&apos;s hours. Switch back to
							Different per day to restore each day&apos;s own hours.
						</p>
					) : null}
					{mode === "same" ? (
						<>
							<div className="flex flex-col gap-2">
								{/* The window label only appears once a day is SPLIT —
								    an unsplit store has one range and needs no heading
								    telling it so. */}
								{rangeSource.second ? (
									<span className="text-xs font-medium text-muted-foreground">
										First window
									</span>
								) : null}
								<WindowPickers
									window={rangeSource}
									onChange={(patch) => setAllDays(patch)}
									disabled={saving}
									isError={sameIssue?.window === "first"}
									showIcon={false}
									ariaPrefix=""
									windowLabel={rangeSource.second ? "first window " : ""}
								/>
								{/* Each rule's sentence sits directly under the window
								    it is about. Printed after both rows, a first-window
								    error read as a complaint about the second. */}
								{sameIssue?.window === "first" ? (
									<WindowIssueLine issue={sameIssue} />
								) : null}
								{rangeSource.second ? (
									<>
										<span className="text-xs font-medium text-muted-foreground">
											Second window
										</span>
										<WindowPickers
											window={rangeSource.second}
											onChange={(patch) =>
												setAllDays({
													second: {
														...(rangeSource.second as DraftWindow),
														...patch,
													},
												})
											}
											disabled={saving}
											isError={sameIssue?.window === "second"}
											showIcon={false}
											ariaPrefix=""
											windowLabel="second window "
										/>
										{sameIssue?.window === "second" ? (
											<WindowIssueLine issue={sameIssue} />
										) : (
											<BreakLine row={rangeSource} />
										)}
										<SecondWindowButton
											action="remove"
											disabled={saving}
											onClick={() => setAllDays({ second: null })}
										/>
									</>
								) : (
									<SecondWindowButton
										action="add"
										blockedReason={secondWindowBlockedReason(rangeSource)}
										disabled={saving}
										onClick={() =>
											setAllDays({ second: suggestSecondWindow(rangeSource) })
										}
									/>
								)}
							</div>
							{/* Tap a day off for the weekly rest day — chips, not 7
							    toggle rows, because open/closed is the ONLY per-day
							    fact left in this mode. */}
							<div className="flex flex-col gap-1.5">
								<span className="text-xs font-medium text-muted-foreground">
									Open on
								</span>
								<div className="flex flex-wrap gap-1.5">
									{DAY_RENDER_ORDER.map((i) => (
										<FilterChip
											key={WEEKDAY_NAMES[i]}
											tone="accent"
											selected={!draft[i].closed}
											disabled={saving}
											aria-label={WEEKDAY_NAMES[i]}
											onClick={() => setDay(i, { closed: !draft[i].closed })}
											className="px-3"
										>
											{WEEKDAY_NAMES_SHORT[i]}
										</FilterChip>
									))}
								</div>
							</div>
						</>
					) : (
						// Phones stack each day: name + switch on one line, the range
						// full-width beneath. Side-by-side needs ~340px for the two
						// pickers alone, so a 430px phone truncated them to "12…";
						// the hairline separators keep the two-line rows from
						// reading as one run-on list. One line again from sm.
						<div className="flex flex-col gap-3 sm:gap-2.5">
							{DAY_RENDER_ORDER.map((i) => {
								const row = draft[i];
								const rowIssue = dayIssues[i];
								return (
									<div
										key={WEEKDAY_NAMES[i]}
										className="flex flex-col gap-2 border-b border-border/60 pb-3 last:border-0 last:pb-0 sm:flex-row sm:items-start sm:gap-2.5 sm:border-0 sm:pb-3"
									>
										<div className="flex items-center gap-2.5 sm:h-11">
											<span className="w-10 shrink-0 text-sm font-medium">
												{WEEKDAY_NAMES_SHORT[i]}
											</span>
											<ToggleSwitch
												on={!row.closed}
												onChange={(open) => setDay(i, { closed: !open })}
												disabled={saving}
												label={`Open on ${WEEKDAY_NAMES[i]}`}
											/>
											{row.closed ? (
												<span className="text-sm text-muted-foreground">
													Closed
												</span>
											) : null}
										</div>
										{row.closed ? null : (
											// A split day (z8r3fdff8r) stacks its windows in
											// this column, so the day name + switch stay put.
											// Both windows run full width, with no remove column
											// beside the pickers (see SecondWindowButton), so every
											// row's pickers are one width and the grid stays aligned.
											<div className="flex min-w-0 flex-1 flex-col gap-1.5">
												<WindowPickers
													window={row}
													onChange={(patch) => setDay(i, patch)}
													disabled={saving}
													isError={rowIssue?.window === "first"}
													showIcon={false}
													ariaPrefix={`${WEEKDAY_NAMES[i]} `}
													windowLabel={row.second ? "first window " : ""}
												/>
												{rowIssue?.window === "first" ? (
													<WindowIssueLine issue={rowIssue} />
												) : null}
												{row.second ? (
													<>
														<WindowPickers
															window={row.second}
															onChange={(patch) => setSecond(i, patch)}
															disabled={saving}
															isError={rowIssue?.window === "second"}
															showIcon={false}
															ariaPrefix={`${WEEKDAY_NAMES[i]} `}
															windowLabel="second window "
														/>
														{rowIssue?.window === "second" ? (
															<WindowIssueLine issue={rowIssue} />
														) : (
															<BreakLine row={row} compact />
														)}
														<SecondWindowButton
															action="remove"
															dayName={WEEKDAY_NAMES[i]}
															disabled={saving}
															onClick={() => setDay(i, { second: null })}
														/>
													</>
												) : (
													<SecondWindowButton
														action="add"
														blockedReason={secondWindowBlockedReason(row)}
														dayName={WEEKDAY_NAMES[i]}
														disabled={saving}
														onClick={() =>
															setDay(i, { second: suggestSecondWindow(row) })
														}
													/>
												)}
											</div>
										)}
									</div>
								);
							})}
						</div>
					)}
					<p className="text-xs text-muted-foreground">
						12:00 AM – 11:59 PM means open all day.
					</p>
					{mode === "perDay" && invalidDays.length > 0 ? (
						// Save sits below seven rows, so a disabled Save names the
						// rows to fix. The sentences themselves are on those rows,
						// which may be scrolled out of view.
						<p className="text-xs text-destructive">
							Fix the hours for {joinDayNames(invalidDays)} to save.
						</p>
					) : allClosed ? (
						<p className="text-xs text-destructive">
							Keep at least one day open — buyers need a day they can pick at
							checkout.
						</p>
					) : null}
					<div className="flex flex-wrap items-center gap-3">
						<Button
							type="button"
							onClick={save}
							disabled={!valid || saving}
							isLoading={saving}
							className="h-11"
						>
							Save hours
						</Button>
						<Button
							type="button"
							variant="outline"
							onClick={() => setEditing(false)}
							disabled={saving}
							className="h-11"
						>
							Cancel
						</Button>
						{!draftIsOpen247 ? (
							<button
								type="button"
								onClick={resetDraftTo247}
								disabled={saving}
								className="min-h-11 text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
							>
								Reset to open 24/7
							</button>
						) : null}
					</div>
				</>
			)}
		</div>
	);
}

/**
 * Order-date notice setting — how many days ahead a buyer's chosen fulfilment
 * date must be. Governs the storefront date picker's earliest selectable day
 * (and counter checkout's default). Sits with the other checkout-wide timing
 * rules at the top of the tab (below Opening hours): it applies to BOTH
 * delivery and pickup, above the per-method toggles. 0 = same-day allowed
 * (ready-stock sellers).
 */
function MinNoticeCard({ initial }: { initial: number | undefined }) {
	const updateSettings = useUpdateSettings();
	const effective = initial ?? DEFAULT_MIN_NOTICE_DAYS;
	const [value, setValue] = useState(String(effective));
	const [saving, setSaving] = useState(false);

	const parsed = Number(value);
	const valid =
		value.trim().length > 0 &&
		Number.isInteger(parsed) &&
		parsed >= 0 &&
		parsed <= MAX_NOTICE_DAYS;
	const dirty = valid && parsed !== effective;

	async function save() {
		if (!dirty) return;
		setSaving(true);
		try {
			await updateSettings({ minFulfilmentNoticeDays: parsed });
			toast.success("Minimum notice updated.");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<p className="text-xs text-muted-foreground">
				Buyers can&apos;t pick a delivery or pickup date sooner than this — 0
				takes same-day orders. An item that needs hours, not days, takes a prep
				time on the product instead.
			</p>
			<div className="flex items-end gap-3">
				<div className="flex flex-col gap-1.5">
					<label
						htmlFor="min-notice"
						className="text-xs font-medium text-muted-foreground"
					>
						Minimum days&apos; notice
					</label>
					<Input
						id="min-notice"
						type="number"
						inputMode="numeric"
						min={0}
						max={MAX_NOTICE_DAYS}
						value={value}
						onChange={(e) => setValue(e.target.value)}
						variant="field"
						isError={value.trim().length > 0 && !valid}
						className="w-28"
					/>
				</div>
				<Button
					type="button"
					onClick={save}
					disabled={!dirty || saving}
					isLoading={saving}
					className="h-11"
				>
					Save
				</Button>
			</div>
			{value.trim().length > 0 && !valid ? (
				<p className="text-xs text-destructive">
					Enter a whole number between 0 and {MAX_NOTICE_DAYS}.
				</p>
			) : null}
		</div>
	);
}

/**
 * The store's own physical address — where parcels are sent FROM.
 *
 * Its own card, always visible, because two unrelated features consume it and
 * neither is a pricing choice: distance pricing measures from it, and it is
 * the **return address printed on every despatch label**. It used to live
 * inside the radius and Lalamove mode panels — duplicated once each — which
 * meant a Singapore store could never set one at all, since both of those
 * modes are Malaysia-only and don't render there. An SG seller shipping
 * parcels therefore had no way to put a return address on a label (86eyqgujv).
 *
 * One editor, one save — a row in the Delivery card. The delivery-pricing
 * page reads the stored value and links back here rather than carrying a
 * second copy of the picker.
 */
function BusinessAddressCard({
	country,
	businessAddress,
}: {
	country: Country;
	businessAddress: BusinessAddress | undefined;
}) {
	const updateSettings = useUpdateSettings();
	const [picked, setPicked] = useState<GoogleSelectedAddress | null>(null);
	// Unit / floor / building (z8r3fdff8r) — typed, not picked: Google's
	// formatted address stops at the block, which is where riders were stopping
	// too. Local state so editing it alone is a saveable change; a fresh pin is
	// no longer the only reason this card has work to do.
	const [unit, setUnit] = useState(businessAddress?.unit ?? "");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Judged with the SERVER's normalizer, so "is this a change?" and "what
	// gets stored" are one rule. With a plain trim, a saved "Unit 3-1,   Block
	// B" still differed from the stored "Unit 3-1, Block B", which left Save
	// lit and the field showing the unsaved spelling after a successful save
	// (z8r3fdff8r).
	const normalizedUnit = sanitizeUnitLine(unit);
	const unitTooLong = !normalizedUnit.ok;
	const unitValue = normalizedUnit.ok ? normalizedUnit.value : undefined;
	const unitDirty = (unitValue ?? "") !== (businessAddress?.unit ?? "");
	// The unit rides in front of an address, so without one (saved or just
	// picked) there is nothing to attach it to. The field waits, and says why,
	// rather than accepting typing that Save then silently refuses.
	const hasAddress = businessAddress !== undefined || picked !== null;
	// Saveable when there's a new pin, OR when only the unit line moved on an
	// address that already exists.
	const canSave =
		!unitTooLong &&
		(picked !== null || (businessAddress !== undefined && unitDirty));

	async function save() {
		const base = picked
			? {
					label: picked.formattedAddress,
					latitude: picked.latitude,
					longitude: picked.longitude,
					placeId: picked.placeId,
				}
			: businessAddress
				? {
						label: businessAddress.label,
						latitude: businessAddress.latitude,
						longitude: businessAddress.longitude,
						placeId: businessAddress.placeId,
					}
				: null;
		if (!base) return;
		setSaving(true);
		setError(null);
		try {
			await updateSettings({
				businessAddress: { ...base, unit: unitValue },
			});
			setPicked(null);
			// Show what was stored, not what was typed.
			setUnit(unitValue ?? "");
			toast.success("Business address saved.");
		} catch (err) {
			setError(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<p className="text-xs text-muted-foreground">
				Where you send parcels from — buyers never see it.
			</p>
			<InfoDisclosure summary="Where it's used">
				<HelperBullets
					items={[
						"The return address on your despatch labels",
						"Where riders are sent to collect",
						"Where distance pricing measures from",
					]}
				/>
			</InfoDisclosure>
			<div className="flex flex-col gap-1.5">
				<GoogleAddressAutocomplete
					country={country}
					initialValue={businessAddress?.label ?? ""}
					label="Address"
					placeholder="Start typing your business address…"
					description={
						picked
							? "Pinned — save to use it."
							: businessAddress
								? "✓ Pinned. Search again to replace it."
								: "Pick a Google suggestion so we get an exact pin — your stall, kitchen or shop."
					}
					onSelect={(payload) => setPicked(payload)}
					onTextChange={() => setPicked(null)}
				/>
				{businessAddress && !picked ? (
					<p className="flex items-center gap-1.5 text-xs text-muted-foreground">
						<MapPin
							className="size-3 shrink-0 text-accent"
							aria-hidden="true"
						/>
						<span className="font-mono">
							{businessAddress.latitude.toFixed(5)},{" "}
							{businessAddress.longitude.toFixed(5)}
						</span>
					</p>
				) : null}
			</div>
			{/* Sits UNDER the autocomplete, not inside it: Google owns the
			    building, the seller owns the door. Typing here never disturbs
			    the pin — the coordinates keep pricing distance either way. */}
			<div className="flex flex-col gap-1.5">
				<label
					htmlFor="business-address-unit"
					className="text-xs font-medium text-muted-foreground"
				>
					Unit / floor / building{" "}
					<span className="font-normal">(optional)</span>
				</label>
				<Input
					id="business-address-unit"
					value={unit}
					onChange={(e) => setUnit(e.target.value)}
					maxLength={UNIT_LINE_MAX_LENGTH}
					variant="field"
					isError={unitTooLong}
					disabled={!hasAddress || saving}
					placeholder="Unit 3-1, Block B"
					autoComplete="off"
					aria-describedby="business-address-unit-hint"
				/>
				<p
					id="business-address-unit-hint"
					className="text-xs text-muted-foreground"
				>
					{hasAddress ? (
						<>
							Rides in front of the address above, everywhere it&apos;s printed
							— the part Google&apos;s suggestion leaves out, and the reason
							riders end up phoning you from the car park. Up to{" "}
							{UNIT_LINE_MAX_LENGTH} characters.
						</>
					) : (
						"Pick your address first — the unit rides in front of it."
					)}
				</p>
			</div>
			{error ? <p className="text-xs text-destructive">{error}</p> : null}
			<Button
				type="button"
				onClick={save}
				disabled={!canSave || saving}
				isLoading={saving}
				className="h-11 lg:w-auto lg:self-start lg:px-5"
			>
				Save address
			</Button>
		</div>
	);
}

/**
 * Store-wide minimum order value (86ey9unyx) — the item subtotal a storefront
 * order must reach before checkout. Sits with the other order rules (next to
 * the date-notice card). Counter checkout is exempt; orders with a custom /
 * price-on-quote line are exempt (their value is settled by the seller's
 * quote). Blank or 0 = no minimum.
 */
function MinOrderValueCard({
	initial,
	currency,
}: {
	initial: number | undefined;
	currency: string;
}) {
	const updateSettings = useUpdateSettings();
	const effective = initial ?? 0;
	const [value, setValue] = useState(
		effective > 0 ? (effective / 100).toFixed(2) : "",
	);
	const [saving, setSaving] = useState(false);

	const trimmed = value.trim();
	const parsed = trimmed.length === 0 ? 0 : parsePriceInput(trimmed);
	const sen = parsed === null ? null : Math.round(parsed * 100);
	const valid = sen !== null && sen >= 0 && sen <= MIN_ORDER_VALUE_MAX;
	const dirty = valid && sen !== effective;

	async function save() {
		if (!dirty || sen === null) return;
		setSaving(true);
		try {
			await updateSettings({ minOrderValue: sen });
			toast.success(
				sen === 0
					? "Minimum order value cleared."
					: `Minimum order value set to ${formatPrice(sen, currency)}.`,
			);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<p className="text-xs text-muted-foreground">
				The subtotal a buyer must reach to check out, before delivery or pickup
				fees. Leave blank for none.
			</p>
			<InfoDisclosure summary="How the minimum works">
				<HelperBullets
					items={[
						"The storefront shows buyers exactly how much more to add",
						"Counter checkout and custom price-on-quote orders are never blocked",
					]}
				/>
			</InfoDisclosure>
			<div className="flex items-end gap-3">
				<div className="flex flex-col gap-1.5">
					<label
						htmlFor="min-order-value"
						className="text-xs font-medium text-muted-foreground"
					>
						Minimum subtotal ({currencySymbol(currency)})
					</label>
					<Input
						id="min-order-value"
						type="text"
						inputMode="decimal"
						placeholder="e.g. 100"
						value={value}
						onChange={(e) => setValue(e.target.value)}
						onBlur={() => setValue(normalizePriceInput(value))}
						variant="field"
						isError={trimmed.length > 0 && !valid}
						className="w-32"
					/>
				</div>
				<Button
					type="button"
					onClick={save}
					disabled={!dirty || saving}
					isLoading={saving}
					className="h-11"
				>
					Save
				</Button>
			</div>
			{trimmed.length > 0 && !valid ? (
				<p className="text-xs text-destructive">
					Enter an amount up to {formatPrice(MIN_ORDER_VALUE_MAX, currency)}, or
					leave blank for no minimum.
				</p>
			) : null}
		</div>
	);
}

/**
 * Body of a pickup row (icon + label/address/link/notes + action bar). Used
 * inside both row variants below; takes an optional leading slot for the
 * drag handle so the sortable variant can inject one without re-implementing
 * the rest of the layout.
 */
function LocationRowBody({
	location,
	currency,
	onEdit,
	onToggleActive,
	dragHandle,
	eventNames,
}: {
	location: Doc<"pickupLocations">;
	currency: string;
	onEdit: () => void;
	onToggleActive: (next: boolean) => void;
	dragHandle?: ReactNode;
	/** Live events this point hosts as their venue (`z8r3fdff9u`). Stated on
	 * the row because hiding the point does NOT unhost them. */
	eventNames?: string[];
}) {
	return (
		<>
			<div className="flex items-start gap-3">
				{dragHandle}
				<MapPin
					className="size-4 shrink-0 text-accent mt-0.5"
					aria-hidden="true"
				/>
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<div className="flex flex-wrap items-center gap-2">
						<p className="text-sm font-semibold leading-tight">
							{location.label}
						</p>
						<PickupKindBadge kind={location.locationType ?? "self_collect"} />
						{location.fee && location.fee > 0 ? (
							<span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
								+ {formatPrice(location.fee, currency)} fee
							</span>
						) : null}
					</div>
					{/* The unit line rides in front of the address (z8r3fdff8r) —
					    the seller reads back exactly what the buyer will. */}
					<p className="text-xs text-muted-foreground whitespace-pre-line">
						{formatPickupAddress(location)}
					</p>
					{location.scheduleNote ? (
						<p className="flex items-center gap-1 text-xs font-medium text-accent">
							<Clock className="size-3 shrink-0" aria-hidden="true" />
							<span>{location.scheduleNote}</span>
						</p>
					) : null}
					{/* An event's venue rides this point (`z8r3fdff9u`) — named here
					    so "hide" is never mistaken for "gone everywhere": a hidden
					    point still hosts its events. */}
					{eventNames !== undefined && eventNames.length > 0 ? (
						<p className="flex items-start gap-1 text-xs font-medium text-accent">
							<CalendarClock
								className="mt-0.5 size-3 shrink-0"
								aria-hidden="true"
							/>
							<span>
								Event venue: {eventNames.slice(0, 2).join(", ")}
								{eventNames.length > 2 ? ` +${eventNames.length - 2} more` : ""}
								{location.isActive
									? ""
									: " — guests are still sent here while it's hidden."}
							</span>
						</p>
					) : null}
					{/* The fee chip above says "+ RM 5.00" and this point hosts an
					    event, which never charges it. Leaving the two side by side
					    means the seller collects RM0 on every RSVP while their own
					    row advertises a charge — the same lie the buyer's venue card
					    was fixed for, on the side that CONFIGURED it (z8r3fdjgvd).

					    Its own line, not appended to the event names: "…Into The
					    Falls 2026 Event guests aren't charged…" ran the listing
					    straight into the rule and read as a garden path. */}
					{eventNames !== undefined &&
					eventNames.length > 0 &&
					location.fee &&
					location.fee > 0 ? (
						<p className="text-xs text-muted-foreground">
							Event guests aren&apos;t charged the fee — they&apos;re attending,
							not collecting.
						</p>
					) : null}
					{(() => {
						const mapsUrl = deriveMapsUrl(location);
						return mapsUrl ? (
							<a
								href={mapsUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center gap-1 self-start text-xs font-medium text-accent underline-offset-2 hover:underline"
							>
								<ExternalLink className="size-3" />
								Open in maps
							</a>
						) : null;
					})()}
					{location.notes ? (
						<p className="text-xs text-muted-foreground whitespace-pre-line wrap-break-word">
							<LinkifiedText text={location.notes} />
						</p>
					) : null}
					{location.managerName || location.managerWaPhone ? (
						// MASK_PII: the manager is a third party — their name + phone
						// shouldn't ride session replay.
						<p
							{...MASK_PII}
							className="flex items-center gap-1 text-xs text-muted-foreground"
						>
							<Phone
								className="size-3 shrink-0 text-accent"
								aria-hidden="true"
							/>
							<span>
								Manager: {location.managerName ?? "—"}
								{location.managerWaPhone
									? ` · ${formatPhone(location.managerWaPhone)}`
									: ""}
							</span>
						</p>
					) : null}
				</div>
			</div>
			<div className="flex items-center justify-between gap-2 border-t border-border pt-3">
				<button
					type="button"
					onClick={onEdit}
					aria-label={`Edit ${location.label}`}
					className="flex h-11 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
				>
					<Pencil className="size-3.5" />
					Edit
				</button>
				<div className="flex items-center gap-2">
					<span className="text-xs text-muted-foreground">
						{location.isActive ? "Active" : "Hidden"}
					</span>
					<ToggleSwitch
						on={location.isActive}
						onChange={onToggleActive}
						label={`Toggle active state of ${location.label}`}
					/>
				</div>
			</div>
		</>
	);
}

/**
 * Plain (non-draggable) variant for inactive rows. No grip handle — inactive
 * rows live behind the "Show inactive" collapsible and aren't part of the
 * sortable set.
 */
function LocationRow({
	location,
	currency,
	onEdit,
	onToggleActive,
	eventNames,
}: {
	location: Doc<"pickupLocations">;
	currency: string;
	onEdit: () => void;
	onToggleActive: (next: boolean) => void;
	eventNames?: string[];
}) {
	return (
		<li className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 opacity-60">
			<LocationRowBody
				location={location}
				currency={currency}
				onEdit={onEdit}
				onToggleActive={onToggleActive}
				eventNames={eventNames}
			/>
		</li>
	);
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
	return (
		<div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-4 py-8 text-center">
			<MapPin className="size-6 text-muted-foreground" aria-hidden="true" />
			<div className="flex flex-col gap-1">
				<p className="text-sm font-medium">No pickup locations yet</p>
				<p className="text-xs text-muted-foreground">
					Add a place buyers can collect their orders from.
				</p>
			</div>
			<Button
				type="button"
				onClick={onAdd}
				size="sm"
				variant="outline"
				className="h-10 gap-1.5"
			>
				<Plus className="size-4" />
				Add pickup location
			</Button>
		</div>
	);
}

function LocationListSkeleton() {
	return (
		<ul className="flex flex-col gap-2">
			{[0, 1].map((n) => (
				<li
					key={n}
					className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4"
				>
					<div className="flex items-start gap-3">
						<Skeleton className="size-4 rounded-full" />
						<div className="flex flex-1 flex-col gap-2">
							<Skeleton className="h-4 w-32" />
							<Skeleton className="h-3 w-48" />
						</div>
					</div>
					<div className="flex items-center justify-between border-t border-border pt-3">
						<div className="flex gap-1">
							<Skeleton className="size-11 rounded-lg" />
							<Skeleton className="size-11 rounded-lg" />
							<Skeleton className="h-11 w-16 rounded-lg" />
						</div>
						<Skeleton className="h-7 w-12 rounded-full" />
					</div>
				</li>
			))}
		</ul>
	);
}
