/**
 * Settings → Fulfilment → Delivery pricing (86eye9xd4, groups 3A + 4A + 13A).
 *
 * Delivery pricing grew to five modes, two of them page-sized forms (a
 * weight-zone rate card of up to 8 zones × 16 states × 10 bands; a live-quote
 * panel across two courier accounts), nested tab → card → section → panel.
 * It has its own page now: the modes are full-width rows with an honest
 * one-liner each, grouped under the built-in / partner labels (z8r3fdcx5k) so
 * the "who runs this?" distinction is carried by grouping — one chooser, never
 * a second look-alike selector. The selected mode's configuration owns the
 * space beside (desktop) or below (mobile) it.
 *
 * Money fields wear the shared `InputPrefixFrame` plate (the design system's
 * named home for "RM"), and km / kg ride end-plates — the same shape the
 * phone and voucher fields already use.
 */

import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	FlaskConical,
	MapPin,
	Plus,
	Trash2,
	TriangleAlert,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { MY_STATES } from "../../../convex/lib/address";
import type { Country } from "../../../convex/lib/country";
import {
	DELIVERY_BANDS_MAX,
	DELIVERY_ZONES_MAX,
	type DeliveryConfig,
	type DeliveryZone,
	deliveryModeAllowed,
	riderBookingAllowed,
} from "../../../convex/lib/delivery";
import { useActAsRetailerId } from "../../hooks/useActAs";
import { usePermission } from "../../hooks/usePermission";
import { useUpdateSettings } from "../../hooks/useUpdateSettings";
import {
	BUILTIN_PRICING_MODES,
	PRICING_MODE_UI,
	type PricingMode,
	pricingModeOf,
} from "../../lib/delivery-modes";
import {
	convexErrorMessage,
	currencySymbol,
	formatDraftPrice,
	normalizePriceInput,
	parsePriceInput,
} from "../../lib/format";
import { hasFeature, type SubscriptionView } from "../../lib/subscription";
import { cn } from "../../lib/utils";
import { jntSeedZones } from "../../lib/weight-zone-seed";
import { ProBadge } from "../app/pro-gate";
import { AppImage } from "../ui/app-image";
import { Button } from "../ui/button";
import { FilterChip } from "../ui/filter-chip";
import { Input } from "../ui/input";
import { InputPrefixFrame } from "../ui/input-prefix-frame";
import { ModeButton } from "../ui/mode-button";
import { ModeRow, ModeRowGroup } from "../ui/mode-row";
import { ToggleSwitch } from "../ui/toggle-switch";
import {
	COURIER_BOOKING_ANCHOR,
	CourierBookingSection,
} from "./courier-booking-section";
import {
	Card,
	Glance,
	HelperBullets,
	InfoDisclosure,
	SAVE_BTN_CLASS,
	SectionHeading,
	SourceLabel,
	SummaryRow,
} from "./settings-primitives";

/** Owner-only business address (the distance / rider origin) — mirrors the
 * retailers.businessAddress payload field. */
export type BusinessAddress = {
	label: string;
	latitude: number;
	longitude: number;
	placeId?: string;
	/** Unit / floor / building line (z8r3fdff8r). */
	unit?: string;
};

/** Secret-free booking summary — mirrors retailers.DeliveryBookingSummary. */
export type DeliveryBookingSummary = {
	enabled: boolean;
	vehicleType: "MOTORCYCLE" | "CAR";
	hasCredentials: boolean;
	promptBookOnPacked: boolean;
	deliveryDirection: "standard" | "collection";
	apiKeyHint?: string;
	/** Sandbox vs production, from the key prefix (86eypncfy). Undefined = a
	 * row the backfill hasn't stamped — badge nothing rather than imply live. */
	env?: "sandbox" | "production";
};

// --- Drafts -----------------------------------------------------------------

type BandDraft = { maxKm: string; fee: string };
type WeightBandDraft = { maxKg: string; fee: string };
export type ZoneDraft = {
	name: string;
	states: string[];
	bands: WeightBandDraft[];
	freeAbove: string;
};

function bandsFromConfig(config: DeliveryConfig | undefined): BandDraft[] {
	if (config?.mode !== "radius") return [{ maxKm: "5", fee: "" }];
	return config.bands.map((b) => ({
		maxKm: String(b.maxKm),
		fee: (b.fee / 100).toFixed(2),
	}));
}

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

/** A fresh zone draft — one starter band so the row structure is visible. */
function blankZoneDraft(): ZoneDraft {
	return {
		name: "",
		states: [],
		bands: [{ maxKg: "3", fee: "" }],
		freeAbove: "",
	};
}

/** "13 states · RM 8–30" — a zone's summary-row line, from the draft, so it
 * follows edits before they're saved. */
export function zoneSummary(zone: ZoneDraft, currency: string): string {
	const states = `${zone.states.length} state${zone.states.length === 1 ? "" : "s"}`;
	const fees = zone.bands
		.map((b) => parsePriceInput(b.fee.trim() ? b.fee : "0"))
		.filter((n): n is number => n !== null);
	if (fees.length === 0) return states;
	const lo = Math.min(...fees);
	const hi = Math.max(...fees);
	const amount = (n: number) => n.toFixed(2).replace(/\.00$/, "");
	const range = lo === hi ? amount(lo) : `${amount(lo)}–${amount(hi)}`;
	return `${states} · ${currencySymbol(currency)} ${range}`;
}

// --- Small shared pieces ------------------------------------------------------

