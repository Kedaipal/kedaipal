/**
 * Settings → Fulfilment → Delivery to Singapore / Malaysia (z8r3fdr5yy).
 *
 * The store's one overseas lane: a switch, the seller's OWN price for the
 * other country, and the two things that decide what actually ships — which
 * products can go, and how the parcel gets there. Its own page because the
 * price is a small form of its own and the "what ships" pass is a list.
 *
 * Every reason the switch can't move is said where the seller is clicking,
 * with the fix one tap away (Zaki: "give a shortcut there") — Starter →
 * Upgrade, delivery off → Fulfilment, live courier pricing → Delivery pricing.
 */

import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { CircleCheck, ExternalLink, Globe, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Country } from "../../../convex/lib/country";
import {
	CROSS_BORDER_MIN_NOTICE_DAYS,
	type CrossBorderLane,
	countryName,
	domesticOnlyCouriersDeliver,
	type LanePause,
	laneCountriesFor,
	lanePause,
} from "../../../convex/lib/crossBorder";
import { DELIVERY_BANDS_MAX } from "../../../convex/lib/delivery";
import { useActAsRetailerId } from "../../hooks/useActAs";
import { usePermission } from "../../hooks/usePermission";
import { useUpdateSettings } from "../../hooks/useUpdateSettings";
import { convexErrorMessage } from "../../lib/format";
import {
	draftFromLane,
	type LaneDraft,
	type LanePriceKind,
	laneBlockCopy,
	laneFromDraft,
} from "../../lib/overseas-delivery";
import { hasFeature, type SubscriptionView } from "../../lib/subscription";
import { TONE_PANEL } from "../../lib/tone";
import { cn } from "../../lib/utils";
import { ProBadge, ProFeatureTease, UpgradeLink } from "../app/pro-gate";
import { Button } from "../ui/button";
import { ModeRow, ModeRowGroup } from "../ui/mode-row";
import { ToggleSwitch } from "../ui/toggle-switch";
import { MoneyInput, UnitInput } from "./delivery-pricing";
import { ParcelBoxGuide } from "./parcel-box-guide";
import {
	Card,
	Glance,
	HelperBullets,
	SAVE_BTN_CLASS,
	SectionHeading,
	SourceLabel,
} from "./settings-primitives";

const KIND_UI: Record<LanePriceKind, { title: string; line: string }> = {
	flat: {
		title: "Flat fee",
		line: "One price for every order going overseas.",
	},
	weight: {
		title: "By weight",
		line: "Priced by the parcel's weight — closest to what couriers charge you.",
	},
	free: {
		title: "Free — you cover the courier",
		line: "Buyers pay nothing for delivery; you pay the courier on every order.",
	},
	live: {
		title: "Priced live by EasyParcel",
		line: "Each buyer pays the courier's real price for their parcel, quoted at checkout from its weight — no price to set.",
	},
};

/** The two halves of the chooser (the Delivery pricing pattern): prices the
 * seller sets, then the partner that prices for them. */
const OWN_KINDS: LanePriceKind[] = ["flat", "weight", "free"];

