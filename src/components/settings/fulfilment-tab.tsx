import { useMutation, useQuery } from "convex/react";
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
import type { DeliveryConfig } from "../../../convex/lib/delivery";
import { DELIVERY_BANDS_MAX } from "../../../convex/lib/delivery";
import {
	DEFAULT_MIN_NOTICE_DAYS,
	MAX_NOTICE_DAYS,
} from "../../../convex/lib/fulfilmentDate";
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
import { ProBadge } from "../app/pro-gate";
import {
	GoogleAddressAutocomplete,
	type GoogleSelectedAddress,
} from "../forms/google-address-autocomplete";
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
	subscription,
}: FulfilmentTabProps) {
	const locations = useQuery(api.pickupLocations.listForRetailer, {
		retailerId,
	});
	const updateSettings = useMutation(api.retailers.updateSettings);
	const setActive = useMutation(api.pickupLocations.setActive);
	const reorder = useMutation(api.pickupLocations.reorder);
	const markPickupSetupSeen = useMutation(api.retailers.markPickupSetupSeen);

	// Fire-and-forget on first mount so step 4 of the dashboard checklist
	// dismisses. Server-side is idempotent (no-op when already true) so a
	// double-render or re-mount doesn't double-write. We don't await or surface
	// errors — failing this is purely cosmetic for the checklist.
	const seenFired = useRef(false);
	useEffect(() => {
		if (seenFired.current) return;
		seenFired.current = true;
		markPickupSetupSeen({}).catch(() => {
			seenFired.current = false; // allow retry on subsequent mount
		});
	}, [markPickupSetupSeen]);

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
						// Remount when the saved config/address change shape so local
						// draft state re-seeds from the server truth after a save.
						key={`${deliveryConfig?.mode ?? "free"}:${businessAddress?.label ?? ""}`}
						config={deliveryConfig}
						businessAddress={businessAddress}
						canUseRadius={hasFeature(subscription, "radiusDelivery")}
						lalamoveAvailable={deliveryBooking?.enabled === true}
					/>
				</div>
			</Card>

			<LalamoveBookingCard
				key={`llm:${deliveryBooking?.enabled ?? "off"}:${deliveryBooking?.hasCredentials ?? false}`}
				booking={deliveryBooking}
				businessAddress={businessAddress}
				pricingMode={deliveryConfig?.mode}
				canUseDelivery={hasFeature(subscription, "delivery")}
			/>

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

type ChargeMode = "free" | "flat" | "radius" | "lalamove";

type BandDraft = { maxKm: string; fee: string };

function bandsFromConfig(config: DeliveryConfig | undefined): BandDraft[] {
	if (config?.mode !== "radius") return [{ maxKm: "5", fee: "" }];
	return config.bands.map((b) => ({
		maxKm: String(b.maxKm),
		fee: (b.fee / 100).toFixed(2),
	}));
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
			className={`flex flex-col items-start gap-0.5 rounded-xl border-2 px-3 py-2.5 text-left transition-colors ${
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
		</button>
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
	canUseRadius,
	lalamoveAvailable,
}: {
	config: DeliveryConfig | undefined;
	businessAddress: BusinessAddress | undefined;
	canUseRadius: boolean;
	/** True when Lalamove booking is enabled — unlocks the live-quote pricing
	 * mode (the server refuses it otherwise). */
	lalamoveAvailable: boolean;
}) {
	const updateSettings = useMutation(api.retailers.updateSettings);
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
	// Business address: the autocomplete pick replaces the stored one on save.
	const [pickedAddress, setPickedAddress] =
		useState<GoogleSelectedAddress | null>(null);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// A downgraded seller sitting on a radius config can still view it and
	// switch away (clearing is un-gated server-side) — they just can't edit it.
	const radiusLocked = !canUseRadius;
	const radiusEditable = mode === "radius" && canUseRadius;
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
		} else if (mode === "lalamove") {
			// Live provider quote (86eyb5hrf) — nothing numeric to draft; keep the
			// stored onUnquotable policy (default "arrange": never lose the sale).
			nextConfig =
				config?.mode === "lalamove"
					? config
					: { mode: "lalamove", onUnquotable: "arrange" };
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
			await updateSettings({
				deliveryConfig: nextConfig,
				// Only send the address when the seller picked a new one — an
				// unchanged save must not touch (or clear) the stored address.
				...(pickedAddress && effectiveAddress
					? { businessAddress: effectiveAddress }
					: {}),
			});
			toast.success(
				mode === "free"
					? "Delivery charge turned off — delivery is free."
					: "Delivery charge saved.",
			);
			setPickedAddress(null);
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
			<div className="grid grid-cols-3 gap-2">
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
					subtitle="Radius bands"
					badge={radiusLocked ? <ProBadge /> : undefined}
				/>
				{/* Live Lalamove pricing (86eyb5hrf) — selectable once the Lalamove
				    booking card below is enabled (the server refuses it otherwise);
				    always visible to a seller already on it so they can switch away. */}
				{lalamoveAvailable ||
				config?.mode === "lalamove" ||
				mode === "lalamove" ? (
					<ModeButton
						active={mode === "lalamove"}
						onClick={() => setMode("lalamove")}
						title="Lalamove"
						subtitle="Live rider quote"
					/>
				) : null}
			</div>

			{mode === "lalamove" ? (
				<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
					Buyers pay the live Lalamove rate for their address at checkout,
					using your Lalamove booking setup (vehicle + business address). If a
					quote can&apos;t be fetched, the order is accepted with the charge
					confirmed by you afterwards.
				</p>
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

					<fieldset className="flex flex-col gap-2">
						<legend className="text-xs font-medium text-muted-foreground">
							Beyond your last band
						</legend>
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
									The order comes in with the delivery charge pending — you
									agree it with the buyer in chat, set it on the order, and the
									payment request goes out with the final total.
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
					</fieldset>
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
					(mode === "radius" && radiusLocked && config?.mode === "radius")
				}
				isLoading={saving}
				className="h-11 self-start"
			>
				Save delivery charge
			</Button>
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
	const updateSettings = useMutation(api.retailers.updateSettings);
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

/**
 * Lalamove booking setup — its own card because it's a CAPABILITY (dispatch
 * riders from order detail), orthogonal to the delivery-charge PRICING above
 * (a flat-fee store can still book riders). Enabling requires the business
 * address (set in the Delivery charge section) and credentials: the seller's
 * own Lalamove API key (BYO — they pay Lalamove directly), or, when Kedaipal
 * has platform keys configured, the master fallback (rebilled at cost).
 * Enabling is Pro-gated; disabling stays free (downgrade never traps).
 */
function LalamoveBookingCard({
	booking,
	businessAddress,
	pricingMode,
	canUseDelivery,
}: {
	booking: DeliveryBookingSummary | undefined;
	businessAddress: BusinessAddress | undefined;
	pricingMode: DeliveryConfig["mode"] | undefined;
	canUseDelivery: boolean;
}) {
	const updateSettings = useMutation(api.retailers.updateSettings);
	const [enabled, setEnabled] = useState(booking?.enabled ?? false);
	const [vehicleType, setVehicleType] = useState<"MOTORCYCLE" | "CAR">(
		booking?.vehicleType ?? "MOTORCYCLE",
	);
	// Blank inputs mean "keep the stored key" (server treats undefined as
	// no-change); the explicit remove button sends "" to clear.
	const [apiKey, setApiKey] = useState("");
	const [apiSecret, setApiSecret] = useState("");
	const [removeKeys, setRemoveKeys] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const hasStoredKey = !!booking?.apiKeyHint && !removeKeys;
	const locked = !canUseDelivery && !booking?.enabled;
	const missingAddress = !businessAddress;
	// BYO-only: booking cannot exist without the seller's own key pair — the
	// toggle stays off until keys are stored or typed (server is the real lock).
	const missingKeys =
		!hasStoredKey && !(apiKey.trim().length > 0 && apiSecret.trim().length > 0);
	const dirty =
		enabled !== (booking?.enabled ?? false) ||
		vehicleType !== (booking?.vehicleType ?? "MOTORCYCLE") ||
		apiKey.trim().length > 0 ||
		apiSecret.trim().length > 0 ||
		removeKeys;

	async function save() {
		setError(null);
		setSaving(true);
		try {
			await updateSettings({
				deliveryBooking: {
					enabled,
					vehicleType,
					apiKey: removeKeys ? "" : apiKey.trim() || undefined,
					apiSecret: removeKeys ? "" : apiSecret.trim() || undefined,
				},
			});
			toast.success(
				enabled
					? "Lalamove booking is on — book riders from any confirmed delivery order."
					: "Lalamove settings saved.",
			);
			setApiKey("");
			setApiSecret("");
			setRemoveKeys(false);
		} catch (err) {
			setError(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	return (
		<Card>
			<div className="flex items-start justify-between gap-4">
				<SectionHeading
					title="Lalamove rider booking"
					description="Book a rider in one tap from any confirmed delivery order — your buyer gets the shipped message with live tracking automatically when the rider picks up."
				/>
				<div className="flex items-center gap-2">
					{locked ? <ProBadge /> : null}
					<ToggleSwitch
						on={enabled}
						onChange={(next) => {
							if (next && (locked || missingAddress || missingKeys)) return;
							setEnabled(next);
						}}
						disabled={(locked || missingAddress || missingKeys) && !enabled}
						label="Enable Lalamove booking"
					/>
				</div>
			</div>

			{missingAddress ? (
				<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
					Add your business address first (in the Delivery charge section
					above) — it&apos;s the pickup point riders are sent to.
				</p>
			) : null}
			{locked && !missingAddress ? (
				<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
					Lalamove booking is a Pro feature — upgrade to dispatch riders
					without leaving Kedaipal.
				</p>
			) : null}
			{!locked && !missingAddress && missingKeys && !enabled ? (
				<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
					Add your Lalamove API key &amp; secret below to switch booking on —
					delivery runs entirely on your own Lalamove account.
				</p>
			) : null}

			{/* Vehicle */}
			<div className="flex flex-col gap-1.5">
				<span className="text-xs font-medium text-muted-foreground">
					Default vehicle
				</span>
				<div className="grid grid-cols-2 gap-2">
					<ModeButton
						active={vehicleType === "MOTORCYCLE"}
						onClick={() => setVehicleType("MOTORCYCLE")}
						title="Motorcycle"
						subtitle="Most orders"
					/>
					<ModeButton
						active={vehicleType === "CAR"}
						onClick={() => setVehicleType("CAR")}
						title="Car"
						subtitle="Bulky / fragile"
					/>
				</div>
			</div>

			{/* Credentials */}
			<div className="flex flex-col gap-2">
				<div className="flex items-center justify-between">
					<span className="text-xs font-medium text-muted-foreground">
						Your Lalamove account (API key)
					</span>
					{/* Vendor-facing setup guide (public asset, printable) — how to
					    open a Lalamove Business account, find the keys, top up. */}
					<a
						href="/guides/lalamove-setup.html"
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-1 text-xs font-medium text-accent hover:underline"
					>
						How to set up <ExternalLink className="size-3" />
					</a>
				</div>
				{hasStoredKey ? (
					<div className="flex items-center justify-between rounded-lg border border-input px-3 py-2 text-sm">
						<span>
							Key ending <span className="font-mono">…{booking?.apiKeyHint}</span>{" "}
							stored
						</span>
						<button
							type="button"
							onClick={() => setRemoveKeys(true)}
							className="text-xs font-medium text-destructive hover:underline"
						>
							Remove
						</button>
					</div>
				) : (
					<div className="flex flex-col gap-2">
						<Input
							type="text"
							autoComplete="off"
							value={apiKey}
							onChange={(e) => setApiKey(e.target.value)}
							placeholder="API key (pk_…)"
							className="h-11 font-mono text-sm"
						/>
						<Input
							type="password"
							autoComplete="off"
							value={apiSecret}
							onChange={(e) => setApiSecret(e.target.value)}
							placeholder="API secret (sk_…)"
							className="h-11 font-mono text-sm"
						/>
					</div>
				)}
				<p className="text-xs text-muted-foreground">
					From the Lalamove Partner Portal (partnerportal.lalamove.com) →
					Developers tab. You pay Lalamove directly from your own prepaid
					wallet — Kedaipal never books or pays on your behalf.
				</p>
			</div>

			{/* Webhook URL — BYO means EACH seller registers Kedaipal's webhook in
			    their own Partner Portal (Developers → Webhook URL, version 3).
			    Without it, bookings still work but shipped/delivered stop being
			    automatic — so it's surfaced here with one-tap copy, not buried in
			    the guide alone. */}
			{hasStoredKey || enabled ? (
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
						Paste this link in your Lalamove Partner Portal → Developers →
						Webhook URL (choose version 3). It's how your buyers get the
						automatic shipped + live-tracking updates — see the guide above.
					</p>
				</div>
			) : null}

			{/* Pricing cross-link — the charge section owns WHAT the buyer pays. */}
			{enabled && pricingMode !== "lalamove" ? (
				<p className="rounded-lg bg-accent/10 px-3 py-2 text-xs text-accent-emphasis">
					Tip: switch the Delivery charge above to <b>Lalamove — live rider
					quote</b> so buyers pay the real delivery price at checkout and you
					never absorb the cost.
				</p>
			) : null}

			{error ? (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			) : null}
			<Button
				type="button"
				onClick={save}
				disabled={saving || !dirty}
				className="h-11 w-fit px-6"
			>
				{saving ? "Saving…" : "Save Lalamove settings"}
			</Button>
		</Card>
	);
}