/** A money field: the currency plate welded to a bare input. */
function MoneyInput({
	id,
	value,
	onChange,
	placeholder,
	currency,
	disabled,
	ariaLabel,
	className,
}: {
	id?: string;
	value: string;
	onChange: (next: string) => void;
	placeholder: string;
	currency: string;
	disabled?: boolean;
	ariaLabel?: string;
	className?: string;
}) {
	return (
		<InputPrefixFrame
			prefix={currencySymbol(currency)}
			disabled={disabled}
			className={className}
		>
			<Input
				id={id}
				type="text"
				inputMode="decimal"
				variant="bare"
				value={value}
				disabled={disabled}
				placeholder={placeholder}
				aria-label={ariaLabel}
				onChange={(e) => onChange(e.target.value)}
				onBlur={() => onChange(normalizePriceInput(value))}
			/>
		</InputPrefixFrame>
	);
}

/** A number with its unit welded on the right — "3 | kg". */
function UnitInput({
	value,
	onChange,
	unit,
	disabled,
	ariaLabel,
}: {
	value: string;
	onChange: (next: string) => void;
	unit: string;
	disabled?: boolean;
	ariaLabel: string;
}) {
	return (
		<InputPrefixFrame
			prefix={unit}
			side="end"
			disabled={disabled}
			className="w-24"
		>
			<Input
				type="number"
				inputMode="decimal"
				min={0.1}
				step={0.1}
				variant="bare"
				value={value}
				disabled={disabled}
				aria-label={ariaLabel}
				onChange={(e) => onChange(e.target.value)}
			/>
		</InputPrefixFrame>
	);
}

/**
 * Where the business address is used, and where to change it. It's edited in
 * ONE place — the Fulfilment tab's Delivery card — and this line points
 * there: "change it" in the mint spotlight, "set it first" in the red fix
 * ring, because only the second one is a problem.
 */
function BusinessAddressReference({
	address,
	present,
	missing,
}: {
	address: BusinessAddress | undefined;
	/** A verb phrase ending where the address reads — "Riders collect from". */
	present: string;
	/** A full sentence for when there's no address yet. */
	missing: string;
}) {
	if (address) {
		return (
			<p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
				<MapPin
					aria-hidden
					className="mt-0.5 size-3.5 shrink-0 text-accent-emphasis"
				/>
				<span>
					{present}{" "}
					<b className="font-medium text-foreground">{address.label}</b> —{" "}
					<Link
						to="/app/settings"
						search={{ tab: "fulfilment", spot: "business_address" }}
						className="font-medium text-accent-emphasis hover:underline"
					>
						change it
					</Link>
					.
				</span>
			</p>
		);
	}
	return (
		<div className="flex flex-col gap-2 rounded-lg bg-amber-100 px-3 py-2.5 text-xs text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
			<p>{missing}</p>
			<Link
				to="/app/settings"
				search={{ tab: "fulfilment", fix: "business_address" }}
				className="w-fit font-semibold underline underline-offset-2"
			>
				Set your business address
			</Link>
		</div>
	);
}

/** One provider line in the live-mode "Priced by" block: logo, name, a
 * five-word detail, and a status chip instead of a paragraph. */
function ProviderPricingRow({
	logo,
	brand,
	logoHeight,
	name,
	detail,
	status,
}: {
	logo: string;
	/** The logo's alt — the row names the service, the logo names who runs it. */
	brand: string;
	logoHeight: string;
	name: string;
	detail: string;
	status: "live" | "test" | "connected" | "paused" | "off";
}) {
	const chip = {
		live: { label: "Live", tone: "mint" as const },
		test: { label: "Test keys", tone: "warn" as const },
		connected: { label: "Connected", tone: "mint" as const },
		paused: { label: "Paused", tone: "grey" as const },
		off: { label: "Not connected", tone: "grey" as const },
	}[status];
	return (
		<div className="flex min-h-11 items-center justify-between gap-3">
			<span className="flex min-w-0 items-center gap-2">
				<AppImage
					src={logo}
					alt={brand}
					aspect={`${logoHeight} w-auto`}
					fill={false}
					className="shrink-0"
				/>
				<span className="truncate text-sm">
					{name}{" "}
					<span className="hidden text-xs text-muted-foreground sm:inline">
						· {detail}
					</span>
				</span>
			</span>
			<span className="flex shrink-0 items-center gap-2">
				<Glance tone={chip.tone}>{chip.label}</Glance>
				<Link
					to="/app/settings"
					search={{ tab: "integrations" }}
					className="-my-2 py-2 text-xs font-semibold text-accent-emphasis hover:underline"
				>
					{status === "off" ? "Connect" : "Manage"}
				</Link>
			</span>
		</div>
	);
}

/** A pick-one policy, as rows — the same chooser as the modes above it. */
function PolicyChoice({
	label,
	value,
	onChange,
	disabled,
	arrange,
	block,
}: {
	label: string;
	value: "arrange" | "block";
	onChange: (next: "arrange" | "block") => void;
	disabled?: boolean;
	arrange: string;
	block: string;
}) {
	return (
		<ModeRowGroup label={label}>
			<ModeRow
				active={value === "arrange"}
				disabled={disabled}
				onSelect={() => onChange("arrange")}
				title="Accept the order, arrange the charge on WhatsApp"
				description={arrange}
			/>
			<ModeRow
				active={value === "block"}
				disabled={disabled}
				onSelect={() => onChange("block")}
				title="Don't accept the order"
				description={block}
			/>
		</ModeRowGroup>
	);
}

const POLICY_WORD = {
	arrange: "Accept, arrange",
	block: "Don't accept",
} as const;

// --- The page body --------------------------------------------------------