export function OverseasDelivery({
	retailerId,
	storeCountry,
	currency,
	subscription,
	offerDelivery,
	lanes,
	start,
}: {
	retailerId: Id<"retailers">;
	storeCountry: Country;
	currency: string;
	subscription: SubscriptionView | undefined;
	offerDelivery: boolean | undefined;
	lanes: CrossBorderLane[] | undefined;
	/** Arrived from "Set your own price" / "Use EasyParcel live price" on the
	 * Delivery-at-a-glance card: open with that option already chosen. */
	start?: "own" | "live";
}) {
	const navigate = useNavigate();
	const updateSettings = useUpdateSettings();
	const productsPerm = usePermission("products");
	const destination = laneCountriesFor(storeCountry)[0];
	const where = countryName(destination);
	const storedLane = lanes?.find((l) => l.country === destination);

	// The store-wide half is judged here (it gates the switch); the lane's own
	// holds — awaiting products, EasyParcel not ready — come from the server,
	// which is the only side that can see the EasyParcel connection.
	const storePause = lanePause({
		planAllows: hasFeature(subscription, "crossBorder"),
		offerDelivery,
	});
	// Arriving to start one of the two ways opens the form on it — unless a
	// lane already exists or the store can't take one yet (the switch says why).
	const [enabling, setEnabling] = useState(
		() =>
			start !== undefined && storedLane === undefined && storePause === null,
	);
	const [draft, setDraft] = useState<LaneDraft>(() => {
		const seeded = draftFromLane(storedLane);
		return start === "live" && storedLane === undefined
			? { ...seeded, kind: "live" }
			: seeded;
	});
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const patch = (next: Partial<LaneDraft>) =>
		setDraft((prev) => ({ ...prev, ...next }));

	const overview = useQuery(
		convexQuery(api.crossBorder.settingsOverview, { retailerId }),
	).data;
	const pause: LanePause | null = storePause ?? overview?.lanes.pause ?? null;
	// EasyParcel's state, for the live option: connected? what's missing?
	const actAsRetailerId = useActAsRetailerId();
	const easyparcel = useQuery(
		convexQuery(api.easyparcel.getSettings, { retailerId: actAsRetailerId }),
	).data;
	const startConnect = useMutation(api.easyparcel.startConnect);
	const [leaving, setLeaving] = useState(false);
	async function connectEasyparcel() {
		setLeaving(true);
		try {
			const here = window.location;
			const result = await startConnect({
				retailerId: actAsRetailerId,
				// Back here, where the lane waiting on it turns on by itself.
				returnTo: `${here.origin}${here.pathname}${here.search}`,
			});
			if (!result.ok) {
				toast.error(result.message);
				setLeaving(false);
				return;
			}
			window.location.assign(result.url);
		} catch (err) {
			toast.error(convexErrorMessage(err));
			setLeaving(false);
		}
	}
	const weightMatters = draft.kind === "weight" || draft.kind === "live";
	// Switching INTO a weight-priced option refuses while products are
	// unweighed (the server's arming gate) — said before the click, with the
	// fix, not after it (found on the /test-code pass).
	const missingWeights = useQuery(
		convexQuery(
			api.products.missingParcelWeights,
			weightMatters && productsPerm.canRead ? { retailerId } : "skip",
		),
	).data;

	const on = storedLane !== undefined;
	const unweighed = weightMatters ? (missingWeights?.count ?? 0) : 0;
	const weightsBlockSave =
		unweighed > 0 && storedLane?.pricing.kind !== draft.kind;
	const editing = on || enabling;
	// A store-wide pause keeps the price but the server refuses any change to
	// it until fixed — so the form says so instead of letting a save fail
	// after the click (found on the /test-code pass). A lane HOLD (products,
	// EasyParcel) never locks the price: switching off EasyParcel pricing is
	// one of the ways out of it.
	const lanePaused = on && storePause !== null;
	const holding =
		pause === "awaiting_products" || pause === "courier_unavailable";

	async function save() {
		setError(null);
		const parsed = laneFromDraft(draft, destination);
		if (!parsed.ok) {
			setError(parsed.error);
			return;
		}
		setSaving(true);
		try {
			await updateSettings({ crossBorderLanes: [parsed.lane] });
			if (!on) {
				// Saved, but not offered yet: it goes live once the products are
				// chosen (and, for EasyParcel pricing, once EasyParcel can quote).
				toast.success(`Saved. Now choose what can go to ${where}.`);
				// The one-time pass (Zaki, 28 Oct): every product starts able to
				// go; the seller unticks what can't, in one screen.
				void navigate({
					to: "/app/products/overseas",
					search: { first: true },
				});
			} else {
				toast.success(`Delivery price to ${where} saved.`);
			}
			setEnabling(false);
		} catch (err) {
			setError(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	async function turnOff() {
		setSaving(true);
		try {
			await updateSettings({ crossBorderLanes: null });
			toast.success(
				`Delivery to ${where} is off. Orders already placed still ship as sold.`,
			);
			setDraft(draftFromLane(undefined));
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	function onToggle(next: boolean) {
		if (next) {
			setEnabling(true);
			return;
		}
		if (on) void turnOff();
		else setEnabling(false);
	}

	// The switch can always be turned OFF; ON needs nothing to be in the way.
	const toggleDisabled = saving || (!on && storePause !== null);
	// The badge says what BUYERS get, so a flipped-but-unsaved switch reads
	// "Not saved yet", never a stale "Off" beside a switch showing on (found
	// on the /test-code pass). Nothing is live until the price is saved.
	const glance = on ? (
		pause === "awaiting_products" ? (
			<Glance tone="warn">Almost on</Glance>
		) : pause ? (
			<Glance tone="warn">Paused</Glance>
		) : (
			<Glance>On</Glance>
		)
	) : enabling ? (
		<Glance tone="warn">Not saved yet</Glance>
	) : (
		<Glance tone="grey">Off</Glance>
	);

	const linkClass =
		"inline-flex min-h-11 items-center font-semibold text-foreground underline underline-offset-2";
	const fixLink = (block: LanePause) => {
		if (block === "plan") return null;
		if (block === "delivery_off")
			return (
				<Link
					to="/app/settings"
					search={{ tab: "fulfilment" }}
					className={linkClass}
				>
					Turn on delivery
				</Link>
			);
		if (block === "awaiting_products")
			return (
				<Link
					to="/app/products/overseas"
					search={{ first: true }}
					className={linkClass}
				>
					Choose what can go
				</Link>
			);
		// courier_unavailable: the one step EasyParcel is waiting on.
		const ep = overview?.lanes.easyparcelBlock;
		if (ep === "not_connected" || ep === "reconnect_needed" || ep == null)
			return (
				<button
					type="button"
					disabled={leaving}
					onClick={() => void connectEasyparcel()}
					className={`${linkClass} self-start disabled:opacity-60`}
				>
					{ep === "reconnect_needed"
						? "Reconnect EasyParcel"
						: "Connect EasyParcel"}
				</button>
			);
		if (ep === "no_sender_phone")
			return (
				<Link
					to="/app/settings"
					search={{ tab: "whatsapp" }}
					className={linkClass}
				>
					Add your WhatsApp number
				</Link>
			);
		return (
			<Link
				to="/app/settings"
				search={{ tab: "integrations" }}
				hash="settings-easyparcel"
				className={linkClass}
			>
				Finish EasyParcel setup
			</Link>
		);
	};

	const productsLine = overview
		? `${overview.products.shipsAbroad} of ${overview.products.total} product${
				overview.products.total === 1 ? "" : "s"
			} can go to ${where}`
		: undefined;

	return (
		<div className="flex flex-col gap-6 xl:grid xl:grid-cols-2 xl:items-start">
			<div className="flex min-w-0 flex-col gap-6">
				<Card>
					<div className="flex items-start justify-between gap-3">
						<SectionHeading
							title={`Deliver to ${where}`}
							description={`Buyers can choose a ${where} address at checkout. You set the price — your ${countryName(storeCountry)} delivery price never applies to it.`}
							glance={pause === "plan" && !on ? <ProBadge /> : glance}
						/>
						<ToggleSwitch
							on={editing}
							onChange={onToggle}
							disabled={toggleDisabled}
							label={`Deliver to ${where}`}
						/>
					</div>

					{pause === "plan" && !on ? (
						<ProFeatureTease message={laneBlockCopy("plan", destination)} />
					) : null}
					{pause !== null && pause !== "plan" && !on ? (
						<div
							className={cn(
								"flex flex-col gap-1 rounded-xl border px-3.5 py-3 text-sm",
								TONE_PANEL.neutral,
							)}
						>
							<p>{laneBlockCopy(pause, destination)}</p>
							{fixLink(pause)}
						</div>
					) : null}
					{pause !== null && on ? (
						<div
							aria-live="polite"
							className={cn(
								"flex flex-col gap-1 rounded-xl border px-3.5 py-3 text-sm",
								TONE_PANEL.warn,
							)}
						>
							{pause === "awaiting_products" ? null : (
								<p className="font-semibold">
									Paused — buyers can't choose {where} right now.
								</p>
							)}
							<p>
								{laneBlockCopy(
									pause,
									destination,
									overview?.lanes.easyparcelBlock,
								)}
							</p>
							{holding ? null : (
								<p>Your price is kept and comes back on its own.</p>
							)}
							{pause === "plan" ? (
								<UpgradeLink className="mt-1 self-start" />
							) : (
								fixLink(pause)
							)}
						</div>
					) : null}
				</Card>

				{editing ? (
					<Card>
						<SectionHeading
							title={`Delivery price to ${where}`}
							description="Shown to the buyer before they order, in your store's currency."
						/>
						<fieldset
							disabled={lanePaused}
							className="flex min-w-0 flex-col gap-4 disabled:opacity-60"
						>
							<ModeRowGroup label={`How you charge for delivery to ${where}`}>
								<SourceLabel source="builtin">you set the price</SourceLabel>
								{OWN_KINDS.map((kind) => (
									<ModeRow
										key={kind}
										active={draft.kind === kind}
										onSelect={() => {
											setError(null);
											patch({ kind });
										}}
										title={KIND_UI[kind].title}
										description={KIND_UI[kind].line}
									/>
								))}
								<SourceLabel source="partner">runs on your account</SourceLabel>
								<ModeRow
									active={draft.kind === "live"}
									onSelect={() => {
										setError(null);
										patch({ kind: "live" });
									}}
									title={KIND_UI.live.title}
									description={KIND_UI.live.line}
								/>
							</ModeRowGroup>

							{draft.kind === "live" ? (
								<div className="flex flex-col gap-4">
									<EasyparcelReadiness
										settings={easyparcel}
										connecting={leaving}
										onConnect={() => void connectEasyparcel()}
										where={where}
									/>
									{unweighed > 0 ? (
										<p
											className={cn(
												"rounded-xl border px-3.5 py-3 text-xs",
												TONE_PANEL.warn,
											)}
										>
											{unweighed} product{unweighed === 1 ? " has" : "s have"}{" "}
											no parcel weight — EasyParcel prices every parcel by
											weight.{" "}
											<Link
												to="/app/products/weights"
												className="font-semibold underline underline-offset-2"
											>
												Set parcel weights
											</Link>
										</p>
									) : null}
									<ParcelBoxGuide />
									<FreeAboveField
										draft={draft}
										patch={patch}
										currency={currency}
									/>
								</div>
							) : null}

							{draft.kind === "flat" ? (
								<div className="flex flex-wrap items-start gap-4">
									<div className="flex flex-col gap-1.5">
										<label
											htmlFor="overseas-fee"
											className="text-xs font-medium text-muted-foreground"
										>
											Fee per order
										</label>
										<MoneyInput
											id="overseas-fee"
											value={draft.fee}
											onChange={(fee) => patch({ fee })}
											placeholder="25.00"
											currency={currency}
											className="w-36"
										/>
									</div>
									<FreeAboveField
										draft={draft}
										patch={patch}
										currency={currency}
									/>
								</div>
							) : null}

							{draft.kind === "weight" ? (
								<div className="flex flex-col gap-3">
									<p className="text-xs text-muted-foreground">
										Each band covers parcels up to its weight. A parcel heavier
										than your last band can't be ordered to {where} — add a band
										that fits your heaviest order.
									</p>
									<div className="flex flex-col gap-2">
										{draft.bands.map((band, i) => (
											<div
												// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional drafts with no identity of their own
												key={i}
												className="flex items-center gap-2"
											>
												<span className="text-xs text-muted-foreground">
													Up to
												</span>
												<UnitInput
													value={band.maxKg}
													unit="kg"
													ariaLabel={`Band ${i + 1} weight`}
													onChange={(maxKg) =>
														patch({
															bands: draft.bands.map((b, j) =>
																j === i ? { ...b, maxKg } : b,
															),
														})
													}
												/>
												<MoneyInput
													value={band.fee}
													currency={currency}
													placeholder="0.00"
													ariaLabel={`Band ${i + 1} fee`}
													className="w-32"
													onChange={(fee) =>
														patch({
															bands: draft.bands.map((b, j) =>
																j === i ? { ...b, fee } : b,
															),
														})
													}
												/>
												<button
													type="button"
													aria-label={`Remove band ${i + 1}`}
													disabled={draft.bands.length === 1}
													title={
														draft.bands.length === 1
															? "A weight card needs at least one band"
															: undefined
													}
													onClick={() =>
														patch({
															bands: draft.bands.filter((_, j) => j !== i),
														})
													}
													className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
												>
													<Trash2 className="size-4" />
												</button>
											</div>
										))}
									</div>
									<Button
										type="button"
										variant="outline"
										className="h-11 self-start"
										disabled={draft.bands.length >= DELIVERY_BANDS_MAX}
										onClick={() =>
											patch({ bands: [...draft.bands, { maxKg: "", fee: "" }] })
										}
									>
										<Plus />
										{draft.bands.length >= DELIVERY_BANDS_MAX
											? `${DELIVERY_BANDS_MAX} bands is the most`
											: "Add a band"}
									</Button>
									<FreeAboveField
										draft={draft}
										patch={patch}
										currency={currency}
									/>
									{missingWeights && missingWeights.count > 0 ? (
										<p
											className={cn(
												"rounded-xl border px-3.5 py-3 text-xs",
												TONE_PANEL.warn,
											)}
										>
											{missingWeights.count} product
											{missingWeights.count === 1 ? " has" : "s have"} no parcel
											weight, so a cart with{" "}
											{missingWeights.count === 1 ? "it" : "them"} can't be
											priced by weight.{" "}
											<Link
												to="/app/products/weights"
												className="font-semibold underline underline-offset-2"
											>
												Set parcel weights
											</Link>
										</p>
									) : null}
								</div>
							) : null}

							{draft.kind === "free" ? (
								<label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-border px-3.5 py-3 text-sm">
									<input
										type="checkbox"
										checked={draft.freeAcknowledged}
										onChange={(e) =>
											patch({ freeAcknowledged: e.target.checked })
										}
										className="mt-0.5 size-4 accent-[var(--accent)]"
									/>
									<span>
										I'll pay the courier myself for every order going to {where}
										.
									</span>
								</label>
							) : null}
						</fieldset>

						<div className="flex flex-col gap-3">
							{error ? (
								<p role="alert" className="text-sm text-destructive">
									{error}
								</p>
							) : null}
							<div className="flex flex-col-reverse gap-2 lg:flex-row lg:justify-end">
								{enabling && !on ? (
									<Button
										type="button"
										variant="ghost"
										className="h-11 lg:h-10"
										onClick={() => {
											setEnabling(false);
											setError(null);
										}}
									>
										Cancel
									</Button>
								) : null}
								<Button
									type="button"
									onClick={() => void save()}
									disabled={lanePaused || weightsBlockSave}
									isLoading={saving}
									className={SAVE_BTN_CLASS}
								>
									{on ? "Save price" : `Turn on delivery to ${where}`}
								</Button>
							</div>
							{weightsBlockSave && !lanePaused ? (
								<p className="text-xs text-muted-foreground">
									Saving is off until every product has a parcel weight —{" "}
									{unweighed} still {unweighed === 1 ? "needs" : "need"} one.
								</p>
							) : null}
							{lanePaused ? (
								<p className="text-xs text-muted-foreground">
									Saving is off while delivery to {where} is paused — your price
									is kept as it is. Fix the pause above to change it.
								</p>
							) : null}
						</div>
					</Card>
				) : null}
			</div>

			<div className="flex min-w-0 flex-col gap-6">
				{editing ? (
					<Card>
						<SectionHeading
							title="What can go"
							description={`Every product starts able to go to ${where}. Untick anything that can't make the trip.`}
							glance={
								productsLine ? (
									<Glance tone="grey">{productsLine}</Glance>
								) : undefined
							}
						/>
						{overview && overview.products.noParcel > 0 ? (
							<p className="text-xs text-muted-foreground">
								{overview.products.noParcel} service
								{overview.products.noParcel === 1 ? " or event" : "s or events"}{" "}
								can't go — there's no parcel to send.
							</p>
						) : null}
						{productsPerm.canRead ? (
							<Button
								type="button"
								variant="outline"
								className="h-11 self-start"
								onClick={() => void navigate({ to: "/app/products/overseas" })}
							>
								<Globe />
								Choose products
							</Button>
						) : null}
					</Card>
				) : null}

				<Card>
					<SectionHeading
						title="How overseas orders work"
						description="What changes for you and your buyers."
					/>
					<HelperBullets
						items={[
							<>
								Book the courier with EasyParcel (
								<Link
									to="/app/settings"
									search={{ tab: "integrations" }}
									hash="settings-easyparcel"
									className="font-medium text-foreground underline underline-offset-2"
								>
									Settings → Integrations
								</Link>
								), or send it with any courier and add the tracking number on
								the order. {domesticOnlyCouriersDeliver(storeCountry)} within{" "}
								{countryName(storeCountry)} only.
							</>,
							// "What can go" only exists once the switch is on — never
							// point at a card the seller can't see.
							`Keep frozen, chilled and fresh food at home — couriers refuse it across the border, and food imports have their own rules. ${
								editing
									? "Untick it under What can go."
									: "Once delivery is on, you choose which products can go."
							}`,
							`Buyers can't pick a delivery date sooner than ${CROSS_BORDER_MIN_NOTICE_DAYS} days out — a parcel across the border takes at least that — on top of any notice you've set.`,
							"Buyers pay in your store's currency. Any import tax or duty is the buyer's, collected by the courier — checkout tells them.",
							`Overseas orders are marked "Overseas · ${where}" on the order page, and the label prints the country.`,
						]}
					/>
				</Card>
			</div>
		</div>
	);
}

function FreeAboveField({
	draft,
	patch,
	currency,
}: {
	draft: LaneDraft;
	patch: (next: Partial<LaneDraft>) => void;
	currency: string;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<label
				htmlFor="overseas-free-above"
				className="text-xs font-medium text-muted-foreground"
			>
				Free for orders above (optional)
			</label>
			<MoneyInput
				id="overseas-free-above"
				value={draft.freeAbove}
				onChange={(freeAbove) => patch({ freeAbove })}
				placeholder="300.00"
				currency={currency}
				className="w-40"
			/>
		</div>
	);
}

/**
 * Where EasyParcel stands, for the live option (z8r3fdr5yy): connected and
 * ready, or the one thing still missing — with the fix in place. Saving
 * never waits on it: the lane is held until EasyParcel can quote, then goes
 * live by itself (Zaki, 30 Oct).
 */
function EasyparcelReadiness({
	settings,
	connecting,
	onConnect,
	where,
}: {
	settings:
		| {
				connected: boolean;
				needsReconnect: boolean;
				enabled: boolean;
				pickupAddress?: unknown;
				hasSenderPhone: boolean;
				environment?: string;
		  }
		| undefined;
	connecting: boolean;
	onConnect: () => void;
	where: string;
}) {
	if (settings === undefined) return null;
	const ready =
		settings.connected &&
		!settings.needsReconnect &&
		settings.enabled &&
		settings.pickupAddress !== undefined &&
		settings.hasSenderPhone;
	if (ready) {
		return (
			<p className="flex items-start gap-2 rounded-xl border border-border bg-card px-3.5 py-3 text-sm">
				<CircleCheck
					aria-hidden
					className="mt-0.5 size-4 shrink-0 text-accent"
				/>
				<span>
					EasyParcel is connected
					{settings.environment === "sandbox" ? " (test account)" : ""}. Orders
					to {where} are quoted live at checkout and booked from your EasyParcel
					wallet.
				</span>
			</p>
		);
	}
	return (
		<div
			className={cn(
				"flex flex-col gap-2 rounded-xl border px-3.5 py-3 text-sm",
				TONE_PANEL.neutral,
			)}
		>
			<p>
				{!settings.connected || settings.needsReconnect
					? `Connect your EasyParcel account to price orders to ${where}. You can save now — delivery to ${where} turns on by itself once EasyParcel is ready.`
					: `EasyParcel is connected but not ready to quote yet — finish its setup on the EasyParcel card. Delivery to ${where} turns on by itself once it's done.`}
			</p>
			{!settings.connected || settings.needsReconnect ? (
				<Button
					type="button"
					variant="outline"
					className="h-11 self-start"
					isLoading={connecting}
					onClick={onConnect}
				>
					{settings.needsReconnect
						? "Reconnect EasyParcel"
						: "Connect EasyParcel"}
					<ExternalLink className="size-3.5" />
				</Button>
			) : (
				<Link
					to="/app/settings"
					search={{ tab: "integrations" }}
					hash="settings-easyparcel"
					className="inline-flex min-h-11 items-center self-start font-semibold underline underline-offset-2"
				>
					Finish EasyParcel setup
				</Link>
			)}
		</div>
	);
}
