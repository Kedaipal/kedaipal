/**
 * EasyParcel connection card — Settings → Integrations (z8r3fdcje2, Open API).
 * The ACCOUNT half of the EasyParcel story: connecting by signing in at
 * EasyParcel (OAuth — the seller never copies a key), the prepaid wallet, and
 * the pickup address couriers collect from. Whether the store books through
 * EasyParcel is decided in Fulfilment → Courier booking — connection and use
 * are two different questions, the Delyva/Lalamove split.
 *
 * What the card says out loud, so nothing is discovered by failing:
 *  - The connect leaves Kedaipal for EasyParcel's sign-in and comes back, and
 *    a declined, expired or failed attempt is stated here afterwards.
 *  - A grant EasyParcel stopped honouring reads "Reconnect", not "Connected".
 *  - PREPAID: the wallet balance lives here with a refresh.
 *  - A Demo account (a token claim, or "… Sandbox Account" in its name)
 *    carries the test-mode banner, and says when its prices are in another
 *    country's currency (EasyParcel issues one sandbox per login, in RM).
 *  - AMBIENT ONLY: EasyParcel couriers don't carry chilled or frozen goods.
 *
 * Owns its own reads/actions (EasyParcel has its own Convex namespace) and
 * its section shell, so a country it doesn't serve hides it completely.
 * Connecting is Pro; disconnecting never is.
 */

