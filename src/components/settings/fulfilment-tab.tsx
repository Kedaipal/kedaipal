import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import {
	Clock,
	ExternalLink,
	MapPin,
	Pencil,
	Phone,
	Plus,
	Trash2,
	Truck,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { MY_STATES } from "../../../convex/lib/address";
import type { DeliveryConfig, DeliveryZone } from "../../../convex/lib/delivery";
import {
	DELIVERY_BANDS_MAX,
	DELIVERY_ZONES_MAX,
} from "../../../convex/lib/delivery";
import {
	DEFAULT_MIN_NOTICE_DAYS,
	MAX_NOTICE_DAYS,
} from "../../../convex/lib/fulfilmentDate";
import { MIN_ORDER_VALUE_MAX } from "../../../convex/lib/minOrderRules";
import { useActAsRetailerId } from "../../hooks/useActAs";
import { useUpdateSettings } from "../../hooks/useUpdateSettings";
import { formatPhone } from "../../lib/customer";
import { clientEnv } from "../../lib/env";
import {
	convexErrorMessage,
	formatPrice,
	normalizePriceInput,
	parsePriceInput,
} from "../../lib/format";
import { deriveMapsUrl } from "../../lib/google-address";
import { hasFeature, type SubscriptionView } from "../../lib/subscription";
import { jntSeedZones } from "../../lib/weight-zone-seed";
import { ProBadge } from "../app/pro-gate";
import { FilterChip } from "../ui/filter-chip";
import {
	GoogleAddressAutocomplete,
	type GoogleSelectedAddress,
} from "../forms/google-address-autocomplete";
import { AppImage } from "../ui/app-image";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Skeleton } from "../ui/skeleton";
import { SortableList } from "../ui/sortable-list";
import { PickupLocationEditDialog } from "./pickup-location-edit-dialog";

/** Owner-only business address (the radius-pricing origin) — mirrors the
 * retailers.businessAddress payload field. */
type BusinessAddress = {
	label: string;
	latitude: number;
	longitude: number;
	placeId?: string;
};

/** Secret-free booking summary — mirrors retailers.DeliveryBookingSummary. */
type DeliveryBookingSummary = {
	enabled: boolean;
	vehicleType: "MOTORCYCLE" | "CAR";
	hasCredentials: boolean;
	promptBookOnPacked: boolean;
	deliveryDirection: "standard" | "collection";
	apiKeyHint?: string;
};

interface FulfilmentTabProps {
	retailerId: Id<"retailers">;
	offerSelfCollect: boolean;
	offerDelivery: boolean;
	/** Current delivery-charge config (undefined = free delivery). */
	deliveryConfig: DeliveryConfig | undefined;
	/** Business address — origin for distance-based pricing. */
	businessAddress: BusinessAddress | undefined;
	/** Lalamove booking summary (86eyb5hrf) — secrets never reach the client. */
	deliveryBooking: DeliveryBookingSummary | undefined;
	minFulfilmentNoticeDays: number | undefined;
	/** Store-wide minimum order value (minor units, 86ey9unyx) — undefined =
	 * no minimum. See convex/lib/minOrderRules.ts. */
	minOrderValue: number | undefined;
	/** Resolved subscription — drives the Pro-gated pickup-fee input in the
	 * edit dialog (client mirror only; the server gate is the real lock). */
	subscription: SubscriptionView | undefined;
}

function Card({ children }: { children: ReactNode }) {
	return (
		<section className="flex flex-col gap-4 rounded-2xl border border-input bg-background p-5 lg:p-6">
			{children}
		</section>
	);
}

function SectionHeading({
	title,
	description,
}: {
	title: string;
	description?: string;
}) {
	return (
		<div className="flex flex-col gap-1">
			<h3 className="text-sm font-semibold text-foreground">{title}</h3>
			{description ? (
				<p className="text-xs text-muted-foreground leading-relaxed">
					{description}
				</p>
			) : null}
		</div>
	);
}

/** Seller-facing kind chip on each pickup-point row. Same vocabulary as the
 *  buyer storefront ("Self-collect" / "Drop-off") so there's one language for
 *  the two kinds across the whole product. */
function PickupKindBadge({ kind }: { kind: "self_collect" | "drop_off" }) {
	return (
		<span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
			{kind === "drop_off" ? "Drop-off" : "Self-collect"}
		</span>
	);
}

/**
 * Inline toggle button styled as a switch — codebase has no Switch component
 * today and a single use doesn't justify a new shared primitive. Keeps the
 * component count flat per the wider settings module convention.
 */
function ToggleSwitch({
	on,
	onChange,
	disabled = false,
	label,
}: {
	on: boolean;
	onChange: (next: boolean) => void;
	disabled?: boolean;
	label: string;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={on}
			aria-label={label}
			disabled={disabled}
			onClick={() => onChange(!on)}
			className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 transition-colors ${
				on ? "border-accent bg-accent" : "border-input bg-muted"
			} ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
		>
			<span
				className={`inline-block size-5 rounded-full bg-background shadow-sm transition-transform ${
					on ? "translate-x-5" : "translate-x-0.5"
				}`}
			/>
		</button>
	);
}