export function DeliveryPricing({
	retailerId,
	country,
	currency,
	config,
	businessAddress,
	deliveryBooking,
	subscription,
}: {
	retailerId: Id<"retailers">;
	country: Country;
	currency: string;
	config: DeliveryConfig | undefined;
	businessAddress: BusinessAddress | undefined;
	deliveryBooking: DeliveryBookingSummary | undefined;
	subscription: SubscriptionView | undefined;
}) {
	const updateSettings = useUpdateSettings();
	const actAsRetailerId = useActAsRetailerId();
	const canUseRadius = hasFeature(subscription, "radiusDelivery");
	const canUseLalamove = hasFeature(subscription, "delivery");

	const [mode, setMode] = useState<PricingMode>(pricingModeOf(config));
	// Flat-mode drafts (display strings; minor units on the wire).
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
	// Weight-mode drafts (86eyeea1n). Both policies default to "arrange" —
	// never lose an order to a rate-card gap by default.
	const [zones, setZones] = useState<ZoneDraft[]>(() =>
		config?.mode === "weight" ? zoneDraftsFromZones(config.zones) : [],
	);
	// Which zone is open for editing. A configured seller sees summary rows;
	// a zone added or seeded opens straight away.
	const [openZone, setOpenZone] = useState<number | null>(null);
	const [openPolicy, setOpenPolicy] = useState<"bands" | "unpriceable" | null>(
		null,
	);
	const [onOutOfBands, setOnOutOfBands] = useState<"block" | "arrange">(
		config?.mode === "weight" ? config.onOutOfBands : "arrange",
	);
	const [onUnpriceable, setOnUnpriceable] = useState<"block" | "arrange">(
		config?.mode === "weight" ? config.onUnpriceable : "arrange",
	);
	// Rider options — saved WITH live pricing. Keys live in Integrations.
	const [vehicleType, setVehicleType] = useState<"MOTORCYCLE" | "CAR">(
		deliveryBooking?.vehicleType ?? "MOTORCYCLE",
	);
	const [promptBook, setPromptBook] = useState(
		deliveryBooking?.promptBookOnPacked ?? false,
	);
	// Collection service (86eyg0n8e): riders collect FROM the customer.
	const [collectionMode, setCollectionMode] = useState(
		deliveryBooking?.deliveryDirection === "collection",
	);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const hasStoredKey = !!deliveryBooking?.apiKeyHint;
	const delyvaSettings = useQuery(
		convexQuery(api.delyva.getSettings, { retailerId: actAsRetailerId }),
	).data;
	// What BIDS at checkout is the Courier-booking toggle, not mere keys.
	const delyvaArmed =
		delyvaSettings?.connected === true && delyvaSettings.enabled === true;
	const lalamoveArmed = hasStoredKey && deliveryBooking?.enabled === true;
	const liveModeSelected = mode === "live";
	const storedLiveMode = config?.mode === "live" || config?.mode === "lalamove";

	// Distance and weight-zone follow Malaysian geography; live follows the
	// booking providers (SG has Lalamove riders since z8r3fdch3r).
	const myOnlyModesHidden = !deliveryModeAllowed(country, "radius");
	const liveModeAvailable = deliveryModeAllowed(country, "live");
	const storedModeUnavailable =
		config !== undefined && !deliveryModeAllowed(country, config.mode);
	const radiusLocked = !canUseRadius;
	const radiusEditable = mode === "radius" && canUseRadius;
	const lalamoveLocked = !canUseLalamove;

	// The readiness check (4A) — only while weight is the mode, and only for a
	// reader who may see product names.
	const productsPerm = usePermission("products");
	const missingWeights = useQuery(
		convexQuery(
			api.products.missingParcelWeights,
			mode === "weight" && productsPerm.canRead ? { retailerId } : "skip",
		),
	).data;

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
			// helpful inline message, not a thrown save.
			if (zones.length === 0) {
				setError(
					"Add at least one delivery zone — or start from the J&T template.",
				);
				return;
			}
			const seenNames = new Set<string>();
			const parsedZones: DeliveryZone[] = [];
			for (const [zi, zone] of zones.entries()) {
				const name = zone.name.trim();
				if (name.length === 0) {
					setOpenZone(zi);
					setError("Every zone needs a name — e.g. West Malaysia.");
					return;
				}
				if (seenNames.has(name.toLowerCase())) {
					setOpenZone(zi);
					setError(`Two zones are both named “${name}” — rename one.`);
					return;
				}
				seenNames.add(name.toLowerCase());
				if (zone.states.length === 0) {
					setOpenZone(zi);
					setError(`Zone “${name}” needs at least one state.`);
					return;
				}
				const parsedBands: DeliveryZone["bands"] = [];
				for (const b of zone.bands) {
					const kg = Number(b.maxKg);
					const rm = parsePriceInput(b.fee.trim().length > 0 ? b.fee : "0");
					if (!Number.isFinite(kg) || kg <= 0) {
						setOpenZone(zi);
						setError(`Each band in “${name}” needs a weight greater than 0 kg`);
						return;
					}
					if (rm === null || rm < 0) {
						setOpenZone(zi);
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
						setOpenZone(zi);
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
		} else if (mode === "live") {
			// Mirrors the server gates so the failure is a helpful message.
			if (!businessAddress) {
				setError(
					!lalamoveArmed && delyvaArmed
						? "Set your business address first — it anchors your store's delivery setup."
						: collectionMode
							? "Set your business address first — it's where riders drop off what they collect."
							: "Set your business address first — it's the pickup point riders are sent to.",
				);
				return;
			}
			// At least ONE provider must be ARMED, or every checkout would block.
			if (!lalamoveArmed && !delyvaArmed) {
				setError(
					hasStoredKey || delyvaSettings?.connected
						? "Turn on at least one service under Courier booking below — live pricing quotes whatever is switched on."
						: "Connect Lalamove or Delyva under Settings → Integrations first — live prices run on your own accounts.",
				);
				return;
			}
			nextConfig = { mode: "live", onUnquotable: "block" };
		} else {
			if (!businessAddress) {
				setError(
					"Set your business address first — distances are measured from it.",
				);
				return;
			}
			const parsedBands: Array<{ maxKm: number; fee: number }> = [];
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
			// The rider options on this page (vehicle, collection service,
			// prompt-to-book) save WITH live pricing. Before 86eye9xd4 they were
			// sent only for the legacy "lalamove" mode, so on every store using
			// "live" they were editable and silently dropped. `enabled` is
			// OMITTED (the server keeps what's stored): arming or disarming
			// riders is the Courier-booking toggle's job (Zaki, 6 Sep), never a
			// side effect of saving pricing. Nor for the legacy "lalamove" mode
			// any more: this save already refuses unless a provider is ARMED, so
			// `enabled: true` could only ever re-send what was stored — and an
			// `enabled` key makes the server read the save as an Integrations
			// write, so a fulfilment-only teammate was refused for a no-op (PR
			// #367 review). The save also moves the mode on to "live".
			const bookingPatch =
				liveModeSelected && hasStoredKey
					? {
							deliveryBooking: {
								vehicleType,
								promptBookOnPacked: promptBook,
								// Explicit both ways so switching collection OFF really
								// clears it ("standard" normalizes to unset server-side).
								deliveryDirection: collectionMode
									? ("collection" as const)
									: ("standard" as const),
							},
						}
					: {};
			await updateSettings({ deliveryConfig: nextConfig, ...bookingPatch });
			toast.success(
				mode === "free"
					? "Delivery charge turned off — delivery is free."
					: mode === "live"
						? "Live courier pricing is on — buyers pay the real price for their address."
						: "Delivery charge saved.",
			);
		} catch (err) {
			setError(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	const saveDisabled =
		saving ||
		(mode === "radius" && radiusLocked && config?.mode === "radius") ||
		(liveModeSelected && lalamoveLocked && storedLiveMode);

	const saveBlock = (
		<div className="flex flex-col gap-3">
			{error ? (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			) : null}
			<Button
				type="button"
				onClick={() => void save()}
				disabled={saveDisabled}
				isLoading={saving}
				className={SAVE_BTN_CLASS}
			>
				{liveModeSelected ? "Save live pricing" : "Save delivery pricing"}
			</Button>
		</div>
	);

	// --- The chooser --------------------------------------------------------

	const builtinModes = BUILTIN_PRICING_MODES.filter(
		(m) => !(myOnlyModesHidden && (m === "radius" || m === "weight")),
	);

	const chooser = (
		<Card>
			<p className="text-sm text-muted-foreground">
				What buyers pay for delivery, added at checkout. Pickup orders are never
				charged this.
			</p>
			<ModeRowGroup label="How you charge for delivery" className="gap-2.5">
				<SourceLabel source="builtin">you set the charge</SourceLabel>
				{builtinModes.map((m) => (
					<ModeRow
						key={m}
						active={mode === m}
						onSelect={() => {
							setMode(m);
							setError(null);
						}}
						// A seller already ON radius keeps access so they can switch
						// away; a locked seller can't switch INTO it.
						disabled={
							m === "radius" && radiusLocked && config?.mode !== "radius"
						}
						title={PRICING_MODE_UI[m].title}
						description={PRICING_MODE_UI[m].description}
						badge={m === "radius" && radiusLocked ? <ProBadge /> : undefined}
					/>
				))}
				{liveModeAvailable ? (
					<>
						<SourceLabel source="partner">runs on your account</SourceLabel>
						<ModeRow
							partner
							active={liveModeSelected}
							onSelect={() => {
								setMode("live");
								setError(null);
							}}
							disabled={lalamoveLocked && !storedLiveMode}
							title={PRICING_MODE_UI.live.title}
							description={
								lalamoveLocked && !storedLiveMode
									? "Real courier prices at checkout — upgrade to Pro to turn on"
									: PRICING_MODE_UI.live.description
							}
							badge={lalamoveLocked ? <ProBadge /> : undefined}
						/>
					</>
				) : null}
			</ModeRowGroup>
			{myOnlyModesHidden ? (
				<p className="text-xs text-muted-foreground">
					Distance and weight-zone pricing are Malaysia-only for now — their
					zone maps are Malaysia-shaped.
				</p>
			) : null}
			{storedModeUnavailable ? (
				<p className="rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
					Your saved pricing uses a Malaysia-only mode, so buyers can&apos;t
					check out with delivery right now — pick another mode and save.
				</p>
			) : null}
		</Card>
	);

	// --- The selected mode's configuration ---------------------------------

	let config_: ReactNode = null;
	if (mode === "free") {
		config_ = (
			<Card>
				<SectionHeading
					title="Free delivery"
					description="Buyers pay nothing extra for delivery — it's on you."
				/>
				{saveBlock}
			</Card>
		);
	} else if (mode === "flat") {
		config_ = (
			<Card>
				<SectionHeading
					title="Flat fee"
					description="The same fee on every delivery order."
				/>
				<div className="flex flex-wrap items-start gap-4">
					<div className="flex flex-col gap-1.5">
						<label
							htmlFor="flat-delivery-fee"
							className="text-xs font-medium text-muted-foreground"
						>
							Delivery fee
						</label>
						<MoneyInput
							id="flat-delivery-fee"
							value={flatFee}
							onChange={setFlatFee}
							placeholder="8.00"
							currency={currency}
							className="w-36"
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<label
							htmlFor="free-above"
							className="text-xs font-medium text-muted-foreground"
						>
							Free for orders above (optional)
						</label>
						<MoneyInput
							id="free-above"
							value={freeAbove}
							onChange={setFreeAbove}
							placeholder="100.00"
							currency={currency}
							className="w-40"
						/>
					</div>
				</div>
				<p className="text-xs text-muted-foreground">
					An order that reaches the threshold exactly ships free.
				</p>
				{saveBlock}
			</Card>
		);
	} else if (mode === "radius") {
		config_ = (
			<>
				<Card>
					<SectionHeading
						title="Distance bands"
						description="Fees by straight-line distance from your business address."
						glance={
							<Glance tone="grey">
								{bands.length} band{bands.length === 1 ? "" : "s"}
							</Glance>
						}
					/>
					{radiusLocked ? (
						<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
							Distance pricing is a Pro feature. Your saved bands still apply to
							new orders — upgrade in Settings → Billing to change them, or pick
							Free or Flat fee (always allowed).
						</p>
					) : null}
					<BusinessAddressReference
						address={businessAddress}
						present="Measured from"
						missing="Set your business address first — distance pricing measures from it."
					/>
					<div className="flex flex-col gap-2">
						{bands.map((band, i) => (
							<div
								// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional drafts with no stable identity
								key={i}
								className="flex flex-wrap items-center gap-2"
							>
								<span className="text-xs text-muted-foreground">Up to</span>
								<UnitInput
									unit="km"
									value={band.maxKm}
									disabled={!radiusEditable}
									ariaLabel={`Band ${i + 1} distance in km`}
									onChange={(v) =>
										setBands((prev) =>
											prev.map((b, j) => (j === i ? { ...b, maxKm: v } : b)),
										)
									}
								/>
								<span aria-hidden className="text-xs text-muted-foreground">
									→
								</span>
								<MoneyInput
									value={band.fee}
									disabled={!radiusEditable}
									placeholder="5.00"
									currency={currency}
									ariaLabel={`Band ${i + 1} fee`}
									className="w-32"
									onChange={(v) =>
										setBands((prev) =>
											prev.map((b, j) => (j === i ? { ...b, fee: v } : b)),
										)
									}
								/>
								{bands.length > 1 && radiusEditable ? (
									<button
										type="button"
										onClick={() =>
											setBands((prev) => prev.filter((_, j) => j !== i))
										}
										aria-label={`Remove band ${i + 1}`}
										className="flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
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
								className="h-11 gap-1.5 self-start"
								onClick={() =>
									setBands((prev) => [...prev, { maxKm: "", fee: "" }])
								}
							>
								<Plus className="size-4" />
								Add band
							</Button>
						) : null}
					</div>
					<InfoDisclosure summary="How distance is measured">
						<HelperBullets
							items={[
								"Straight-line (“as the crow flies”) from your business address, not driving routes — pad your bands a little for real roads",
								`A band fee of ${formatDraftPrice(0, currency)} means free within that distance`,
							]}
						/>
					</InfoDisclosure>
				</Card>
				<Card>
					<SectionHeading title="Beyond your last band" />
					<PolicyChoice
						label="Beyond your last band"
						value={outOfRange}
						onChange={setOutOfRange}
						disabled={!radiusEditable}
						arrange="The order comes in with the delivery charge pending, and the buyer's WhatsApp confirmation waits with it — agree the charge, set it on the order, and that's when their confirmation goes out."
						block="Buyers outside your bands see “outside the delivery area” and can't check out with delivery."
					/>
					{saveBlock}
				</Card>
			</>
		);
	} else if (mode === "weight") {
		const readiness =
			missingWeights && missingWeights.count > 0 ? (
				<div className="flex flex-col gap-1.5 rounded-xl border border-amber-300 bg-amber-100 px-3 py-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
					<p className="flex items-start gap-2 font-semibold">
						<TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
						{missingWeights.count} product
						{missingWeights.count === 1 ? " has" : "s have"} no parcel weight —
						those orders can&apos;t be priced.
					</p>
					<ul className="flex flex-wrap gap-x-3 gap-y-1 pl-5.5">
						{missingWeights.named.map((p) => (
							<li key={p.productId}>
								<Link
									to="/app/products/$productId"
									params={{ productId: p.productId }}
									className="font-medium underline underline-offset-2"
								>
									{p.name}
								</Link>
							</li>
						))}
						{missingWeights.count > missingWeights.named.length ? (
							<li>
								<Link
									to="/app/products"
									className="font-medium underline underline-offset-2"
								>
									+{missingWeights.count - missingWeights.named.length} more in
									Products
								</Link>
							</li>
						) : null}
					</ul>
				</div>
			) : null;

		config_ = (
			<>
				<Card>
					<SectionHeading
						title="Your rate card"
						description="Buyers pay by where the order goes and what it weighs."
						glance={
							zones.length > 0 ? (
								<Glance>
									{zones.length} zone{zones.length === 1 ? "" : "s"}
								</Glance>
							) : undefined
						}
					/>
					{readiness}
					{zones.length === 0 ? (
						<div className="flex flex-col gap-3">
							<div className="flex flex-col gap-2.5 rounded-xl border border-dashed border-border p-4">
								<p className="text-sm font-semibold">Start your rate card</p>
								<p className="text-xs leading-relaxed text-muted-foreground">
									The template fills in West and East Malaysia with
									J&amp;T&apos;s published rates — replace them with what you
									actually pay.
								</p>
								<Button
									type="button"
									className="h-11"
									onClick={() => {
										setZones(zoneDraftsFromZones(jntSeedZones()));
										setOpenZone(null);
										setError(null);
									}}
								>
									Use the J&amp;T template
								</Button>
								<Button
									type="button"
									variant="outline"
									className="h-11"
									onClick={() => {
										setZones([blankZoneDraft()]);
										setOpenZone(0);
									}}
								>
									Start blank
								</Button>
							</div>
							<HelperBullets
								items={[
									`A band is a box tier — “up to 5 kg = ${formatDraftPrice(30, currency)}”`,
									"Actual weight only — if your courier bills by size, pick the safer band",
								]}
							/>
						</div>
					) : (
						<div className="flex flex-col">
							{zones.map((zone, zi) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: zones are positional drafts with no stable identity
								<div key={zi} className="flex flex-col">
									<SummaryRow
										label={
											<b className="font-semibold">
												{zone.name.trim() || `Zone ${zi + 1}`}
											</b>
										}
										sublabel={zoneSummary(zone, currency)}
										expanded={openZone === zi}
										onClick={() => setOpenZone(openZone === zi ? null : zi)}
									/>
									{openZone === zi ? (
										<div className="pb-3">
											<WeightZoneEditor
												currency={currency}
												zone={zone}
												index={zi}
												claimed={claimedStates}
												onPatch={(patch) => patchZone(zi, patch)}
												onRemove={() => {
													setZones((prev) => prev.filter((_, j) => j !== zi));
													setOpenZone(null);
												}}
											/>
										</div>
									) : null}
								</div>
							))}
							{zones.length < DELIVERY_ZONES_MAX ? (
								<Button
									type="button"
									variant="outline"
									className="mt-2 h-11 gap-1.5"
									onClick={() => {
										setZones((prev) => [...prev, blankZoneDraft()]);
										setOpenZone(zones.length);
									}}
								>
									<Plus className="size-4" />
									Add zone
								</Button>
							) : null}
							<p className="mt-3 text-xs text-muted-foreground">
								{uncoveredStates.length === 0 ? (
									`All ${MY_STATES.length} states covered.`
								) : (
									<>
										<b className="font-medium text-foreground">Not covered:</b>{" "}
										{uncoveredStates.join(", ")} — buyers there{" "}
										{onOutOfBands === "block"
											? "can't check out with delivery."
											: "can still order; you confirm the charge on WhatsApp."}
									</>
								)}
							</p>
						</div>
					)}
					<InfoDisclosure summary="How weight & zone pricing works">
						<HelperBullets
							items={[
								"Sell nationwide on your parcel courier's own rate card (J&T, DD Cold Chain, Ninja Cold…)",
								"Buyers pay by their state's zone and the order's weight — each product's parcel weight × quantity",
								"You book the courier yourself as usual; Kedaipal prices the checkout",
								<>
									Weights come from your products: each choice has a Parcel
									weight field, and the bulk-import sheet has a{" "}
									<span className="font-mono">weight_grams</span> column
								</>,
							]}
						/>
					</InfoDisclosure>
				</Card>
				<Card>
					<SectionHeading title="If an order can't be priced" />
					<div className="flex flex-col">
						<SummaryRow
							label="Outside your zones or too heavy"
							value={POLICY_WORD[onOutOfBands]}
							expanded={openPolicy === "bands"}
							onClick={() =>
								setOpenPolicy(openPolicy === "bands" ? null : "bands")
							}
						/>
						{openPolicy === "bands" ? (
							<div className="pb-3">
								<PolicyChoice
									label="Outside your zones or too heavy"
									value={onOutOfBands}
									onChange={setOnOutOfBands}
									arrange="The order comes in with the delivery charge pending — you agree it with the buyer in chat, set it on the order, and the payment request goes out with the final total."
									block="Buyers in a state you don't cover — or with an order heavier than your last band — can't check out with delivery."
								/>
							</div>
						) : null}
						<SummaryRow
							label="Weight unknown"
							sublabel="An item with no parcel weight, or a custom item"
							value={POLICY_WORD[onUnpriceable]}
							expanded={openPolicy === "unpriceable"}
							onClick={() =>
								setOpenPolicy(
									openPolicy === "unpriceable" ? null : "unpriceable",
								)
							}
						/>
						{openPolicy === "unpriceable" ? (
							<div className="pb-3">
								<PolicyChoice
									label="Weight unknown"
									value={onUnpriceable}
									onChange={setOnUnpriceable}
									arrange="Recommended — a missing weight never costs you the order. The charge comes in pending, like out-of-zone orders."
									block="Checkout is refused until every item in the cart has a parcel weight."
								/>
							</div>
						) : null}
					</div>
					<InfoDisclosure summary="What “arrange” means">
						<HelperBullets
							items={[
								"The order arrives with the delivery charge pending",
								"You agree the amount with the buyer on WhatsApp",
								"Set it on the order — the payment request goes out with the final total",
							]}
						/>
					</InfoDisclosure>
					{saveBlock}
				</Card>
			</>
		);
	} else {
		// live
		config_ = (
			<>
				<Card>
					<SectionHeading
						title="Live courier price"
						description="Buyers pay the real courier price for their address."
					/>
					<div className="flex flex-col gap-1 rounded-xl border border-border px-3 py-1">
						<ProviderPricingRow
							logo="/img/lalamove-logo.svg"
							brand="Lalamove"
							logoHeight="h-3.5"
							name="Riders"
							detail="Same-day, around your city"
							status={
								lalamoveArmed
									? deliveryBooking?.env === "sandbox"
										? "test"
										: deliveryBooking?.env === "production"
											? "live"
											: "connected"
									: hasStoredKey
										? "paused"
										: "off"
							}
						/>
						<ProviderPricingRow
							logo="/img/delyva-logo.png"
							brand="Delyva"
							logoHeight="h-2.5"
							name="Couriers"
							detail="Nationwide parcels, cheapest service"
							status={
								delyvaArmed
									? delyvaSettings?.isDemo
										? "test"
										: "live"
									: delyvaSettings?.connected
										? "paused"
										: "off"
							}
						/>
					</div>
					{!lalamoveArmed && !delyvaArmed ? (
						<p className="rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
							Nothing can quote yet, so delivery checkout would be refused —
							connect a courier in{" "}
							<Link
								to="/app/settings"
								search={{ tab: "integrations" }}
								className="font-semibold underline underline-offset-2"
							>
								Integrations
							</Link>{" "}
							and switch it on under Courier booking below.
						</p>
					) : null}
					{(lalamoveArmed && deliveryBooking?.env === "sandbox") ||
					(delyvaArmed && delyvaSettings?.isDemo) ? (
						<p className="flex items-start gap-2 rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
							<FlaskConical aria-hidden className="mt-0.5 size-3.5 shrink-0" />
							<span>
								<b>Test mode</b> — bookings simulate and buyers see test prices.
								Swap in live keys under Integrations before telling buyers.
							</span>
						</p>
					) : null}
					{delyvaArmed &&
					delyvaSettings?.defaultItemType &&
					delyvaSettings.defaultItemType !== "PARCEL" ? (
						<p className="rounded-lg bg-amber-100 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
							Parcel type is{" "}
							<b>
								{delyvaSettings.defaultItemType === "FROZEN"
									? "Frozen"
									: "Chilled"}
							</b>
							, so only a cold-chain courier can price checkout — with no cold
							service on your Delyva account,{" "}
							<b>delivery checkout is refused</b>. Ask Delyva to enable one, or
							set the type to Parcel in Integrations.
						</p>
					) : null}
					{lalamoveLocked ? (
						<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
							Live courier pricing is a Pro feature. Your setup still applies to
							new orders — upgrade in Settings → Billing to change it, or pick
							Free or Flat fee (always allowed).
						</p>
					) : null}
					<InfoDisclosure summary="How live pricing works">
						<HelperBullets
							variant="check"
							items={[
								"Buyers see the real courier price before ordering",
								"An address no courier can price can't check out — you never work out a charge yourself",
								lalamoveArmed && delyvaArmed
									? "Both couriers quote and the buyer pays the higher — book the cheaper one and the difference is yours"
									: "Switch both couriers on and the buyer pays the higher quote — book the cheaper one",
								"Your own courier accounts and wallets — Kedaipal never pays for you",
							]}
						/>
					</InfoDisclosure>
					{hasStoredKey ? (
						<InfoDisclosure summary="Lalamove's limits — good to know">
							<HelperBullets
								items={[
									"Serves your city zone, roughly 40–70 km, never across zones",
									"Bike and car cover the same area — the difference is size and price",
									"Far buyers see “too far” and can't pick delivery",
									delyvaArmed
										? "Beyond the zone your Delyva couriers still quote, so checkout keeps working as a parcel"
										: "Keep self-collect on as their fallback",
								]}
							/>
						</InfoDisclosure>
					) : null}
					{hasStoredKey ? null : saveBlock}
				</Card>
				{hasStoredKey ? (
					<Card>
						<SectionHeading
							title="Rider options"
							description="How Lalamove riders run for your store — saved with live pricing."
						/>
						<BusinessAddressReference
							address={businessAddress}
							present={
								collectionMode
									? "Riders bring collected orders to"
									: "Riders collect from"
							}
							missing={
								collectionMode
									? "Set your business address first — it's where riders bring collected orders."
									: "Set your business address first — it's the exact point riders are sent to."
							}
						/>
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
								Just the default — switch per order when you book.
							</p>
						</div>
						<OptionRow
							title="Collection service"
							on={collectionMode}
							onChange={setCollectionMode}
							disabled={lalamoveLocked}
							description={
								collectionMode
									? "On — riders collect from your customer and bring the order to you."
									: "Off — riders deliver from you to the customer."
							}
							notice={
								collectionMode !==
								(deliveryBooking?.deliveryDirection === "collection") ? (
									<p className="text-xs text-amber-700 dark:text-amber-400">
										Applies to <b className="font-medium">new orders</b> —
										orders already placed keep the arrangement they promised
										their buyer.
									</p>
								) : null
							}
						>
							<InfoDisclosure summary="When to use collection">
								<HelperBullets
									items={[
										"For businesses that collect items from customers — cleaning, repair, laundry",
										"Checkout asks buyers for a collection address",
										"Order steps stay yours to advance — “picked up” isn't “delivered” here",
										"The return trip after your work is a separate order",
										<>
											Rename your order steps to match (e.g. Collecting →
											Cleaning → Ready) in{" "}
											<Link
												to="/app/settings"
												search={{ tab: "order-status" }}
												className="font-medium text-accent-emphasis hover:underline"
											>
												Order status
											</Link>
										</>,
									]}
								/>
							</InfoDisclosure>
						</OptionRow>
						<OptionRow
							title="Ask to book when I mark an order Packed"
							on={promptBook}
							onChange={setPromptBook}
							disabled={lalamoveLocked}
							description={
								promptBook
									? "On — a paid, same-day delivery order marked Packed opens the booking dialog with today's price. Nothing books until you confirm."
									: "Off — you open Book delivery yourself when you're ready."
							}
						/>
						{saveBlock}
					</Card>
				) : null}
			</>
		);
	}

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col gap-6 xl:grid xl:grid-cols-2 xl:items-start">
				{chooser}
				<div className="flex min-w-0 flex-col gap-6">{config_}</div>
			</div>
			{/* Rides along with pricing (3A): what a buyer pays and which couriers
			    can be booked are decided side by side. Independent toggles, not
			    a radio — a store may arm riders AND couriers and pick per order. */}
			<Card id={COURIER_BOOKING_ANCHOR}>
				<CourierBookingSection
					deliveryBooking={deliveryBooking}
					chargeMode={config?.mode}
					canUse={canUseLalamove}
					riderBookingAvailable={riderBookingAllowed(country)}
				/>
			</Card>
		</div>
	);
}

/** A labelled on/off option with its one-line consequence. */
function OptionRow({
	title,
	description,
	on,
	onChange,
	disabled,
	notice,
	children,
}: {
	title: string;
	description: string;
	on: boolean;
	onChange: (next: boolean) => void;
	disabled?: boolean;
	notice?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-2 rounded-xl border border-border p-3">
			<div className="flex items-start justify-between gap-4">
				<div className="flex min-w-0 flex-col gap-0.5">
					<p className="text-sm font-medium">{title}</p>
					<p className="text-xs leading-relaxed text-muted-foreground">
						{description}
					</p>
				</div>
				<ToggleSwitch
					on={on}
					onChange={onChange}
					disabled={disabled}
					label={title}
				/>
			</div>
			{notice}
			{children}
		</div>
	);
}

/**
 * One zone of the rate card, opened for editing (86eyeea1n): name, member-
 * state chips, ascending weight bands and an optional free-above threshold. A
 * state already claimed by ANOTHER zone renders disabled — one state, one
 * zone; the sanitizer would reject the overlap, the chips make it
 * unrepresentable — with a one-line legend explaining the grey.
 */
function WeightZoneEditor({
	zone,
	currency,
	index,
	claimed,
	onPatch,
	onRemove,
}: {
	zone: ZoneDraft;
	currency: string;
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
	const ownStates = zone.states.length;
	const freeStates = MY_STATES.filter((s) => !claimed.has(s));
	return (
		<div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-3.5">
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
					className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
				>
					<Trash2 className="size-4" />
				</button>
			</div>

			<div className="flex flex-col gap-1.5">
				<div className="flex items-center justify-between gap-2">
					<p className="text-xs font-medium text-muted-foreground">
						States in this zone
					</p>
					{/* Bulk affordances on a 16-chip list: take every state no other
					    zone holds, or clear this zone's. */}
					<span className="flex items-center gap-3 text-xs">
						<button
							type="button"
							disabled={freeStates.length === 0}
							onClick={() =>
								onPatch({ states: [...zone.states, ...freeStates] })
							}
							className="-my-2 py-2 font-semibold text-accent-emphasis hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
						>
							Add the rest ({freeStates.length})
						</button>
						<button
							type="button"
							disabled={ownStates === 0}
							onClick={() => onPatch({ states: [] })}
							className="-my-2 py-2 font-semibold text-accent-emphasis hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
						>
							Clear ({ownStates})
						</button>
					</span>
				</div>
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
						className="flex flex-wrap items-center gap-2"
					>
						<span className="text-xs text-muted-foreground">Up to</span>
						<UnitInput
							unit="kg"
							value={band.maxKg}
							ariaLabel={`Zone ${index + 1} band ${i + 1} weight in kg`}
							onChange={(v) =>
								onPatch({
									bands: zone.bands.map((b, j) =>
										j === i ? { ...b, maxKg: v } : b,
									),
								})
							}
						/>
						<span aria-hidden className="text-xs text-muted-foreground">
							→
						</span>
						<MoneyInput
							value={band.fee}
							placeholder="8.00"
							currency={currency}
							ariaLabel={`Zone ${index + 1} band ${i + 1} fee`}
							className="w-32"
							onChange={(v) =>
								onPatch({
									bands: zone.bands.map((b, j) =>
										j === i ? { ...b, fee: v } : b,
									),
								})
							}
						/>
						{zone.bands.length > 1 ? (
							<button
								type="button"
								onClick={() =>
									onPatch({ bands: zone.bands.filter((_, j) => j !== i) })
								}
								aria-label={`Remove zone ${index + 1} band ${i + 1}`}
								className="flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
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
						className="h-11 gap-1.5 self-start"
						onClick={() =>
							onPatch({ bands: [...zone.bands, { maxKg: "", fee: "" }] })
						}
					>
						<Plus className="size-4" />
						Add band
					</Button>
				) : null}
				<p className="text-xs leading-relaxed text-muted-foreground">
					An order at exactly a band&apos;s weight is inside it; heavier than
					your last band follows your rule below.
				</p>
			</div>

			<div className="flex flex-col gap-1.5">
				<label
					htmlFor={`zone-${index}-free-above`}
					className="text-xs font-medium text-muted-foreground"
				>
					Free delivery above (optional)
				</label>
				<MoneyInput
					id={`zone-${index}-free-above`}
					value={zone.freeAbove}
					onChange={(v) => onPatch({ freeAbove: v })}
					placeholder="150.00"
					currency={currency}
					className={cn("w-40")}
				/>
				<p className="text-xs text-muted-foreground">
					Ships free at this amount, whatever it weighs.
				</p>
			</div>
		</div>
	);
}