import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useAction, useMutation } from "convex/react";
import {
	CircleAlert,
	ExternalLink,
	FlaskConical,
	RefreshCw,
	Snowflake,
	Wallet,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { MY_STATES, postcodeRule } from "../../../convex/lib/address";
import {
	COUNTRY_CURRENCY,
	COUNTRY_LABELS,
	type Country,
} from "../../../convex/lib/country";
import type { LanePause } from "../../../convex/lib/crossBorder";
import { accountCountryMismatch } from "../../../convex/lib/easyparcel";
import { useActAsRetailerId } from "../../hooks/useActAs";
import type { FixHighlight } from "../../lib/country-setup-copy";
import { convexErrorMessage, formatPrice } from "../../lib/format";
import { parseGoogleAddress } from "../../lib/google-address";
import { easyparcelCardShown } from "../../lib/integrations-glance";
import { PARCEL_NO_PHOTO_NOTE } from "../../lib/parcel-courier-copy";
import { SPOTLIGHT_ANCHOR } from "../../lib/spotlight";
import { TONE_PANEL } from "../../lib/tone";
import { ProBadge } from "../app/pro-gate";
import { GoogleAddressAutocomplete } from "../forms/google-address-autocomplete";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { EasyparcelLogo } from "../ui/easyparcel-logo";
import { Input } from "../ui/input";
import { Skeleton } from "../ui/skeleton";
import {
	AccountCard,
	Glance,
	SectionLabel,
	SetupChecklist,
	SetupStep,
} from "./settings-primitives";

type PickupAddressDraft = {
	unit: string;
	address1: string;
	address2: string;
	city: string;
	state: string;
	postcode: string;
};

const EMPTY_ADDRESS: PickupAddressDraft = {
	unit: "",
	address1: "",
	address2: "",
	city: "",
	state: "",
	postcode: "",
};

/** How long after a connect we still toast its success — the card is
 * re-mounted by the redirect back, and a stale "connected" must not pop on
 * every later visit. */
const FRESH_ATTEMPT_MS = 2 * 60 * 1000;

export function EasyparcelCard({
	shellId,
	highlight,
	retailerId,
	canUse,
	country,
}: {
	/** The Integrations section shell this card wraps itself in — owned here
	 * so hiding the card (country not served) takes the border with it. */
	shellId: string;
	highlight: FixHighlight | undefined;
	/** The store being edited — the autocomplete bills Google per session
	 * against it and region-locks predictions to its country. */
	retailerId: Id<"retailers">;
	/** Client mirror of PLAN_FEATURES.delivery (server is the lock). */
	canUse: boolean;
	/** Store country — drives the address form's shape. */
	country: Country;
}) {
	const actAsRetailerId = useActAsRetailerId();
	const settings = useQuery(
		convexQuery(api.easyparcel.getSettings, { retailerId: actAsRetailerId }),
	).data;

	const startConnect = useMutation(api.easyparcel.startConnect);
	const refreshBalance = useAction(api.easyparcel.refreshBalance);
	const disconnect = useMutation(api.easyparcel.disconnect);
	const updateSettings = useMutation(api.easyparcel.updateSettings);

	const [busy, setBusy] = useState(false);
	const [leaving, setLeaving] = useState(false);
	const [refreshing, setRefreshing] = useState(false);
	const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
	const [address, setAddress] = useState<PickupAddressDraft | null>(null);
	const [addressError, setAddressError] = useState<string | null>(null);
	const [editingPickup, setEditingPickup] = useState(false);

	const connected = settings?.connected === true;
	const needsReconnect = settings?.needsReconnect === true;
	// A downgraded-but-connected seller keeps every control except re-enabling
	// (which lives in Fulfilment) — connection management is never gated.
	const locked = !canUse && !connected;
	const portalHost =
		country === "SG" ? "easyparcel.com/sg" : "easyparcel.com/my";

	// The redirect back from EasyParcel re-mounts this card: say "connected"
	// once, for an attempt that just landed — never on a later visit.
	const toasted = useRef(false);
	const lastAttempt = settings?.lastAttempt;
	useEffect(() => {
		if (toasted.current || !lastAttempt) return;
		if (lastAttempt.outcome !== "connected") return;
		if (Date.now() - lastAttempt.at > FRESH_ATTEMPT_MS) return;
		toasted.current = true;
		toast.success("EasyParcel connected");
	}, [lastAttempt]);

	// A failed attempt stays on the card until something newer replaces it —
	// the seller came back from EasyParcel and must see why nothing changed.
	const attemptProblem =
		lastAttempt &&
		lastAttempt.outcome !== "connected" &&
		(!connected ||
			settings?.connectedAt === undefined ||
			lastAttempt.at > settings.connectedAt)
			? lastAttempt.message
			: undefined;

	// A sandbox from the other country (EasyParcel's one-per-login sandbox is
	// MY) prices in its own currency — said, so RM quotes on an S$ store
	// don't read as a bug.
	const sandboxCountry =
		settings?.environment === "sandbox"
			? accountCountryMismatch({
					balanceCurrency: settings.balanceCurrency,
					storeCountry: country,
				})
			: undefined;
	const storedAddress = settings?.pickupAddress;
	// On a MY store EasyParcel books overseas orders only, so the lane it
	// carries is a setup step of its own — the card stays visible and
	// connectable without it, and says what's missing (Zaki, 30 Oct).
	// Optional-chained on purpose: during a rollout the page can be newer than
	// the backend, and a missing field must not take the card down.
	const lane = settings?.overseasLane as
		| {
				destination: Country;
				state: "on" | "paused" | "off";
				pause?: LanePause;
		  }
		| undefined;
	const laneStep = settings?.destinations === "abroad" ? lane : undefined;
	// No store WhatsApp number = no sender phone, and EasyParcel refuses every
	// booking — so it's a step of its own while it's missing (test-code).
	const needsPhone =
		settings !== undefined && settings.hasSenderPhone === false;
	const setupTotal = (laneStep ? 3 : 2) + (needsPhone ? 1 : 0);
	const setupDone =
		(connected && !needsReconnect ? 1 : 0) +
		(storedAddress ? 1 : 0) +
		(laneStep?.state === "on" ? 1 : 0);
	const accountStep = laneStep ? 2 : 1;
	const addressDraft: PickupAddressDraft =
		address ??
		(storedAddress
			? {
					unit: storedAddress.unit ?? "",
					address1: storedAddress.address1,
					address2: storedAddress.address2 ?? "",
					city: storedAddress.city ?? "",
					state: storedAddress.state ?? "",
					postcode: storedAddress.postcode,
				}
			: EMPTY_ADDRESS);
	const addressDirty = address !== null;

	async function run(
		fn: () => Promise<unknown>,
		successMessage?: string,
	): Promise<boolean> {
		setBusy(true);
		try {
			await fn();
			if (successMessage) toast.success(successMessage);
			return true;
		} catch (err) {
			toast.error(convexErrorMessage(err));
			return false;
		} finally {
			setBusy(false);
		}
	}

	/** Leave for EasyParcel's sign-in. The return lands back on this card. */
	async function handleConnect() {
		setLeaving(true);
		try {
			const here = window.location;
			const result = await startConnect({
				retailerId: actAsRetailerId,
				returnTo: `${here.origin}${here.pathname}${here.search}#${SPOTLIGHT_ANCHOR.easyparcel.anchor}`,
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

	async function handleRefreshBalance() {
		setRefreshing(true);
		try {
			const result = await refreshBalance({ retailerId: actAsRetailerId });
			if (!result.ok) toast.error(result.message);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setRefreshing(false);
		}
	}

	function saveAddress() {
		const draft = addressDraft;
		const postcode = postcodeRule(country);
		if (
			!draft.address1.trim() ||
			!postcode.pattern.test(draft.postcode.trim()) ||
			(country === "MY" && (!draft.city.trim() || !draft.state.trim()))
		) {
			// Mirrors the server rule, so the seller is told here rather than by
			// a refusal after a round trip.
			setAddressError(
				country === "SG"
					? "Fill in the street address and a 6-digit postal code."
					: "Fill in the street address, city, state and a 5-digit postcode.",
			);
			return;
		}
		setAddressError(null);
		void run(async () => {
			const result = await updateSettings({
				retailerId: actAsRetailerId,
				pickupAddress: {
					unit: draft.unit.trim() || undefined,
					address1: draft.address1.trim(),
					address2: draft.address2.trim() || undefined,
					city: draft.city.trim() || undefined,
					state: draft.state.trim() || undefined,
					postcode: draft.postcode.trim(),
				},
			});
			if (!result.ok) throw new Error(result.message ?? "Couldn't save");
		}, "Pickup address saved").then((ok) => {
			if (ok) {
				setAddress(null);
				setEditingPickup(false);
			}
		});
	}

	// Nothing to offer where EasyParcel isn't available, and nothing connected
	// to unwind — stay out of the tab entirely (shell included).
	if (settings && !easyparcelCardShown(settings)) return null;

	const connectButton = (label: string) => (
		<Button
			type="button"
			className="h-11 self-start"
			isLoading={leaving}
			disabled={locked || leaving || busy}
			onClick={() => void handleConnect()}
		>
			{leaving ? "Opening EasyParcel…" : label}
			{leaving ? null : <ExternalLink className="size-3.5" />}
		</Button>
	);

	return (
		<AccountCard id={shellId} highlight={highlight}>
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<div className="flex items-center gap-2.5">
						{/* The EasyParcel wordmark — what the seller sees in their own
						    account, so the card matches the account it manages (the
						    Delyva/Lalamove precedent). The heading stays in the tree for
						    structure/anchors, unseen (the image would double it). */}
						<EasyparcelLogo heightClass="h-5" />
						<h2 className="sr-only font-heading text-lg font-bold">
							EasyParcel
						</h2>
						{!canUse ? <ProBadge /> : null}
						<span className="ml-auto flex shrink-0">
							{/* Loading says nothing — "Not connected" for a beat on a
							    connected store is a false alarm (test-code F15). */}
							{settings === undefined ? (
								<Skeleton className="h-6 w-24 rounded-full" />
							) : !connected ? (
								<Glance tone="grey">Not connected</Glance>
							) : needsReconnect ? (
								<Glance tone="warn">Reconnect needed</Glance>
							) : setupDone < setupTotal ? (
								<Glance tone="warn">
									Setup {setupDone} of {setupTotal}
								</Glance>
							) : settings?.environment === "sandbox" ? (
								<Glance tone="warn">Test mode</Glance>
							) : (
								<Glance>Connected</Glance>
							)}
						</span>
					</div>
					<p className="text-sm text-muted-foreground">
						{settings?.destinations === "abroad"
							? // A MY store (z8r3fdr5yy): EasyParcel carries the overseas
								// lane only — Delyva stays the domestic courier.
								`For your orders going to ${COUNTRY_LABELS[lane?.destination ?? "SG"]} — J&T, Teleport, Aramex and more, on your own EasyParcel account. Orders within ${COUNTRY_LABELS[country]} keep booking through Delyva.`
							: `Singapore parcel couriers — J&T, SingPost, Qxpress, Ninja Van, Teleport and more — on your own EasyParcel account.${
									// An SG store's lane rides EasyParcel too — said, so the
									// seller knows it covers both (found on the /test-code pass).
									lane && lane.state !== "off"
										? ` It carries your orders to ${COUNTRY_LABELS[lane.destination]} too.`
										: ""
								}`}{" "}
						Booking is switched on under{" "}
						<Link
							to="/app/settings/delivery-pricing"
							className="-my-2 py-2 font-medium text-accent-emphasis hover:underline"
						>
							Delivery pricing → Courier booking
						</Link>
						.
					</p>
				</div>

				{settings && !settings.available && connected ? (
					<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
						EasyParcel booking isn&apos;t available for your store right now.
						Your account stays connected until you disconnect it below.
					</p>
				) : null}

				{attemptProblem ? (
					<p
						className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${TONE_PANEL.warn}`}
					>
						<CircleAlert className="mt-0.5 size-3.5 shrink-0" />
						<span>{attemptProblem}</span>
					</p>
				) : null}

				{settings === undefined ? (
					<div className="flex flex-col gap-2" aria-busy="true">
						<Skeleton className="h-4 w-2/3" />
						<Skeleton className="h-11 w-full rounded-xl" />
					</div>
				) : connected ? (
					<>
						<SectionLabel>Setup</SectionLabel>
						<SetupChecklist>
							{laneStep ? <LaneSetupStep n={1} lane={laneStep} /> : null}
							<SetupStep
								n={accountStep}
								state={needsReconnect ? "action" : "done"}
								title={
									<>
										EasyParcel account
										{settings.environment === "sandbox" ? (
											<Glance tone="warn">Demo account</Glance>
										) : settings.environment === "live" ? (
											<Glance>Live</Glance>
										) : null}
									</>
								}
								detail={
									needsReconnect ? (
										"EasyParcel stopped accepting Kedaipal's access (it can expire or be removed on their side). Reconnect — one sign-in, and your pickup address and settings are kept."
									) : (
										<>
											{settings.accountName ? (
												<strong className="font-medium text-foreground">
													{settings.accountName}
												</strong>
											) : (
												"Connected"
											)}
											{settings.accountType ? ` · ${settings.accountType}` : ""}
										</>
									)
								}
							>
								{settings.environment === "sandbox" ? (
									<p
										className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${TONE_PANEL.warn}`}
									>
										<FlaskConical className="mt-0.5 size-3.5 shrink-0" />
										<span>
											<strong>Test mode — no courier will come.</strong> This is
											an EasyParcel demo account, so bookings are simulated and
											its credit is play money. Reconnect and pick your live
											account before telling buyers.
											{sandboxCountry ? (
												<>
													{" "}
													It&apos;s a {COUNTRY_LABELS[sandboxCountry]} test
													account, so its prices and wallet show in{" "}
													{COUNTRY_CURRENCY[sandboxCountry]} — your live account
													prices in {COUNTRY_CURRENCY[country]}.
												</>
											) : null}
										</span>
									</p>
								) : null}
								<div className="mt-1 flex flex-wrap items-center gap-2">
									{connectButton(
										needsReconnect ? "Reconnect EasyParcel" : "Switch account",
									)}
								</div>
							</SetupStep>

							{/* Its own field, not the business address: a parcel courier
							    prices on the postal code, and this is where pickups happen. */}
							<SetupStep
								n={accountStep + 1}
								state={storedAddress ? "done" : "action"}
								title="Pickup address"
								detail={
									storedAddress && !editingPickup && !addressDirty ? (
										<>
											{[
												[storedAddress.unit, storedAddress.address1]
													.filter(Boolean)
													.join(" "),
												storedAddress.address2,
												`${storedAddress.postcode}${storedAddress.city && country !== "SG" ? ` ${storedAddress.city}` : ""}`,
											]
												.filter(Boolean)
												.join(", ")}{" "}
											—{" "}
											<button
												type="button"
												onClick={() => setEditingPickup(true)}
												className="-my-2 py-2 font-medium text-accent-emphasis hover:underline"
											>
												change it
											</button>
										</>
									) : (
										`Where couriers collect from. The ${postcodeRule(country).label.toLowerCase()} decides the price, so make it exact.`
									)
								}
							>
								{storedAddress && !editingPickup && !addressDirty ? null : (
									<PickupAddressFields
										retailerId={retailerId}
										country={country}
										draft={addressDraft}
										dirty={addressDirty}
										opened={editingPickup}
										disabled={busy}
										error={addressError}
										onChange={(patch) => {
											setAddress({ ...addressDraft, ...patch });
											setAddressError(null);
										}}
										onSave={saveAddress}
										onCancel={() => {
											setAddress(null);
											setAddressError(null);
											setEditingPickup(false);
										}}
									/>
								)}
							</SetupStep>

							{needsPhone ? (
								<SetupStep
									n={accountStep + 2}
									state="action"
									title="Your WhatsApp number"
									detail={
										<>
											EasyParcel gives the courier your store&apos;s number as
											the sender&apos;s contact, and won&apos;t book without it.{" "}
											<Link
												to="/app/settings"
												search={{ tab: "whatsapp" }}
												className="-my-2 py-2 font-medium text-accent-emphasis hover:underline"
											>
												Add it under Settings → WhatsApp
											</Link>
										</>
									}
								/>
							) : null}
						</SetupChecklist>

						{/* Prepaid: the wallet is the thing that fails first. */}
						<SectionLabel>Wallet</SectionLabel>
						<div className="flex items-center gap-2 rounded-xl border border-input bg-muted/30 px-3 py-2.5">
							<Wallet className="size-4 shrink-0 text-muted-foreground" />
							<span className="text-sm">
								{settings.balanceMinor !== undefined ? (
									<strong className="font-semibold">
										{formatPrice(
											settings.balanceMinor,
											// EasyParcel reports its own currency; until a read
											// carries one, the store country's is the honest guess.
											settings.balanceCurrency || COUNTRY_CURRENCY[country],
										)}
									</strong>
								) : (
									"Balance unknown"
								)}
								<span className="text-muted-foreground">
									{" "}
									· prepaid — each booking draws from this
								</span>
							</span>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="ml-auto h-11"
								isLoading={refreshing}
								disabled={needsReconnect}
								onClick={() => void handleRefreshBalance()}
							>
								<RefreshCw className="size-3.5" />
								Refresh
							</Button>
						</div>

						<p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
							<Snowflake className="mt-0.5 size-3.5 shrink-0" />
							<span>
								<strong className="text-foreground">
									Ambient parcels only.
								</strong>{" "}
								EasyParcel couriers don&apos;t take chilled or frozen goods — a
								cold parcel would be refused at pickup or discarded in transit.
							</span>
						</p>

						{settings.available ? (
							<p className="text-xs text-muted-foreground">
								{!settings.enabled
									? "Booking is currently off."
									: setupDone < setupTotal
										? "Booking is switched on, and starts once the setup above is done."
										: "Booking is on — you'll see EasyParcel on your delivery orders."}{" "}
								Manage it under{" "}
								<Link
									to="/app/settings/delivery-pricing"
									className="-my-2 py-2 font-medium text-accent-emphasis hover:underline"
								>
									Delivery pricing → Courier booking
								</Link>
								.
							</p>
						) : null}

						<div className="flex flex-wrap items-center gap-2">
							<button
								type="button"
								onClick={() => setConfirmingDisconnect(true)}
								className="ml-auto min-h-11 text-sm font-medium text-destructive hover:underline"
							>
								Disconnect
							</button>
						</div>

						<ConfirmDialog
							open={confirmingDisconnect}
							onOpenChange={setConfirmingDisconnect}
							title="Disconnect EasyParcel?"
							description="Kedaipal deletes its access to your EasyParcel account and the Book button disappears from your orders. Parcels already booked keep moving at EasyParcel, but their status here stops updating — mark those orders shipped and delivered yourself. Your pickup address goes too, so reconnecting is one sign-in plus that address."
							confirmLabel="Disconnect"
							destructive
							onConfirm={() =>
								void run(
									() => disconnect({ retailerId: actAsRetailerId }),
									"EasyParcel disconnected",
								)
							}
						/>
					</>
				) : (
					<>
						{/* Before connecting too: the lane is the other half of what
						    it takes, and the order doesn't matter. */}
						{laneStep && laneStep.state !== "on" ? (
							<SetupChecklist>
								<LaneSetupStep n={1} lane={laneStep} />
							</SetupChecklist>
						) : null}
						<ul className="flex flex-col gap-1.5 text-sm">
							<Bullet>
								<strong>One tap</strong> from the order to a booked courier — no
								re-typing addresses.
							</Bullet>
							<Bullet>
								You <strong>pick the courier</strong> and see every price before
								you spend.
							</Bullet>
							<Bullet>
								The <strong>courier&apos;s own label PDF</strong> comes back
								with the booking, and the tracking number lands on your
								buyer&apos;s order.
							</Bullet>
							<Bullet>
								Runs on <strong>your own EasyParcel account</strong> at their
								normal rates. <strong>Kedaipal adds nothing</strong> to your
								price.
							</Bullet>
						</ul>
						<p className="text-xs leading-relaxed text-muted-foreground">
							{PARCEL_NO_PHOTO_NOTE}
						</p>

						<div className="flex flex-col gap-2 rounded-xl border border-input bg-muted/30 p-3 text-sm">
							<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
								How connecting works
							</p>
							<ol className="flex list-decimal flex-col gap-1 pl-5">
								<li>
									Have an EasyParcel account —{" "}
									<a
										href={`https://${portalHost}`}
										target="_blank"
										rel="noopener noreferrer"
										className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
									>
										free at {portalHost} <ExternalLink className="size-3" />
									</a>{" "}
									— with some credit in it. EasyParcel is prepaid: each booking
									draws from your balance.
								</li>
								<li>
									Tap <span className="font-medium">Connect EasyParcel</span>.
									You&apos;ll sign in on EasyParcel&apos;s own page and choose
									the account Kedaipal books with.
								</li>
								<li>
									Tap <span className="font-medium">Allow</span> — you come
									straight back here. Kedaipal never sees your EasyParcel
									password.
								</li>
							</ol>
						</div>

						<div className="flex flex-col gap-2">
							{connectButton("Connect EasyParcel")}
							{locked ? (
								<p className="text-xs text-muted-foreground">
									Courier booking is a Pro feature — upgrade in Settings →
									Billing to connect. (Disconnecting is never locked.)
								</p>
							) : null}
						</div>
					</>
				)}
			</div>
		</AccountCard>
	);
}

function Bullet({ children }: { children: React.ReactNode }) {
	return (
		<li className="flex items-start gap-2">
			<span aria-hidden className="mt-0.5 text-accent">
				✓
			</span>
			<span>{children}</span>
		</li>
	);
}

function PickupAddressFields({
	retailerId,
	country,
	draft,
	dirty,
	disabled,
	error,
	onChange,
	onSave,
	onCancel,
	opened = false,
}: {
	retailerId: Id<"retailers">;
	country: Country;
	draft: PickupAddressDraft;
	dirty: boolean;
	disabled: boolean;
	error: string | null;
	onChange: (patch: Partial<PickupAddressDraft>) => void;
	onSave: () => void;
	onCancel: () => void;
	/** Opened from the collapsed row — Cancel folds it even before an edit. */
	opened?: boolean;
}) {
	const postcode = postcodeRule(country);
	return (
		<div className="mt-1 flex flex-col gap-2">
			{/* Search fills the fields below; they stay editable because Google
			    routinely returns a place with no postcode, and EasyParcel prices
			    on the postcode. Same component + parser as every other address. */}
			<GoogleAddressAutocomplete
				retailerId={retailerId}
				country={country}
				placeholder="Search your pickup address…"
				disabled={disabled}
				onSelect={(picked) => {
					const parsed = parseGoogleAddress(
						picked.addressComponents,
						picked.formattedAddress,
						country,
					);
					onChange({
						address1: parsed.line1,
						city: parsed.city,
						state: parsed.state,
						postcode: parsed.postcode,
					});
				}}
			/>

			{/* EasyParcel SG bookings carry the unit separately (their
			    pick_unit field) — asked for by name so nobody buries it in the
			    street line. */}
			{country === "SG" ? (
				<Input
					variant="field"
					aria-label="Unit (e.g. #05-11)"
					placeholder="Unit (e.g. #05-11)"
					value={draft.unit}
					disabled={disabled}
					onChange={(e) => onChange({ unit: e.target.value })}
				/>
			) : null}
			<Input
				variant="field"
				aria-label="Street address"
				placeholder="Street address"
				value={draft.address1}
				disabled={disabled}
				isError={error !== null && !draft.address1.trim()}
				onChange={(e) => onChange({ address1: e.target.value })}
			/>
			<Input
				variant="field"
				aria-label="Building or extra line (optional)"
				placeholder="Building, extra line (optional)"
				value={draft.address2}
				disabled={disabled}
				onChange={(e) => onChange({ address2: e.target.value })}
			/>
			<div
				className={
					country === "SG" ? "flex flex-col gap-2" : "grid grid-cols-2 gap-2"
				}
			>
				{country === "SG" ? null : (
					<Input
						variant="field"
						aria-label="City"
						placeholder="City"
						value={draft.city}
						disabled={disabled}
						isError={error !== null && !draft.city.trim()}
						onChange={(e) => onChange({ city: e.target.value })}
					/>
				)}
				<Input
					variant="field"
					aria-label={postcode.label}
					placeholder={postcode.label}
					inputMode="numeric"
					maxLength={postcode.digits}
					value={draft.postcode}
					disabled={disabled}
					isError={
						error !== null && !postcode.pattern.test(draft.postcode.trim())
					}
					onChange={(e) =>
						onChange({
							postcode: e.target.value
								.replace(/\D/g, "")
								.slice(0, postcode.digits),
						})
					}
				/>
			</div>
			{country === "SG" ? null : (
				<select
					aria-label="State"
					value={draft.state}
					disabled={disabled}
					onChange={(e) => onChange({ state: e.target.value })}
					className={`min-h-11 w-full rounded-xl border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
						error !== null && !draft.state.trim()
							? "border-destructive"
							: "border-input"
					}`}
				>
					<option value="">Select state…</option>
					{MY_STATES.map((state) => (
						<option key={state} value={state}>
							{state}
						</option>
					))}
				</select>
			)}
			{error ? (
				<p className="text-xs font-medium text-destructive">{error}</p>
			) : null}
			{dirty || opened ? (
				<div className="flex flex-wrap items-center gap-2">
					<Button
						type="button"
						className="h-11"
						isLoading={disabled}
						disabled={!dirty}
						onClick={onSave}
					>
						Save pickup address
					</Button>
					<Button
						type="button"
						variant="outline"
						className="h-11"
						disabled={disabled}
						onClick={onCancel}
					>
						Cancel
					</Button>
				</div>
			) : null}
		</div>
	);
}

/** The MY store's "Deliver to Singapore" step (z8r3fdr5yy): EasyParcel only
 * books orders going there, so until the lane is on there's nothing to book —
 * said with the way to fix it, never by hiding the card. */
function LaneSetupStep({
	n,
	lane,
}: {
	n: number;
	lane: {
		destination: Country;
		state: "on" | "paused" | "off";
		pause?: LanePause;
	};
}) {
	const where = COUNTRY_LABELS[lane.destination];
	const link = (label: string, toProducts = false) =>
		toProducts ? (
			<Link
				to="/app/products/overseas"
				search={{ first: true }}
				className="-my-2 py-2 font-medium text-accent-emphasis hover:underline"
			>
				{label}
			</Link>
		) : (
			<Link
				to="/app/settings/overseas-delivery"
				className="-my-2 py-2 font-medium text-accent-emphasis hover:underline"
			>
				{label}
			</Link>
		);
	const detail =
		lane.state === "on" ? (
			<>
				On — EasyParcel books your orders going to {where}.{" "}
				{link("Change price")}
			</>
		) : lane.pause === "awaiting_products" ? (
			<>
				Almost on — choose which products can go to {where}.{" "}
				{link("Choose products", true)}
			</>
		) : lane.pause === "courier_unavailable" ? (
			// Priced by EasyParcel, and EasyParcel isn't ready: the steps below
			// are what's missing — it turns on by itself once they're done.
			<>Turns on by itself once EasyParcel is ready — finish the steps below.</>
		) : lane.state === "paused" ? (
			<>
				Paused — buyers can&apos;t choose {where} right now. {link("See why")}
			</>
		) : (
			<>
				EasyParcel carries your orders to {where}. Turn on delivery there and
				set its price — before or after connecting, either works.{" "}
				{link(`Turn on delivery to ${where}`)}
			</>
		);
	return (
		<SetupStep
			n={n}
			state={lane.state === "on" ? "done" : "action"}
			title={`Deliver to ${where}`}
			detail={detail}
		/>
	);
}