export function FulfilmentTab({
	retailerId,
	offerSelfCollect,
	offerDelivery,
	deliveryConfig,
	businessAddress,
	deliveryBooking,
	minFulfilmentNoticeDays,
	minOrderValue,
	subscription,
}: FulfilmentTabProps) {
	const locations = useQuery(
		convexQuery(api.pickupLocations.listForRetailer, { retailerId }),
	).data;
	const updateSettings = useUpdateSettings();
	const setActive = useMutation(api.pickupLocations.setActive);
	const reorder = useMutation(api.pickupLocations.reorder);
	const markPickupSetupSeen = useMutation(api.retailers.markPickupSetupSeen);
	const actAsRetailerId = useActAsRetailerId();

	// Fire-and-forget on first mount so step 4 of the dashboard checklist
	// dismisses. Server-side is idempotent (no-op when already true) so a
	// double-render or re-mount doesn't double-write. We don't await or surface
	// errors — failing this is purely cosmetic for the checklist. Skipped in
	// admin act-as: the mutation resolves by identity, so it would stamp the
	// ADMIN's own checklist, not the seller's (markLinkShared posture).
	const seenFired = useRef(false);
	useEffect(() => {
		if (actAsRetailerId) return;
		if (seenFired.current) return;
		seenFired.current = true;
		markPickupSetupSeen({}).catch(() => {
			seenFired.current = false; // allow retry on subsequent mount
		});
	}, [markPickupSetupSeen, actAsRetailerId]);

	const [editing, setEditing] = useState<Doc<"pickupLocations"> | "new" | null>(
		null,
	);
	const [showInactive, setShowInactive] = useState(false);
	const [toggling, setToggling] = useState(false);

	const active = locations?.filter((l) => l.isActive) ?? [];
	const inactive = locations?.filter((l) => !l.isActive) ?? [];

	// Fulfilment invariant (mirrors the server guard in retailers.updateSettings):
	// a storefront must keep ≥1 WORKING method. Self-collect only "works" with an
	// active location, so once we know the location list we can pre-disable the
	// toggle that would strand the store and show an actionable reason. The server
	// still enforces this — the disabled state is courtesy, not the gate.
	const selfCollectWorking = offerSelfCollect && active.length > 0;
	const deliveryIsLastMethod =
		locations !== undefined && offerDelivery && !selfCollectWorking;
	const selfCollectIsLastMethod = offerSelfCollect && !offerDelivery;
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
			toast.success(
				next ? `“${location.label}” restored.` : `“${location.label}” hidden.`,
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
	const activeIds = active.map((l) => l._id);
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

	const orderedActive = useMemo(() => {
		const byId = new Map(active.map((l) => [l._id, l]));
		return localOrder
			.map((id) => byId.get(id))
			.filter((l): l is Doc<"pickupLocations"> => l !== undefined);
	}, [active, localOrder]);

	async function handleReorder(orderedIds: string[]) {
		const next = orderedIds as Array<Id<"pickupLocations">>;
		const previous = localOrder;
		setLocalOrder(next); // optimistic
		try {
			await reorder({ retailerId, orderedIds: next });
		} catch (err) {
			setLocalOrder(previous); // revert on failure
			toast.error(convexErrorMessage(err));
		}
	}

	return (
		<div className="flex flex-col gap-6 pt-2">
			<MinNoticeCard initial={minFulfilmentNoticeDays} />
			<MinOrderValueCard initial={minOrderValue} />

			<Card>
				<div className="flex items-start justify-between gap-4">
					<SectionHeading
						title="Delivery"
						description="When on, buyers can enter a delivery address at checkout. No setup needed — they just type where their order should go."
					/>
					<ToggleSwitch
						on={offerDelivery}
						onChange={handleToggleDelivery}
						disabled={deliveryToggleDisabled}
						label="Offer delivery on the storefront"
					/>
				</div>
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					<Truck className="size-4 shrink-0 text-accent" aria-hidden="true" />
					<span>The fast default — most F&amp;B sellers keep this on.</span>
				</div>
				{deliveryIsLastMethod ? (
					<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
						Delivery is your storefront&apos;s only working way to receive
						orders right now. Add an active pickup location (and keep
						self-collect on) before switching to pickup-only.
					</p>
				) : null}

				<div className="border-t border-border pt-4">
					<DeliveryChargeSection
						// Remount when the saved config/address/keys change shape so
						// local draft state re-seeds from the server truth after a save.
						key={`${deliveryConfig?.mode ?? "free"}:${businessAddress?.label ?? ""}:${deliveryBooking?.apiKeyHint ?? ""}`}
						config={deliveryConfig}
						businessAddress={businessAddress}
						deliveryBooking={deliveryBooking}
						canUseRadius={hasFeature(subscription, "radiusDelivery")}
						canUseLalamove={hasFeature(subscription, "delivery")}
					/>
				</div>
			</Card>

			<Card>
				<div className="flex items-start justify-between gap-4">
					<SectionHeading
						title="Pickup"
						description="When on, buyers can collect their order from a point you set below — your own place (self-collect) or an agreed meetup spot (drop-off). Needs at least one active point to show at checkout."
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
						Pickup is your storefront&apos;s only working way to receive orders
						right now (delivery is off). Turn delivery back on before turning
						this off.
					</p>
				) : offerSelfCollect && active.length === 0 ? (
					<p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
						Pickup is on but you have no active points yet — buyers won&apos;t
						see the option until you add one.
					</p>
				) : null}

				<div className="flex items-center justify-between gap-3 border-t border-border pt-4">
					<SectionHeading
						title="Pickup points"
						description="Where buyers collect. Frozen onto each order, so editing or deactivating a point later never rewrites past orders."
					/>
					<Button
						type="button"
						onClick={() => setEditing("new")}
						size="sm"
						className="h-10 shrink-0 gap-1.5"
					>
						<Plus className="size-4" />
						Add
					</Button>
				</div>

				{locations === undefined ? (
					<LocationListSkeleton />
				) : active.length === 0 ? (
					<EmptyState onAdd={() => setEditing("new")} />
				) : (
					<SortableList
						items={orderedActive}
						getId={(loc) => loc._id}
						onReorder={handleReorder}
						renderItem={(loc, handle, state) =>
							state.isSorting ? (
								// Collapsed one-line row while dragging (matches the order-status
								// editor) — a tall list stays easy to rearrange.
								<div
									className={`flex items-center gap-2 rounded-xl border bg-background p-3 ${
										state.isOverlay
											? "border-accent shadow-lg"
											: "border-border"
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
										location={loc}
										onEdit={() => setEditing(loc)}
										onToggleActive={(next) => handleToggleActive(loc, next)}
										dragHandle={handle}
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
							onClick={() => setShowInactive((s) => !s)}
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
										onEdit={() => setEditing(loc)}
										onToggleActive={(next) => handleToggleActive(loc, next)}
									/>
								))}
							</ul>
						) : null}
					</div>
				) : null}
			</Card>

			<PickupLocationEditDialog
				// Remount per edit target so the dialog's local state (kind, geo,
				// fee, form defaults — all captured in initializers) can't leak
				// from one location into the next.
				key={editing === "new" ? "new" : (editing?._id ?? "closed")}
				open={editing !== null}
				onClose={() => setEditing(null)}
				location={editing === "new" ? undefined : (editing ?? undefined)}
				retailerId={retailerId}
				canChargeFee={hasFeature(subscription, "chargeablePickup")}
			/>
		</div>
	);
}

// --- Delivery charge (86extzdr8) --------------------------------------------

type ChargeMode = "free" | "flat" | "radius" | "weight" | "lalamove";

type BandDraft = { maxKm: string; fee: string };

function bandsFromConfig(config: DeliveryConfig | undefined): BandDraft[] {
	if (config?.mode !== "radius") return [{ maxKm: "5", fee: "" }];
	return config.bands.map((b) => ({
		maxKm: String(b.maxKm),
		fee: (b.fee / 100).toFixed(2),
	}));
}

// Weight/zone drafts (86eyeea1n) — RM display strings; sen on the wire.
type WeightBandDraft = { maxKg: string; fee: string };
type ZoneDraft = {
	name: string;
	states: string[];
	bands: WeightBandDraft[];
	freeAbove: string;
};

/** Config/seed zones → editable drafts (one converter for both sources, so
 * the seed can never save differently from a stored card). */
function zoneDraftsFromZones(
	zones: Pick<DeliveryZone, "name" | "states" | "bands" | "freeAbove">[],
): ZoneDraft[] {
	return zones.map((z) => ({
		name: z.name,
		states: [...z.states],
		bands: z.bands.map((b) => ({
			maxKg: String(b.maxKg),
			fee: (b.fee / 100).toFixed(2),
		})),
		freeAbove: z.freeAbove !== undefined ? (z.freeAbove / 100).toFixed(2) : "",
	}));
}

function weightZonesFromConfig(config: DeliveryConfig | undefined): ZoneDraft[] {
	// Empty = the template/blank chooser renders instead of an empty form.
	if (config?.mode !== "weight") return [];
	return zoneDraftsFromZones(config.zones);
}

/** A fresh zone draft — one starter band so the row structure is visible. */
function blankZoneDraft(): ZoneDraft {
	return { name: "", states: [], bands: [{ maxKg: "3", fee: "" }], freeAbove: "" };
}

/** Segmented mode button — same visual language as the pickup KindButton. */
function ModeButton({
	active,
	disabled,
	onClick,
	title,
	subtitle,
	badge,
}: {
	active: boolean;
	disabled?: boolean;
	onClick: () => void;
	title: string;
	subtitle: string;
	badge?: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-pressed={active}
			className={`relative flex flex-col items-start gap-0.5 rounded-xl border-2 py-2.5 pl-3 pr-9 text-left transition-colors ${
				active
					? "border-accent bg-accent/5"
					: "border-border bg-card hover:border-accent/40"
			} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
		>
			<span
				className={`flex items-center gap-1.5 text-sm font-semibold ${active ? "text-accent" : "text-foreground"}`}
			>
				{title}
				{badge}
			</span>
			<span className="text-xs text-muted-foreground">{subtitle}</span>
			<ModeRadioDot active={active} />
		</button>
	);
}

/**
 * Radio-style indicator in a mode card's corner. These grids choose exactly
 * ONE option, but the tinted-border selected state alone read as "these might
 * all be on" (Zaki, 27 Jul) — an explicit empty-ring vs filled-dot makes the
 * pick-one semantics visible at a glance. Decorative only: the button itself
 * carries aria-pressed.
 */
function ModeRadioDot({ active }: { active: boolean }) {
	return (
		<span
			aria-hidden="true"
			className={`absolute bottom-2.5 right-2.5 flex size-4 items-center justify-center rounded-full border-2 transition-colors ${
				active ? "border-accent" : "border-border"
			}`}
		>
			{active ? <span className="size-2 rounded-full bg-accent" /> : null}
		</span>
	);
}

/**
 * Delivery-charge configuration (86extzdr8) — lives inside the Delivery card
 * because it's pricing for that method (mirrors the fee input inside the
 * pickup-point dialog). Three modes: Free (default, today's behaviour), a
 * flat fee with optional free-above threshold (all-tier — a wrong total is a
 * correctness bug, not an upsell), and distance bands from the business
 * address (Pro). Distances are STRAIGHT-LINE — the copy says so, because a
 * seller who bands by road distance will undercharge.
 */
function DeliveryChargeSection({
	config,
	businessAddress,
	deliveryBooking,
	canUseRadius,
	canUseLalamove,
}: {
	config: DeliveryConfig | undefined;
	businessAddress: BusinessAddress | undefined;
	/** Secret-free booking summary — Lalamove is set up INSIDE this section
	 * (a delivery-pricing choice, not a separate feature). */
	deliveryBooking: DeliveryBookingSummary | undefined;
	canUseRadius: boolean;
	canUseLalamove: boolean;
}) {
	const updateSettings = useUpdateSettings();
	const [mode, setMode] = useState<ChargeMode>(config?.mode ?? "free");
	// Flat-mode drafts (RM display strings; sen on the wire).
	const [flatFee, setFlatFee] = useState(
		config?.mode === "flat" ? (config.fee / 100).toFixed(2) : "",
	);
	const [freeAbove, setFreeAbove] = useState(
		config?.mode === "flat" && config.freeAbove !== undefined
			? (config.freeAbove / 100).toFixed(2)
			: "",
	);
	// Radius-mode drafts.
	const [bands, setBands] = useState<BandDraft[]>(() =>
		bandsFromConfig(config),
	);
	const [outOfRange, setOutOfRange] = useState<"block" | "arrange">(
		config?.mode === "radius" ? config.outOfRange : "arrange",
	);
	// Weight-mode drafts (86eyeea1n). Both policies default to "arrange" — the
	// radius posture: never lose an order to a rate-card gap by default.
	const [zones, setZones] = useState<ZoneDraft[]>(() =>
		weightZonesFromConfig(config),
	);
	const [onOutOfBands, setOnOutOfBands] = useState<"block" | "arrange">(
		config?.mode === "weight" ? config.onOutOfBands : "arrange",
	);
	const [onUnpriceable, setOnUnpriceable] = useState<"block" | "arrange">(
		config?.mode === "weight" ? config.onUnpriceable : "arrange",
	);
	// Business address: the autocomplete pick replaces the stored one on save.
	const [pickedAddress, setPickedAddress] =
		useState<GoogleSelectedAddress | null>(null);
	// Lalamove drafts (mode "lalamove" only). Blank key inputs mean "keep the
	// stored pair" (server: undefined = no change); `editingKeys` swaps the
	// stored-key summary row for fresh inputs (key rotation).
	const [vehicleType, setVehicleType] = useState<"MOTORCYCLE" | "CAR">(
		deliveryBooking?.vehicleType ?? "MOTORCYCLE",
	);
	const [apiKey, setApiKey] = useState("");
	const [apiSecret, setApiSecret] = useState("");
	const [editingKeys, setEditingKeys] = useState(false);
	const [promptBook, setPromptBook] = useState(
		deliveryBooking?.promptBookOnPacked ?? false,
	);
	// Collection service (86eyg0n8e): riders collect FROM the customer and
	// bring orders here (gear-wash / repair stores). Reverses dispatch, stops
	// webhook auto-status, and flips buyer-facing copy to "collection".
	const [collectionMode, setCollectionMode] = useState(
		deliveryBooking?.deliveryDirection === "collection",
	);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const hasStoredKey = !!deliveryBooking?.apiKeyHint;
	const typedBothKeys = apiKey.trim().length > 0 && apiSecret.trim().length > 0;

	// A downgraded seller sitting on a radius config can still view it and
	// switch away (clearing is un-gated server-side) — they just can't edit it.
	const radiusLocked = !canUseRadius;
	const radiusEditable = mode === "radius" && canUseRadius;
	const lalamoveLocked = !canUseLalamove;
	// Weight-mode derived views: which zone owns each state (chips make a
	// double-claim unrepresentable) and which states no zone covers.
	const claimedStates = new Map<string, number>();
	zones.forEach((z, zi) => {
		for (const s of z.states) {
			if (!claimedStates.has(s)) claimedStates.set(s, zi);
		}
	});
	const uncoveredStates = MY_STATES.filter((s) => !claimedStates.has(s));
	const patchZone = (i: number, patch: Partial<ZoneDraft>) =>
		setZones((prev) => prev.map((z, j) => (j === i ? { ...z, ...patch } : z)));
	const effectiveAddress = pickedAddress
		? {
				label: pickedAddress.formattedAddress,
				latitude: pickedAddress.latitude,
				longitude: pickedAddress.longitude,
				placeId: pickedAddress.placeId,
			}
		: businessAddress;

	async function save() {
		setError(null);
		let nextConfig: DeliveryConfig | null;
		if (mode === "free") {
			nextConfig = null;
		} else if (mode === "flat") {
			const rm = parsePriceInput(flatFee);
			if (rm === null || rm <= 0) {
				setError("Enter the flat delivery fee — numbers only, e.g. 8.00");
				return;
			}
			let freeAboveSen: number | undefined;
			if (freeAbove.trim().length > 0) {
				const threshold = parsePriceInput(freeAbove);
				if (threshold === null || threshold <= 0) {
					setError("Free-delivery threshold isn't a valid amount");
					return;
				}
				freeAboveSen = Math.round(threshold * 100);
			}
			nextConfig = {
				mode: "flat",
				fee: Math.round(rm * 100),
				freeAbove: freeAboveSen,
			};
		} else if (mode === "weight") {
			// Mirrors sanitizeDeliveryConfig's weight rules so failures are a
			// helpful inline message, not a thrown save. Cross-zone state clashes
			// can't happen by construction (claimed chips are disabled), so only
			// the per-zone rules need checking here.
			if (zones.length === 0) {
				setError(
					"Add at least one delivery zone — or start from the J&T template above.",
				);
				return;
			}
			const seenNames = new Set<string>();
			const parsedZones: DeliveryZone[] = [];
			for (const zone of zones) {
				const name = zone.name.trim();
				if (name.length === 0) {
					setError("Every zone needs a name — e.g. West Malaysia.");
					return;
				}
				if (seenNames.has(name.toLowerCase())) {
					setError(`Two zones are both named “${name}” — rename one.`);
					return;
				}
				seenNames.add(name.toLowerCase());
				if (zone.states.length === 0) {
					setError(`Zone “${name}” needs at least one state.`);
					return;
				}
				const parsedBands: DeliveryZone["bands"] = [];
				for (const b of zone.bands) {
					const kg = Number(b.maxKg);
					const rm = parsePriceInput(b.fee.trim().length > 0 ? b.fee : "0");
					if (!Number.isFinite(kg) || kg <= 0) {
						setError(`Each band in “${name}” needs a weight greater than 0 kg`);
						return;
					}
					if (rm === null || rm < 0) {
						setError(
							`A band fee in “${name}” isn't a valid amount — numbers only, e.g. 8.00`,
						);
						return;
					}
					parsedBands.push({ maxKg: kg, fee: Math.round(rm * 100) });
				}
				let freeAboveSen: number | undefined;
				if (zone.freeAbove.trim().length > 0) {
					const threshold = parsePriceInput(zone.freeAbove);
					if (threshold === null || threshold <= 0) {
						setError(
							`The free-delivery threshold for “${name}” isn't a valid amount`,
						);
						return;
					}
					freeAboveSen = Math.round(threshold * 100);
				}
				parsedZones.push({
					name,
					states: zone.states,
					bands: parsedBands,
					freeAbove: freeAboveSen,
				});
			}
			nextConfig = {
				mode: "weight",
				zones: parsedZones,
				onOutOfBands,
				onUnpriceable,
			};
		} else if (mode === "lalamove") {
			// Live provider quote (86eyb5hrf) — `onUnquotable` is vestigial (strict
			// since 27 Jul: no quote, no order; the sanitizer normalizes stored
			// rows to "block"). Mirrors the server gates so the failure is a
			// helpful message, not a thrown save.
			if (!effectiveAddress) {
				setError(
					collectionMode
						? "Pick your business address from the suggestions — it's where riders drop off what they collect."
						: "Pick your business address from the suggestions — it's the pickup point riders are sent to.",
				);
				return;
			}
			if (!hasStoredKey || editingKeys) {
				if (!typedBothKeys) {
					setError(
						"Paste both your Lalamove API key and API secret — tap “How to set up” if you don't have them yet.",
					);
					return;
				}
			}
			nextConfig =
				config?.mode === "lalamove"
					? config
					: { mode: "lalamove", onUnquotable: "block" };
		} else {
			if (!effectiveAddress) {
				setError(
					"Set your business address first — distances are measured from it.",
				);
				return;
			}
			const parsedBands = [];
			for (const b of bands) {
				const km = Number(b.maxKm);
				const rm = parsePriceInput(b.fee.trim().length > 0 ? b.fee : "0");
				if (!Number.isFinite(km) || km <= 0) {
					setError("Each band needs a distance greater than 0 km");
					return;
				}
				if (rm === null || rm < 0) {
					setError("A band fee isn't a valid amount — numbers only, e.g. 5.00");
					return;
				}
				parsedBands.push({ maxKm: km, fee: Math.round(rm * 100) });
			}
			nextConfig = { mode: "radius", bands: parsedBands, outOfRange };
		}
		setSaving(true);
		try {
			// Lalamove is enabled/disabled as part of the pricing choice — one
			// save, one mental model. Switching AWAY also turns booking off (the
			// server refuses a dangling live-quote config otherwise); the stored
			// keys stay, so switching back later is instant.
			const wasLalamove = deliveryBooking?.enabled === true;
			const bookingPatch =
				mode === "lalamove"
					? {
							deliveryBooking: {
								enabled: true,
								vehicleType,
								promptBookOnPacked: promptBook,
								// Explicit both ways so turning the toggle OFF really
								// clears it ("standard" normalizes to unset server-side).
								deliveryDirection: collectionMode
									? ("collection" as const)
									: ("standard" as const),
								apiKey: apiKey.trim() || undefined,
								apiSecret: apiSecret.trim() || undefined,
							},
						}
					: wasLalamove
						? {
								// Direction is deliberately omitted here — the server keeps
								// the stored value, so switching pricing away and back never
								// resets a collection store to standard.
								deliveryBooking: {
									enabled: false,
									vehicleType,
								},
							}
						: {};
			await updateSettings({
				deliveryConfig: nextConfig,
				// Only send the address when the seller picked a new one — an
				// unchanged save must not touch (or clear) the stored address.
				...(pickedAddress && effectiveAddress
					? { businessAddress: effectiveAddress }
					: {}),
				...bookingPatch,
			});
			toast.success(
				mode === "free"
					? "Delivery charge turned off — delivery is free."
					: mode === "lalamove"
						? "Lalamove delivery is on — book riders from any confirmed delivery order."
						: "Delivery charge saved.",
			);
			setPickedAddress(null);
			setApiKey("");
			setApiSecret("");
			setEditingKeys(false);
		} catch (err) {
			setError(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<SectionHeading
				title="Delivery charge"
				description="What buyers pay for delivery, added to their order total at checkout. Pickup orders are never charged this."
			/>
			{/* 2×2 grid, Lalamove FIRST (86eyb5hrf) — it's a pricing choice like
			    the others, but the promoted one: branded with the official
			    wordmark so every tier SEES rider delivery exists. For a locked
			    Starter it stays full-colour with a Pro chip + upgrade line
			    (disabled-with-reason, not a washed-out ghost). */}
			<div className="grid grid-cols-2 gap-2">
				<button
					type="button"
					onClick={() => setMode("lalamove")}
					disabled={lalamoveLocked && config?.mode !== "lalamove"}
					aria-pressed={mode === "lalamove"}
					className={`relative flex flex-col items-start gap-1 rounded-xl border-2 py-2.5 pl-3 pr-9 text-left transition-colors ${
						mode === "lalamove"
							? "border-accent bg-accent/5"
							: "border-border bg-card hover:border-accent/40"
					} ${lalamoveLocked && config?.mode !== "lalamove" ? "cursor-not-allowed" : ""}`}
				>
					<span className="flex items-center gap-1.5">
						<AppImage
							src="/img/lalamove-logo.svg"
							alt="Lalamove"
							aspect="h-4 w-auto"
							fill={false}
						/>
						{lalamoveLocked ? <ProBadge /> : null}
					</span>
					<span className="text-xs text-muted-foreground">
						{lalamoveLocked && config?.mode !== "lalamove"
							? "Rider delivery — upgrade to Pro to turn on"
							: "Live rider price, one-tap booking"}
					</span>
					<ModeRadioDot active={mode === "lalamove"} />
				</button>
				<ModeButton
					active={mode === "free"}
					onClick={() => setMode("free")}
					title="Free"
					subtitle="No charge"
				/>
				<ModeButton
					active={mode === "flat"}
					onClick={() => setMode("flat")}
					title="Flat fee"
					subtitle="Same fee every order"
				/>
				<ModeButton
					active={mode === "radius"}
					// A seller already ON radius keeps access to the tab so they can
					// switch away; a locked seller can't switch INTO it.
					disabled={radiusLocked && config?.mode !== "radius"}
					onClick={() => setMode("radius")}
					title="By distance"
					subtitle="Radius bands — you deliver"
					badge={radiusLocked ? <ProBadge /> : undefined}
				/>
				{/* Weight/zone rate card (86eyeea1n) — all-tier: it's the correctness
				    fix for outstation parcel sellers (J&T/DD/Ninja), with zero
				    provider cost to Kedaipal. */}
				<ModeButton
					active={mode === "weight"}
					onClick={() => setMode("weight")}
					title="By weight & zone"
					subtitle="Courier rate card — you ship"
				/>
			</div>

			{mode === "lalamove" ? (
				<div className="flex flex-col gap-4">
					<p className="rounded-lg bg-accent/10 px-3 py-2 text-xs leading-relaxed text-accent-emphasis">
						Buyers pay the real Lalamove price for their address at checkout,
						and you book the rider in one tap from the order — which then marks
						itself Shipped and puts the rider&apos;s live tracking on the
						buyer&apos;s order page, automatically. There&apos;s{" "}
						<b>no delivery area to set</b>, and{" "}
						<b>buyers always see the price before ordering</b> (an address
						Lalamove can&apos;t price can&apos;t check out, so you never work
						out a delivery charge yourself). Runs entirely on{" "}
						<b>your own Lalamove account</b>; Kedaipal never books or pays on
						your behalf.
					</p>
					{/* Coverage education (27 Jul, measured live): city-zone limits are
					    LALAMOVE's, they surprise vendors ("but Kajang is close!"), and
					    the vehicle picker below must not read as a range picker. */}
					<p className="rounded-lg bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
						<b>Lalamove&apos;s own coverage still applies:</b> riders serve the
						city zone around your pickup address (e.g. Klang Valley), so a buyer
						too far outside it sees <i>&quot;this address is too far&quot;</i>{" "}
						and can&apos;t choose delivery — roughly 40–70&nbsp;km depending on
						direction, and never across zones (a Klang Valley store can&apos;t
						Lalamove to Melaka). Vehicle choice doesn&apos;t change this: bike
						and car cover the <b>same area</b> — the difference is parcel size
						and price. Keep self-collect on as the fallback for far buyers.
					</p>
					{lalamoveLocked ? (
						<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
							Lalamove delivery is a Pro feature. Your setup still applies to
							new orders — upgrade in Settings → Billing to change it, or switch
							to Free / Flat fee (always allowed).
						</p>
					) : null}

					{/* 1 · Pickup point */}
					<div className="flex flex-col gap-1.5">
						<GoogleAddressAutocomplete
							initialValue={businessAddress?.label ?? ""}
							label={
								collectionMode
									? "Your outlet address (riders drop off here)"
									: "Your pickup address (riders collect here)"
							}
							required
							placeholder="Start typing your business address…"
							description={
								effectiveAddress
									? collectionMode
										? "✓ Pinned — riders bring collected orders to this exact point."
										: "✓ Pinned — riders are sent to this exact point."
									: "Pick a Google suggestion so riders get an exact pin — your stall, kitchen or shop. Buyers never see this address."
							}
							onSelect={(payload) => setPickedAddress(payload)}
							onTextChange={() => setPickedAddress(null)}
						/>
						{businessAddress && !pickedAddress ? (
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

					{/* 2 · Vehicle */}
					<div className="flex flex-col gap-1.5">
						<span className="text-xs font-medium text-muted-foreground">
							Default vehicle
						</span>
						<div className="grid grid-cols-2 gap-2">
							<ModeButton
								active={vehicleType === "MOTORCYCLE"}
								disabled={lalamoveLocked}
								onClick={() => setVehicleType("MOTORCYCLE")}
								title="Motorcycle"
								subtitle="Most orders, cheapest"
							/>
							<ModeButton
								active={vehicleType === "CAR"}
								disabled={lalamoveLocked}
								onClick={() => setVehicleType("CAR")}
								title="Car"
								subtitle="Bulky / fragile"
							/>
						</div>
						<p className="text-xs text-muted-foreground">
							Just the default — you can switch vehicle per order in the booking
							dialog.
						</p>
					</div>

					{/* 3 · The seller's own API keys (BYO-only) */}
					<div className="flex flex-col gap-2">
						<div className="flex items-center justify-between">
							<span className="text-xs font-medium text-muted-foreground">
								Your Lalamove account (API key)
							</span>
							<a
								href="/guides/lalamove-setup.html"
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center gap-1 text-xs font-medium text-accent hover:underline"
							>
								How to set up <ExternalLink className="size-3" />
							</a>
						</div>
						{hasStoredKey && !editingKeys ? (
							<div className="flex items-center justify-between rounded-lg border border-input px-3 py-2 text-sm">
								<span>
									Key ending{" "}
									<span className="font-mono">
										…{deliveryBooking?.apiKeyHint}
									</span>{" "}
									stored
								</span>
								<button
									type="button"
									onClick={() => setEditingKeys(true)}
									className="text-xs font-medium text-accent hover:underline"
								>
									Replace
								</button>
							</div>
						) : (
							<div className="flex flex-col gap-2">
								{/* Plain text inputs with a CSS mask on the secret — NOT
								    type="password", so Chrome never mistakes this for a
								    login form and autofills saved credentials into it. */}
								<Input
									type="text"
									name="lalamove-api-key"
									autoComplete="off"
									data-1p-ignore
									data-lpignore="true"
									data-form-type="other"
									value={apiKey}
									disabled={lalamoveLocked}
									onChange={(e) => setApiKey(e.target.value)}
									placeholder="API key (pk_…)"
									className="h-11 font-mono text-sm"
								/>
								<Input
									type="text"
									name="lalamove-api-secret"
									autoComplete="off"
									data-1p-ignore
									data-lpignore="true"
									data-form-type="other"
									value={apiSecret}
									disabled={lalamoveLocked}
									onChange={(e) => setApiSecret(e.target.value)}
									placeholder="API secret (sk_…)"
									className="h-11 font-mono text-sm"
									style={
										apiSecret.length > 0
											? ({ WebkitTextSecurity: "disc" } as React.CSSProperties)
											: undefined
									}
								/>
								{hasStoredKey && editingKeys ? (
									<button
										type="button"
										onClick={() => {
											setEditingKeys(false);
											setApiKey("");
											setApiSecret("");
										}}
										className="self-start text-xs font-medium text-muted-foreground hover:underline"
									>
										Keep the stored key instead
									</button>
								) : null}
							</div>
						)}
						<p className="text-xs text-muted-foreground">
							From the Lalamove Partner Portal (partnerportal.lalamove.com) →
							Developers tab. You pay Lalamove directly from your own prepaid
							wallet — Kedaipal never books or pays on your behalf. Your key
							stays saved if you switch pricing methods, so switching back is
							instant.
						</p>
					</div>

					{/* 4 · Webhook — each seller registers OUR endpoint in THEIR
					    Partner Portal; without it bookings still work but the
					    shipped/delivered updates stop being automatic. */}
					{hasStoredKey ? (
						<div className="flex flex-col gap-1.5">
							<span className="text-xs font-medium text-muted-foreground">
								One more step: your Lalamove webhook
							</span>
							<div className="flex items-center gap-2">
								<code className="min-w-0 flex-1 truncate rounded-lg border border-input bg-muted/40 px-3 py-2.5 font-mono text-xs">
									{lalamoveWebhookUrl()}
								</code>
								<Button
									type="button"
									variant="outline"
									className="h-10 shrink-0 px-3 text-xs"
									onClick={() => {
										navigator.clipboard
											.writeText(lalamoveWebhookUrl())
											.then(() => toast.success("Webhook link copied"))
											.catch(() =>
												toast.error("Couldn't copy — select and copy manually"),
											);
									}}
								>
									Copy
								</Button>
							</div>
							<p className="text-xs text-muted-foreground">
								Paste this in your Lalamove Partner Portal → Developers →
								Webhook URL (choose version 3). It powers the automatic Shipped
								and Delivered updates, and the live tracking on the buyer&apos;s
								order page — step 5 in the guide.
							</p>
						</div>
					) : null}

					{/* 5 · Collection service (86eyg0n8e, Bearcamp) — reverses the trip:
					    riders collect FROM the customer's address and drop off at the
					    business address. Sits ABOVE prompt-on-packed because it changes
					    what the whole feature does, not just when it prompts. */}
					<div className="flex flex-col gap-1.5 rounded-xl border border-input p-3">
						<div className="flex items-start justify-between gap-4">
							<div>
								<p className="text-sm font-medium">Collection service</p>
								<p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
									{collectionMode
										? 'On — riders collect from your customer\'s address and bring the order to your outlet (for cleaning, repair or laundry services). Checkout asks buyers for a collection address, and order statuses stay yours to advance — the rider\'s progress only moves the booking card, since "picked up" isn\'t "delivered to the customer" here. The return trip after your work is done is a separate order.'
										: "Off — riders deliver from your outlet to the customer (the normal direction). Turn this on if your business collects items from customers instead, like a cleaning or repair service."}
								</p>
								{collectionMode !==
								(deliveryBooking?.deliveryDirection === "collection") ? (
									<p className="mt-1.5 text-xs text-amber-700 leading-relaxed dark:text-amber-400">
										Applies to <span className="font-medium">new orders</span>.
										Orders already placed keep the arrangement they promised
										their buyer, so anything in flight is unaffected.
									</p>
								) : null}
								{collectionMode ? (
									<p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
										💡 Rename your order steps to match your workflow (e.g.
										Collecting → Cleaning → Ready) in{" "}
										<Link
											to="/app/settings"
											search={{ tab: "order-status" }}
											className="font-medium text-accent hover:underline"
										>
											Settings → Order status
										</Link>
										— buyers see those names on their tracking page.
									</p>
								) : null}
							</div>
							<ToggleSwitch
								on={collectionMode}
								onChange={setCollectionMode}
								disabled={lalamoveLocked}
								label="Collection service"
							/>
						</div>
					</div>

					{/* 6 · Prompt-to-book on packed (opt-in) — NOT silent auto-book:
					    marking a paid, due-today order Packed pops the confirm dialog
					    with today's price, so the seller always sees the cost + taps
					    to spend. */}
					<div className="flex flex-col gap-1.5 rounded-xl border border-input p-3">
						<div className="flex items-start justify-between gap-4">
							<div>
								<p className="text-sm font-medium">
									Ask me to book a rider when I mark an order{" "}
									<span className="font-semibold">Packed</span>
								</p>
								<p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
									{promptBook
										? "On — when you mark a paid, same-day delivery order Packed, the 'Book a rider?' dialog opens with today's price so you can confirm in one tap (or dismiss). Nothing is booked or charged until you confirm. Future-dated and unpaid orders don't prompt."
										: "Off — you open the Book delivery button yourself when you're ready. Turn this on to be prompted the moment an order is packed."}
								</p>
							</div>
							<ToggleSwitch
								on={promptBook}
								onChange={setPromptBook}
								disabled={lalamoveLocked}
								label="Prompt to book a rider on packed"
							/>
						</div>
					</div>
				</div>
			) : null}

			{mode === "flat" ? (
				<div className="flex flex-col gap-3">
					<div className="flex flex-wrap items-end gap-3">
						<div className="flex flex-col gap-1.5">
							<label
								htmlFor="flat-delivery-fee"
								className="text-xs font-medium text-muted-foreground"
							>
								Delivery fee
							</label>
							<div className="relative">
								<span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
									RM
								</span>
								<input
									id="flat-delivery-fee"
									type="text"
									inputMode="decimal"
									value={flatFee}
									onChange={(e) => setFlatFee(e.target.value)}
									onBlur={() => setFlatFee(normalizePriceInput(flatFee))}
									placeholder="8.00"
									className="h-11 w-32 rounded-lg border border-input bg-background pl-11 pr-3 text-sm"
								/>
							</div>
						</div>
						<div className="flex flex-col gap-1.5">
							<label
								htmlFor="free-above"
								className="text-xs font-medium text-muted-foreground"
							>
								Free for orders above (optional)
							</label>
							<div className="relative">
								<span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
									RM
								</span>
								<input
									id="free-above"
									type="text"
									inputMode="decimal"
									value={freeAbove}
									onChange={(e) => setFreeAbove(e.target.value)}
									onBlur={() => setFreeAbove(normalizePriceInput(freeAbove))}
									placeholder="100.00"
									className="h-11 w-40 rounded-lg border border-input bg-background pl-11 pr-3 text-sm"
								/>
							</div>
						</div>
					</div>
					<p className="text-xs text-muted-foreground leading-relaxed">
						Buyers see the fee in their checkout total. An order that reaches
						the threshold exactly ships free.
					</p>
				</div>
			) : null}

			{mode === "radius" ? (
				<div className="flex flex-col gap-4">
					{radiusLocked ? (
						<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
							Distance-based pricing is a Pro feature. Your saved bands still
							apply to new orders — upgrade in Settings → Billing to change
							them, or switch to Free / Flat fee (always allowed).
						</p>
					) : null}
					<div className="flex flex-col gap-1.5">
						<GoogleAddressAutocomplete
							initialValue={businessAddress?.label ?? ""}
							label="Business address (measure from)"
							required
							placeholder="Start typing your business address…"
							description={
								effectiveAddress
									? "✓ Pinned — distances are measured from this point."
									: "Pick a Google suggestion so we can measure distances from your place. Buyers never see this address."
							}
							onSelect={(payload) => setPickedAddress(payload)}
							onTextChange={() => {
								// Typing away from a pick invalidates it — the stored
								// address (if any) remains until a new pick is saved.
								setPickedAddress(null);
							}}
						/>
						{businessAddress && !pickedAddress ? (
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

					<div className="flex flex-col gap-2">
						<p className="text-xs font-medium text-muted-foreground">
							Distance bands
						</p>
						{bands.map((band, i) => (
							<div
								// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional drafts with no stable identity
								key={i}
								className="flex items-center gap-2"
							>
								<span className="text-xs text-muted-foreground">Up to</span>
								<Input
									type="number"
									inputMode="decimal"
									min={0.1}
									step={0.1}
									value={band.maxKm}
									disabled={!radiusEditable}
									onChange={(e) =>
										setBands((prev) =>
											prev.map((b, j) =>
												j === i ? { ...b, maxKm: e.target.value } : b,
											),
										)
									}
									variant="field"
									className="w-20"
									aria-label={`Band ${i + 1} distance in km`}
								/>
								<span className="text-xs text-muted-foreground">km →</span>
								<div className="relative">
									<span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
										RM
									</span>
									<input
										type="text"
										inputMode="decimal"
										value={band.fee}
										disabled={!radiusEditable}
										onChange={(e) =>
											setBands((prev) =>
												prev.map((b, j) =>
													j === i ? { ...b, fee: e.target.value } : b,
												),
											)
										}
										onBlur={() =>
											setBands((prev) =>
												prev.map((b, j) =>
													j === i
														? { ...b, fee: normalizePriceInput(b.fee) }
														: b,
												),
											)
										}
										placeholder="5.00"
										aria-label={`Band ${i + 1} fee`}
										className="h-11 w-28 rounded-lg border border-input bg-background pl-11 pr-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
									/>
								</div>
								{bands.length > 1 && radiusEditable ? (
									<button
										type="button"
										onClick={() =>
											setBands((prev) => prev.filter((_, j) => j !== i))
										}
										aria-label={`Remove band ${i + 1}`}
										className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
									>
										<Trash2 className="size-4" />
									</button>
								) : null}
							</div>
						))}
						{radiusEditable && bands.length < DELIVERY_BANDS_MAX ? (
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="h-10 gap-1.5 self-start"
								onClick={() =>
									setBands((prev) => [...prev, { maxKm: "", fee: "" }])
								}
							>
								<Plus className="size-4" />
								Add band
							</Button>
						) : null}
						<p className="text-xs text-muted-foreground leading-relaxed">
							Distances are straight-line (&ldquo;as the crow flies&rdquo;) from
							your business address, not driving routes — pad your bands a
							little to cover real roads. A band fee of RM0 means free within
							that distance.
						</p>
					</div>

					<div className="flex flex-col gap-2 border-t border-border pt-4">
						<SectionHeading title="Beyond your last band" />
						<label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border p-3">
							<input
								type="radio"
								name="out-of-range"
								checked={outOfRange === "arrange"}
								disabled={!radiusEditable}
								onChange={() => setOutOfRange("arrange")}
								className="mt-0.5 size-4 shrink-0 accent-accent"
							/>
							<span className="flex flex-col gap-0.5">
								<span className="text-sm font-medium">
									Accept the order, arrange the charge on WhatsApp
								</span>
								<span className="text-xs text-muted-foreground">
									The order comes in with the delivery charge pending, and the
									buyer&apos;s WhatsApp confirmation waits with it — so message
									them first. Agree the charge, set it on the order, and
									that&apos;s when their confirmation goes out, with the charge
									and the final total in it.
								</span>
							</span>
						</label>
						<label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border p-3">
							<input
								type="radio"
								name="out-of-range"
								checked={outOfRange === "block"}
								disabled={!radiusEditable}
								onChange={() => setOutOfRange("block")}
								className="mt-0.5 size-4 shrink-0 accent-accent"
							/>
							<span className="flex flex-col gap-0.5">
								<span className="text-sm font-medium">
									Don&apos;t accept the order
								</span>
								<span className="text-xs text-muted-foreground">
									Buyers outside your bands see &ldquo;outside the delivery
									area&rdquo; and can&apos;t check out with delivery.
								</span>
							</span>
						</label>
					</div>
				</div>
			) : null}

			{mode === "weight" ? (
				<div className="flex flex-col gap-4">
					<p className="rounded-lg bg-accent/10 px-3 py-2 text-xs leading-relaxed text-accent-emphasis">
						Sell nationwide with your parcel courier&apos;s own rate card (J&T,
						DD Cold Chain, Ninja Cold…). Buyers pay by <b>where the order
						goes</b> — their state&apos;s zone — and <b>what it weighs</b>:
						each product&apos;s parcel weight × quantity. You book the courier
						yourself as usual; Kedaipal prices the checkout.
					</p>
					<p className="rounded-lg bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
						A band works like a box tier — <b>&ldquo;up to 5 kg =
						RM30&rdquo;</b> (S 5 kg / M 10 kg / L 20 kg). Rates use{" "}
						<b>actual weight only</b>; if your courier bills volumetric
						(size-based) weight, pick the safer band when you copy your card
						over.
					</p>

					{zones.length === 0 ? (
						<div className="flex flex-col gap-2.5 rounded-xl border border-dashed border-border p-4">
							<p className="text-sm font-medium">Start your rate card</p>
							<p className="text-xs leading-relaxed text-muted-foreground">
								The template pre-fills West + East Malaysia with J&T&apos;s
								published ambient rates (Aug 2026) — replace them with what you
								actually pay your courier.
							</p>
							<div className="flex flex-wrap gap-2">
								<Button
									type="button"
									size="sm"
									className="h-10"
									onClick={() => {
										setZones(zoneDraftsFromZones(jntSeedZones()));
										setError(null);
									}}
								>
									Use the J&T template
								</Button>
								<Button
									type="button"
									size="sm"
									variant="outline"
									className="h-10"
									onClick={() => setZones([blankZoneDraft()])}
								>
									Start blank
								</Button>
							</div>
						</div>
					) : (
						<div className="flex flex-col gap-3">
							{zones.map((zone, zi) => (
								<WeightZoneCard
									// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional drafts with no stable identity
									key={zi}
									zone={zone}
									index={zi}
									claimed={claimedStates}
									onPatch={(patch) => patchZone(zi, patch)}
									onRemove={() =>
										setZones((prev) => prev.filter((_, j) => j !== zi))
									}
								/>
							))}
							{zones.length < DELIVERY_ZONES_MAX ? (
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="h-10 gap-1.5 self-start"
									onClick={() => setZones((prev) => [...prev, blankZoneDraft()])}
								>
									<Plus className="size-4" />
									Add zone
								</Button>
							) : null}
							{uncoveredStates.length > 0 ? (
								<p className="rounded-lg bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
									<b>Not covered:</b> {uncoveredStates.join(", ")} — buyers
									there{" "}
									{onOutOfBands === "block"
										? "see “not delivered to your state” and can't check out with delivery."
										: "can still order; you confirm the delivery charge on WhatsApp."}
								</p>
							) : null}
						</div>
					)}

					<div className="flex flex-col gap-2 border-t border-border pt-4">
						<SectionHeading title="Outside your zones, or heavier than your bands" />
						<label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border p-3">
							<input
								type="radio"
								name="weight-out-of-bands"
								checked={onOutOfBands === "arrange"}
								onChange={() => setOnOutOfBands("arrange")}
								className="mt-0.5 size-4 shrink-0 accent-accent"
							/>
							<span className="flex flex-col gap-0.5">
								<span className="text-sm font-medium">
									Accept the order, arrange the charge on WhatsApp
								</span>
								<span className="text-xs text-muted-foreground">
									The order comes in with the delivery charge pending — you
									agree it with the buyer in chat, set it on the order, and the
									payment request goes out with the final total.
								</span>
							</span>
						</label>
						<label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border p-3">
							<input
								type="radio"
								name="weight-out-of-bands"
								checked={onOutOfBands === "block"}
								onChange={() => setOnOutOfBands("block")}
								className="mt-0.5 size-4 shrink-0 accent-accent"
							/>
							<span className="flex flex-col gap-0.5">
								<span className="text-sm font-medium">
									Don&apos;t accept the order
								</span>
								<span className="text-xs text-muted-foreground">
									Buyers in a state you don&apos;t cover — or with an order
									heavier than your last band — can&apos;t check out with
									delivery.
								</span>
							</span>
						</label>
					</div>

					<div className="flex flex-col gap-2 border-t border-border pt-4">
						<SectionHeading title="When the weight can't be calculated" />
						<p className="-mt-1 text-xs text-muted-foreground">
							Happens when an item has no parcel weight set, or the order
							includes a custom / quote-first item.
						</p>
						<label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border p-3">
							<input
								type="radio"
								name="weight-unpriceable"
								checked={onUnpriceable === "arrange"}
								onChange={() => setOnUnpriceable("arrange")}
								className="mt-0.5 size-4 shrink-0 accent-accent"
							/>
							<span className="flex flex-col gap-0.5">
								<span className="text-sm font-medium">
									Accept the order, arrange the charge on WhatsApp
								</span>
								<span className="text-xs text-muted-foreground">
									Recommended — a missing weight never costs you the order. The
									charge comes in pending, like out-of-zone orders above.
								</span>
							</span>
						</label>
						<label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border p-3">
							<input
								type="radio"
								name="weight-unpriceable"
								checked={onUnpriceable === "block"}
								onChange={() => setOnUnpriceable("block")}
								className="mt-0.5 size-4 shrink-0 accent-accent"
							/>
							<span className="flex flex-col gap-0.5">
								<span className="text-sm font-medium">
									Don&apos;t accept the order
								</span>
								<span className="text-xs text-muted-foreground">
									Checkout is refused until every item in the cart has a parcel
									weight.
								</span>
							</span>
						</label>
					</div>

					<p className="rounded-lg bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
						<b>Weights come from your products:</b> every product choice has a
						&ldquo;Parcel weight&rdquo; field in the product editor, and the
						bulk-import sheet has a <span className="font-mono">weight_grams</span>{" "}
						column. Items without a weight follow the rule above.{" "}
						<Link to="/app/products" className="font-medium underline">
							Open Products
						</Link>
					</p>
				</div>
			) : null}

			{error ? (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			) : null}

			<Button
				type="button"
				onClick={save}
				disabled={
					saving ||
					(mode === "radius" && radiusLocked && config?.mode === "radius") ||
					(mode === "lalamove" && lalamoveLocked && config?.mode === "lalamove")
				}
				isLoading={saving}
				className="h-11 self-start"
			>
				{mode === "lalamove"
					? "Save Lalamove delivery"
					: "Save delivery charge"}
			</Button>
		</div>
	);
}

/**
 * One zone of the weight-mode rate card (86eyeea1n): name, member-state chips,
 * ascending weight bands and an optional per-zone free-above threshold. A
 * state already claimed by ANOTHER zone renders disabled — one state, one
 * zone; the sanitizer would reject the overlap, the chips make it
 * unrepresentable — with a one-line legend explaining the grey (visible on
 * mobile, where a hover tooltip isn't).
 */
function WeightZoneCard({
	zone,
	index,
	claimed,
	onPatch,
	onRemove,
}: {
	zone: ZoneDraft;
	index: number;
	/** state → owning zone index across the whole draft. */
	claimed: Map<string, number>;
	onPatch: (patch: Partial<ZoneDraft>) => void;
	onRemove: () => void;
}) {
	const hasForeignClaims = MY_STATES.some((s) => {
		const owner = claimed.get(s);
		return owner !== undefined && owner !== index;
	});
	return (
		<div className="flex flex-col gap-3.5 rounded-xl border border-border bg-card p-3.5">
			<div className="flex items-center gap-2">
				<Input
					value={zone.name}
					onChange={(e) => onPatch({ name: e.target.value })}
					placeholder={index === 0 ? "West Malaysia" : "East Malaysia"}
					aria-label={`Zone ${index + 1} name`}
					variant="field"
					className="flex-1 font-medium"
				/>
				<button
					type="button"
					onClick={onRemove}
					aria-label={`Remove zone ${index + 1}`}
					className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
				>
					<Trash2 className="size-4" />
				</button>
			</div>

			<div className="flex flex-col gap-1.5">
				<p className="text-xs font-medium text-muted-foreground">
					States in this zone
				</p>
				<div className="flex flex-wrap gap-1.5">
					{MY_STATES.map((state) => {
						const owner = claimed.get(state);
						const inThisZone = owner === index;
						return (
							<FilterChip
								key={state}
								tone="accent"
								selected={inThisZone}
								disabled={owner !== undefined && !inThisZone}
								className="disabled:cursor-not-allowed disabled:opacity-40"
								onClick={() =>
									onPatch({
										states: inThisZone
											? zone.states.filter((s) => s !== state)
											: [...zone.states, state],
									})
								}
							>
								{state}
							</FilterChip>
						);
					})}
				</div>
				{hasForeignClaims ? (
					<p className="text-xs text-muted-foreground">
						Greyed-out states are already in another zone.
					</p>
				) : null}
			</div>

			<div className="flex flex-col gap-2">
				<p className="text-xs font-medium text-muted-foreground">
					Weight bands
				</p>
				{zone.bands.map((band, i) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional drafts with no stable identity
						key={i}
						className="flex items-center gap-2"
					>
						<span className="text-xs text-muted-foreground">Up to</span>
						<Input
							type="number"
							inputMode="decimal"
							min={0.1}
							step={0.1}
							value={band.maxKg}
							onChange={(e) =>
								onPatch({
									bands: zone.bands.map((b, j) =>
										j === i ? { ...b, maxKg: e.target.value } : b,
									),
								})
							}
							variant="field"
							className="w-20"
							aria-label={`Zone ${index + 1} band ${i + 1} weight in kg`}
						/>
						<span className="text-xs text-muted-foreground">kg →</span>
						<div className="relative">
							<span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
								RM
							</span>
							<input
								type="text"
								inputMode="decimal"
								value={band.fee}
								onChange={(e) =>
									onPatch({
										bands: zone.bands.map((b, j) =>
											j === i ? { ...b, fee: e.target.value } : b,
										),
									})
								}
								onBlur={() =>
									onPatch({
										bands: zone.bands.map((b, j) =>
											j === i ? { ...b, fee: normalizePriceInput(b.fee) } : b,
										),
									})
								}
								placeholder="8.00"
								aria-label={`Zone ${index + 1} band ${i + 1} fee`}
								className="h-11 w-28 rounded-lg border border-input bg-background pl-11 pr-3 text-sm"
							/>
						</div>
						{zone.bands.length > 1 ? (
							<button
								type="button"
								onClick={() =>
									onPatch({ bands: zone.bands.filter((_, j) => j !== i) })
								}
								aria-label={`Remove zone ${index + 1} band ${i + 1}`}
								className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
							>
								<Trash2 className="size-4" />
							</button>
						) : null}
					</div>
				))}
				{zone.bands.length < DELIVERY_BANDS_MAX ? (
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="h-10 gap-1.5 self-start"
						onClick={() =>
							onPatch({ bands: [...zone.bands, { maxKg: "", fee: "" }] })
						}
					>
						<Plus className="size-4" />
						Add band
					</Button>
				) : null}
				<p className="text-xs leading-relaxed text-muted-foreground">
					An order at exactly a band&apos;s weight is inside it. Heavier than
					your last band follows the rule below. A band fee of RM0 means free
					up to that weight.
				</p>
			</div>

			<div className="flex flex-col gap-1.5">
				<label
					htmlFor={`zone-${index}-free-above`}
					className="text-xs font-medium text-muted-foreground"
				>
					Free delivery for orders above (optional)
				</label>
				<div className="relative self-start">
					<span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
						RM
					</span>
					<input
						id={`zone-${index}-free-above`}
						type="text"
						inputMode="decimal"
						value={zone.freeAbove}
						onChange={(e) => onPatch({ freeAbove: e.target.value })}
						onBlur={() =>
							onPatch({ freeAbove: normalizePriceInput(zone.freeAbove) })
						}
						placeholder="150.00"
						className="h-11 w-40 rounded-lg border border-input bg-background pl-11 pr-3 text-sm"
					/>
				</div>
				<p className="text-xs leading-relaxed text-muted-foreground">
					Orders to this zone at or above this amount ship free — whatever they
					weigh. The marketplace move: fund it from the commission you&apos;re
					not paying.
				</p>
			</div>
		</div>
	);
}

/**
 * Order-date notice setting — how many days ahead a buyer's chosen fulfilment
 * date must be. Governs the storefront date picker's earliest selectable day
 * (and counter checkout's default). Sits first in the tab: it's a checkout-wide
 * timing rule that applies to BOTH delivery and pickup, above the per-method
 * toggles. 0 = same-day allowed (ready-stock sellers).
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
		<Card>
			<SectionHeading
				title="Order date notice"
				description="How much notice you need before a buyer's chosen delivery or pickup date. Buyers can't pick a date sooner than this. Set 0 to take same-day orders."
			/>
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
		</Card>
	);
}

/**
 * Store-wide minimum order value (86ey9unyx) — the item subtotal a storefront
 * order must reach before checkout. Sits with the other order rules (next to
 * the date-notice card). Counter checkout is exempt; orders with a custom /
 * price-on-quote line are exempt (their value is settled by the seller's
 * quote). Blank or 0 = no minimum.
 */
function MinOrderValueCard({ initial }: { initial: number | undefined }) {
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
					: `Minimum order value set to ${formatPrice(sen, "MYR")}.`,
			);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	return (
		<Card>
			<SectionHeading
				title="Minimum order value"
				description="Buyers must reach this subtotal (before delivery or pickup fees) to check out — the storefront shows them exactly how much more to add. Counter checkout and custom price-on-quote orders are never blocked. Leave blank for no minimum."
			/>
			<div className="flex items-end gap-3">
				<div className="flex flex-col gap-1.5">
					<label
						htmlFor="min-order-value"
						className="text-xs font-medium text-muted-foreground"
					>
						Minimum subtotal (RM)
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
					Enter an amount up to {formatPrice(MIN_ORDER_VALUE_MAX, "MYR")}, or
					leave blank for no minimum.
				</p>
			) : null}
		</Card>
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
	onEdit,
	onToggleActive,
	dragHandle,
}: {
	location: Doc<"pickupLocations">;
	onEdit: () => void;
	onToggleActive: (next: boolean) => void;
	dragHandle?: ReactNode;
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
								+ {formatPrice(location.fee, "MYR")} fee
							</span>
						) : null}
					</div>
					<p className="text-xs text-muted-foreground whitespace-pre-line">
						{location.address}
					</p>
					{location.scheduleNote ? (
						<p className="flex items-center gap-1 text-xs font-medium text-accent">
							<Clock className="size-3 shrink-0" aria-hidden="true" />
							<span>{location.scheduleNote}</span>
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
						<p className="text-xs text-muted-foreground whitespace-pre-line">
							{location.notes}
						</p>
					) : null}
					{location.managerName || location.managerWaPhone ? (
						<p className="flex items-center gap-1 text-xs text-muted-foreground">
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
	onEdit,
	onToggleActive,
}: {
	location: Doc<"pickupLocations">;
	onEdit: () => void;
	onToggleActive: (next: boolean) => void;
}) {
	return (
		<li className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 opacity-60">
			<LocationRowBody
				location={location}
				onEdit={onEdit}
				onToggleActive={onToggleActive}
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

// --- Lalamove rider booking (86eyb5hrf) --------------------------------------

/** The deployment's Lalamove webhook endpoint — Convex HTTP actions live on
 * the `.convex.site` twin of the client's `.convex.cloud` URL. Surfaced in
 * the card so BYO sellers can paste it into their own Partner Portal. */
function lalamoveWebhookUrl(): string {
	const convexUrl = clientEnv.VITE_CONVEX_URL ?? "";
	return `${convexUrl.replace(".convex.cloud", ".convex.site")}/webhook/lalamove`;
}
