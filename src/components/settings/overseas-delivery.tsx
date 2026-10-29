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
import { Globe, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Country } from "../../../convex/lib/country";
import {
	type CrossBorderLane,
	countryName,
	crossBorderPricingSummary,
	laneCountriesFor,
	lanePause,
} from "../../../convex/lib/crossBorder";
import {
	DELIVERY_BANDS_MAX,
	type DeliveryConfig,
} from "../../../convex/lib/delivery";
import { usePermission } from "../../hooks/usePermission";
import { useUpdateSettings } from "../../hooks/useUpdateSettings";
import { convexErrorMessage, formatPrice } from "../../lib/format";
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
import { ProBadge, ProFeatureTease } from "../app/pro-gate";
import { Button } from "../ui/button";
import { ModeRow, ModeRowGroup } from "../ui/mode-row";
import { ToggleSwitch } from "../ui/toggle-switch";
import { MoneyInput, UnitInput } from "./delivery-pricing";
import {
	Card,
	Glance,
	HelperBullets,
	SAVE_BTN_CLASS,
	SectionHeading,
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
};

export function OverseasDelivery({
	retailerId,
	storeCountry,
	currency,
	subscription,
	offerDelivery,
	deliveryConfig,
	lanes,
}: {
	retailerId: Id<"retailers">;
	storeCountry: Country;
	currency: string;
	subscription: SubscriptionView | undefined;
	offerDelivery: boolean | undefined;
	deliveryConfig: DeliveryConfig | undefined;
	lanes: CrossBorderLane[] | undefined;
}) {
	const navigate = useNavigate();
	const updateSettings = useUpdateSettings();
	const productsPerm = usePermission("products");
	const destination = laneCountriesFor(storeCountry)[0];
	const where = countryName(destination);
	const storedLane = lanes?.find((l) => l.country === destination);
	const money = (minor: number) => formatPrice(minor, currency);

	const pause = lanePause({
		planAllows: hasFeature(subscription, "crossBorder"),
		offerDelivery,
		deliveryConfig,
	});
	const [enabling, setEnabling] = useState(false);
	const [draft, setDraft] = useState<LaneDraft>(() =>
		draftFromLane(storedLane),
	);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const patch = (next: Partial<LaneDraft>) =>
		setDraft((prev) => ({ ...prev, ...next }));

	const overview = useQuery(
		convexQuery(api.crossBorder.settingsOverview, { retailerId }),
	).data;
	const weightMatters = draft.kind === "weight";
	const missingWeights = useQuery(
		convexQuery(
			api.products.missingParcelWeights,
			weightMatters && productsPerm.canRead ? { retailerId } : "skip",
		),
	).data;

	const on = storedLane !== undefined;
	const editing = on || enabling;

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
				toast.success(`Delivery to ${where} is on. Now choose what can go.`);
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
	const toggleDisabled = saving || (!on && pause !== null);
	const glance = on ? (
		pause ? (
			<Glance tone="warn">Paused</Glance>
		) : (
			<Glance>On</Glance>
		)
	) : (
		<Glance tone="grey">Off</Glance>
	);

	const fixLink = (block: NonNullable<typeof pause>) => {
		if (block === "plan") return null;
		const to =
			block === "live_pricing"
				? ("/app/settings/delivery-pricing" as const)
				: ("/app/settings" as const);
		return (
			<Link
				to={to}
				search={block === "delivery_off" ? { tab: "fulfilment" } : undefined}
				className="inline-flex min-h-11 items-center font-semibold text-foreground underline underline-offset-2"
			>
				{block === "live_pricing"
					? "Change delivery pricing"
					: "Turn on delivery"}
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
						<ProFeatureTease
							message={laneBlockCopy("plan", storeCountry, destination)}
						/>
					) : null}
					{pause !== null && pause !== "plan" && !on ? (
						<div
							className={cn(
								"flex flex-col gap-1 rounded-xl border px-3.5 py-3 text-sm",
								TONE_PANEL.neutral,
							)}
						>
							<p>{laneBlockCopy(pause, storeCountry, destination)}</p>
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
							<p className="font-semibold">
								Paused — buyers can't choose {where} right now.
							</p>
							<p>{laneBlockCopy(pause, storeCountry, destination)}</p>
							<p>Your price is kept and comes back on its own.</p>
							{pause === "plan" ? (
								<Link
									to="/app/settings"
									search={{ tab: "billing" }}
									className="inline-flex min-h-11 items-center font-semibold text-foreground underline underline-offset-2"
								>
									Upgrade to Pro
								</Link>
							) : (
								fixLink(pause)
							)}
						</div>
					) : null}

					{on && storedLane && !enabling ? (
						<p className="text-sm text-foreground">
							<span className="text-muted-foreground">Price: </span>
							{crossBorderPricingSummary(storedLane.pricing, money)}
						</p>
					) : null}
				</Card>

				{editing ? (
					<Card>
						<SectionHeading
							title={`Delivery price to ${where}`}
							description="Shown to the buyer before they order, in your store's currency."
						/>
						<ModeRowGroup label={`How you charge for delivery to ${where}`}>
							{(Object.keys(KIND_UI) as LanePriceKind[]).map((kind) => (
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
						</ModeRowGroup>

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
										{missingWeights.count === 1 ? "it" : "them"} can't be priced
										by weight.{" "}
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
									I'll pay the courier myself for every order going to {where}.
								</span>
							</label>
						) : null}

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
									isLoading={saving}
									className={SAVE_BTN_CLASS}
								>
									{on ? "Save price" : `Turn on delivery to ${where}`}
								</Button>
							</div>
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
							storeCountry === "MY"
								? `Book the courier with EasyParcel (Settings → Integrations), or send it with any courier and add the tracking number on the order. Delyva and Lalamove deliver within Malaysia only.`
								: `Book the courier with EasyParcel, or send it with any courier and add the tracking number on the order. Lalamove riders deliver within Singapore only.`,
							"Keep frozen, chilled and fresh food at home — couriers refuse it across the border, and food imports have their own rules. Untick it under What can go.",
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
