/**
 * Delyva connection card — Settings → Integrations (86eyjpv6z, IA rework
 * 2 Sep). The ACCOUNT half of the Delyva story: the one-key connect, the
 * pickup address Delyva collects from (and activates for cold chain), the
 * store's default parcel type, and the webhook health row. Whether the store
 * actually books through Delyva is decided in Fulfilment → Courier booking —
 * connection and use are two different questions, same split as Lalamove.
 *
 * One key is genuinely all we ask: Delyva authenticates every call with it,
 * and `delyva.connect` fetches the webhook secret + customerId itself,
 * encrypts them, and registers our webhook URL. Serves BOTH Malaysia and
 * Singapore — everything country-shaped (the postal-code rule and its name,
 * whether a state tier exists, the coverage copy) keys off the store country.
 *
 * Owns its own reads/actions (Delyva has its own Convex namespace); act-as is
 * honoured the way `useUpdateSettings` does it. Connecting is Pro;
 * disconnecting never is.
 */

import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useAction, useMutation } from "convex/react";
import { ExternalLink, FlaskConical, Snowflake } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	MY_STATES,
	postcodeRule,
	SG_STATE_LABEL,
} from "../../../convex/lib/address";
import type { Country } from "../../../convex/lib/country";
import type { DelyvaItemType } from "../../../convex/lib/delyva";
import { useActAsRetailerId } from "../../hooks/useActAs";
import type { FixHighlight } from "../../lib/country-setup-copy";
import { convexErrorMessage } from "../../lib/format";
import { parseGoogleAddress } from "../../lib/google-address";
import { PARCEL_NO_PHOTO_NOTE } from "../../lib/parcel-courier-copy";
import { ProBadge } from "../app/pro-gate";
import { IntegrationWalletBlock } from "../deliveries/courier-wallets-section";
import { GoogleAddressAutocomplete } from "../forms/google-address-autocomplete";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { DelyvaLogo } from "../ui/delyva-logo";
import { Input } from "../ui/input";
import { ModeButton } from "../ui/mode-button";
import { Select } from "../ui/select";
import {
	AccountCard,
	Glance,
	SectionLabel,
	SetupChecklist,
	SetupStep,
} from "./settings-primitives";

/** Parcel types, in cold-chain order. The labels carry the temperature because
 * "chilled" vs "frozen" is exactly the pair a seller can mix up, and picking
 * wrong means the goods arrive spoiled. */
const ITEM_TYPES: ReadonlyArray<{
	value: DelyvaItemType;
	label: string;
	hint: string;
}> = [
	{ value: "PARCEL", label: "Parcel", hint: "Dry goods" },
	{ value: "CHILLED", label: "Chilled", hint: "0–4 °C" },
	{ value: "FROZEN", label: "Frozen", hint: "−18 °C" },
];

type PickupAddressDraft = {
	address1: string;
	address2: string;
	city: string;
	state: string;
	postcode: string;
};

const EMPTY_ADDRESS: PickupAddressDraft = {
	address1: "",
	address2: "",
	city: "",
	state: "",
	postcode: "",
};

export function DelyvaCard({
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
	/** Store country — drives the address form's shape (SG has no state tier
	 * and a 6-digit postal code) and the coverage copy. */
	country: Country;
}) {
	const actAsRetailerId = useActAsRetailerId();
	const settings = useQuery(
		convexQuery(api.delyva.getSettings, { retailerId: actAsRetailerId }),
	).data;

	const connect = useAction(api.delyva.connect);
	const disconnect = useAction(api.delyva.disconnect);
	const resubscribe = useAction(api.delyva.resubscribeWebhooks);
	const refreshEnvironment = useAction(api.delyva.refreshEnvironment);
	const updateSettings = useMutation(api.delyva.updateSettings);

	const [apiKey, setApiKey] = useState("");
	const [editingKey, setEditingKey] = useState(false);
	const [busy, setBusy] = useState(false);
	const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
	const [address, setAddress] = useState<PickupAddressDraft | null>(null);
	const [addressError, setAddressError] = useState<string | null>(null);
	// A set address reads as one quiet row (86eye9xd4 5A); "change it" opens
	// the editor, and a save or cancel folds it again.
	const [editingPickup, setEditingPickup] = useState(false);

	const connected = settings?.connected === true;

	// Heal a pre-detection connection's missing demo/live badge (isDemo
	// undefined) once per mount — the row then re-renders with the stamp via
	// the live query. Ref-guarded so a slow lookup never double-fires.
	const healedEnv = useRef(false);
	useEffect(() => {
		if (healedEnv.current) return;
		if (!connected || settings?.isDemo !== undefined) return;
		healedEnv.current = true;
		void refreshEnvironment({ retailerId: actAsRetailerId }).catch(() => {
			// Silent — the badge simply stays unknown until the next visit.
		});
	}, [connected, settings?.isDemo, refreshEnvironment, actAsRetailerId]);
	// A downgraded-but-connected seller keeps every control except re-enabling
	// (which lives in Fulfilment) — connection management is never gated.
	const locked = !canUse && !connected;
	// The server's answer is authoritative; while it loads, assume allowed —
	// both MY and SG are served.
	const countryBlocked = settings ? !settings.countryAllowed : false;
	const typedKey = apiKey.trim().length > 0;

	const storedAddress = settings?.pickupAddress;
	// The setup checklist's count (86eye9xd4, 5A): account, pickup address,
	// tracking webhook.
	const setupDone =
		(connected ? 1 : 0) +
		(storedAddress ? 1 : 0) +
		(settings?.webhooksSubscribed ? 1 : 0);
	const addressDraft: PickupAddressDraft =
		address ??
		(storedAddress
			? {
					address1: storedAddress.address1,
					address2: storedAddress.address2 ?? "",
					city: storedAddress.city,
					state: storedAddress.state,
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

	async function handleConnect() {
		setBusy(true);
		try {
			const result = await connect({
				retailerId: actAsRetailerId,
				apiKey: apiKey.trim(),
			});
			if (!result.ok) {
				// The action returns its reason rather than throwing — a wrong key
				// is an ordinary outcome, not an exception.
				toast.error(result.message);
				return;
			}
			setApiKey("");
			setEditingKey(false);
			toast.success(
				result.accountName
					? `Delyva connected — ${result.accountName}`
					: "Delyva connected",
			);
			if (result.isDemo) {
				toast.warning(
					"This is a Delyva DEMO account — bookings are simulated and no courier is dispatched.",
				);
			}
			if (result.bookingHeldForWeights) {
				// The key is stored; booking waited because this live store would
				// start pricing by weight with unweighed products. The card's
				// "Booking is off" line below carries the same reason and link.
				toast.warning(
					`Booking stays off until ${result.bookingHeldForWeights} product${result.bookingHeldForWeights === 1 ? " has" : "s have"} a parcel weight — see the note on this card.`,
				);
			}
			if (!result.webhooksSubscribed) {
				// Bookings still work; only automatic status updates are missing, so
				// this is a warning with a retry, never a failed connect.
				toast.warning(
					"Connected, but Delyva didn't accept our tracking webhook — use “Retry” below so orders update themselves.",
				);
			}
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setBusy(false);
		}
	}

	function saveAddress() {
		const draft = addressDraft;
		const postcode = postcodeRule(country);
		// Singapore has no state tier — the island IS the city, and the server
		// arm enforces that literal on both fields. So it is implied here rather
		// than asked for, and never blocks the save.
		const city = country === "SG" ? SG_STATE_LABEL : draft.city.trim();
		const state = country === "SG" ? SG_STATE_LABEL : draft.state.trim();
		if (
			!draft.address1.trim() ||
			!city ||
			!state ||
			!postcode.pattern.test(draft.postcode.trim())
		) {
			// Mirrors the server rule (which reads the same `postcodeRule`), so
			// the seller is told here rather than by a thrown error after a round
			// trip.
			setAddressError(
				country === "SG"
					? "Fill in the street address and a 6-digit postal code."
					: "Fill in the street address, city, state and a 5-digit postcode.",
			);
			return;
		}
		setAddressError(null);
		void run(
			() =>
				updateSettings({
					retailerId: actAsRetailerId,
					pickupAddress: {
						address1: draft.address1.trim(),
						address2: draft.address2.trim() || undefined,
						city,
						state,
						postcode: draft.postcode.trim(),
					},
				}),
			"Pickup address saved",
		).then((ok) => {
			if (ok) {
				setAddress(null);
				setEditingPickup(false);
			}
		});
	}

	// Nothing to offer in a country Delyva doesn't serve, and nothing connected
	// to unwind — stay out of the tab entirely.
	if (countryBlocked && !connected) return null;

	return (
		<AccountCard id={shellId} highlight={highlight}>
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<div className="flex items-center gap-2.5">
						{/* The DelyvaNow wordmark — what the seller sees in their own
					    portal, so the card visually matches the account it manages
					    (the Lalamove-logo precedent). */}
						<DelyvaLogo heightClass="h-5" />
						{/* The wordmark carries the visual identity; the heading stays in
					    the tree for structure/anchors, unseen (the image would double
					    it visually). */}
						<h2 className="sr-only font-heading text-lg font-bold">Delyva</h2>
						{!canUse ? <ProBadge /> : null}
						<span className="ml-auto flex shrink-0">
							{!connected ? (
								<Glance tone="grey">Not connected</Glance>
							) : setupDone < 3 ? (
								<Glance tone="warn">Setup {setupDone} of 3</Glance>
							) : settings?.isDemo ? (
								// The account step carries "Demo account"; the header says
								// what it means for the store at a glance.
								<Glance tone="warn">Test mode</Glance>
							) : (
								<Glance>Connected</Glance>
							)}
						</span>
					</div>
					<p className="text-sm text-muted-foreground">
						Nationwide and cold-chain parcel couriers — J&amp;T, DHL, Ninja and
						more — on your own Delyva account. Booking is switched on under{" "}
						<Link
							to="/app/settings/delivery-pricing"
							className="font-medium text-accent-emphasis hover:underline"
						>
							Delivery pricing → Courier booking
						</Link>
						.
					</p>
				</div>

				{countryBlocked ? (
					<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
						Delyva courier booking isn&apos;t available in your store&apos;s
						country yet — arrange your own courier and record the tracking
						number on the order. Your account stays connected until you
						disconnect it below.
					</p>
				) : null}

				{settings === undefined ? (
					<p className="text-sm text-muted-foreground">Loading…</p>
				) : connected ? (
					<>
						<SectionLabel>Setup</SectionLabel>
						<SetupChecklist>
							<SetupStep
								n={1}
								state="done"
								title={
									<>
										Account
										{settings.isDemo ? (
											<Glance tone="warn">Demo account</Glance>
										) : settings.isDemo === false ? (
											<Glance>Live</Glance>
										) : null}
									</>
								}
								detail={
									editingKey ? (
										"Paste the key from your live Delyva account."
									) : (
										<>
											{settings.accountName ? (
												<strong className="font-medium text-foreground">
													{settings.accountName}
												</strong>
											) : (
												"Connected"
											)}{" "}
											· key{" "}
											<span className="font-mono">…{settings.apiKeyHint}</span>{" "}
											·{" "}
											<button
												type="button"
												onClick={() => setEditingKey(true)}
												className="-my-2 py-2 font-medium text-accent-emphasis hover:underline"
											>
												Replace
											</button>
										</>
									)
								}
							>
								{settings.isDemo ? (
									<p className="flex items-start gap-2 rounded-lg bg-amber-100 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
										<FlaskConical className="mt-0.5 size-3.5 shrink-0" />
										<span>
											<strong>Test mode — no courier will come.</strong> This
											key belongs to Delyva&apos;s demo environment
											{settings.companyCode ? (
												<>
													{" "}
													(company{" "}
													<code className="rounded bg-amber-200/60 px-1 dark:bg-amber-900/60">
														{settings.companyCode}
													</code>
													)
												</>
											) : null}
											, so bookings are simulated and its credit is play money —
											topping up a real Delyva wallet won&apos;t change that.
											Connect the key from your live account at{" "}
											<a
												href="https://delyva.com"
												target="_blank"
												rel="noopener noreferrer"
												className="font-medium underline underline-offset-2"
											>
												delyva.com
											</a>{" "}
											before telling buyers.
										</span>
									</p>
								) : null}
								{editingKey ? (
									<div className="mt-1 flex flex-col gap-2">
										<KeyInput
											value={apiKey}
											disabled={busy}
											onChange={setApiKey}
										/>
										<div className="flex flex-wrap items-center gap-2">
											<Button
												type="button"
												className="h-11"
												isLoading={busy}
												disabled={!typedKey || busy}
												onClick={() => void handleConnect()}
											>
												Save new key
											</Button>
											<Button
												type="button"
												variant="outline"
												className="h-11"
												onClick={() => {
													setEditingKey(false);
													setApiKey("");
												}}
											>
												Keep the stored key
											</Button>
										</div>
									</div>
								) : null}
							</SetupStep>

							{/* Its own field, not the business address: a parcel courier
						    prices on postcode/state, and this is the address Delyva
						    activates for cold chain. */}
							<SetupStep
								n={2}
								state={storedAddress ? "done" : "action"}
								title="Pickup address"
								detail={
									storedAddress && !editingPickup && !addressDirty ? (
										<>
											{[
												storedAddress.address1,
												storedAddress.address2,
												`${storedAddress.postcode} ${storedAddress.city}`,
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
										`Where couriers collect from. The ${postcodeRule(country).label.toLowerCase()} decides the price, so make it exact — and match what Delyva has on file for cold chain.`
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

							<SetupStep
								n={3}
								state={settings.webhooksSubscribed ? "done" : "action"}
								title="Tracking webhook"
								detail={
									settings.webhooksSubscribed
										? "Registered — tracking numbers and Shipped/Delivered updates run themselves."
										: "Delyva hasn't accepted it yet, so booked orders won't move to Shipped and Delivered on their own. Booking still works."
								}
							>
								{!settings.webhooksSubscribed ? (
									<Button
										type="button"
										className="mt-1 h-11 self-start"
										isLoading={busy}
										onClick={() =>
											void run(
												() => resubscribe({ retailerId: actAsRetailerId }),
												"Tracking webhook registered",
											)
										}
									>
										Register again
									</Button>
								) : null}
							</SetupStep>
						</SetupChecklist>

						{/* Delyva shares no balance, so this row is honest about it:
						    "Not shared", or the last balance a refusal showed us
						    (z8r3fdrgxc). Same row as every other surface. */}
						<IntegrationWalletBlock
							retailerId={retailerId}
							country={country}
							provider="delyva"
						/>

						<SectionLabel>Defaults</SectionLabel>
						<div className="flex flex-col gap-1.5">
							<span className="text-xs font-medium text-muted-foreground">
								Default parcel type
							</span>
							<div className="grid grid-cols-3 gap-2">
								{ITEM_TYPES.map((type) => (
									// The house tile (ModeButton) — this was a hand-rolled copy
									// of it, which is how two tiles drift apart.
									<ModeButton
										key={type.value}
										active={settings.defaultItemType === type.value}
										disabled={busy}
										title={type.label}
										subtitle={type.hint}
										onClick={() =>
											void run(
												() =>
													updateSettings({
														retailerId: actAsRetailerId,
														defaultItemType: type.value,
													}),
												`Default parcel type set to ${type.label}`,
											)
										}
									/>
								))}
							</div>
							<p className="text-xs text-muted-foreground">
								Just the default — you can switch it per order when you book.
							</p>
						</div>

						{/* Cold-chain activation is a manual step at Delyva's end and the
					    single most likely reason a frozen seller's first booking
					    fails. */}
						{settings.defaultItemType !== "PARCEL" ? (
							<p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
								<Snowflake className="mt-0.5 size-3.5 shrink-0" />
								<span>
									<strong className="text-foreground">
										Cold chain needs a one-time activation.
									</strong>{" "}
									Delyva activates your pickup address for chilled/frozen by
									hand — email{" "}
									<a
										href="mailto:support@delyva.com"
										className="font-medium text-accent hover:underline"
									>
										support@delyva.com
									</a>{" "}
									with this address if you haven&apos;t. Usually 1–2 business
									days; ordinary parcels book right away.
								</span>
							</p>
						) : null}

						{/* Where the on/off lives — the one cross-page pointer, so a
					    seller who lands here first still finds the switch. */}
						{!countryBlocked ? (
							<p className="text-xs text-muted-foreground">
								{settings.enabled
									? "Booking is on — you'll see Delyva on your delivery orders."
									: settings.bookingHeldForWeights
										? `Booking is off until ${settings.bookingHeldForWeights} product${settings.bookingHeldForWeights === 1 ? " has" : "s have"} a parcel weight — couriers price by weight.`
										: "Booking is currently off."}{" "}
								{settings.bookingHeldForWeights ? (
									<>
										<Link
											to="/app/products/weights"
											className="font-medium text-accent-emphasis hover:underline"
										>
											Set parcel weights
										</Link>
										, then switch it on under{" "}
									</>
								) : (
									<>Manage it under </>
								)}
								<Link
									to="/app/settings/delivery-pricing"
									className="font-medium text-accent-emphasis hover:underline"
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
							title="Disconnect Delyva?"
							description="The Book button disappears from your orders and we'll remove our tracking webhook from your Delyva account. Couriers already booked keep delivering, but those orders will stop updating themselves — you'll mark them shipped and delivered by hand. Your pickup address and parcel type are kept, so reconnecting is just one key."
							confirmLabel="Disconnect"
							destructive
							onConfirm={() =>
								void run(
									() => disconnect({ retailerId: actAsRetailerId }),
									"Delyva disconnected",
								)
							}
						/>
					</>
				) : (
					<>
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
								The tracking number reaches your buyer{" "}
								<strong>by itself</strong>, and the order marks itself Shipped
								then Delivered.
							</Bullet>
							<Bullet>
								<strong>Cold chain</strong> — chilled and frozen couriers, which
								most parcel platforms refuse.
							</Bullet>
							<Bullet>
								Runs on <strong>your own Delyva account</strong> at their normal
								rates. <strong>Kedaipal adds nothing</strong> to your price.
							</Bullet>
						</ul>
						<p className="text-xs leading-relaxed text-muted-foreground">
							{PARCEL_NO_PHOTO_NOTE}
						</p>

						<div className="flex flex-col gap-2 rounded-xl border border-input bg-muted/30 p-3 text-sm">
							<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
								How to connect
							</p>
							<ol className="flex list-decimal flex-col gap-1 pl-5">
								<li>
									Create a free account at{" "}
									<a
										href="https://delyva.com"
										target="_blank"
										rel="noopener noreferrer"
										className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
									>
										delyva.com <ExternalLink className="size-3" />
									</a>{" "}
									and top up some credit — Delyva is prepaid, each booking draws
									from your balance.
								</li>
								<li>
									In the Delyva portal, open{" "}
									<span className="font-medium">
										Settings → API Integrations
									</span>
									.
								</li>
								<li>
									Paste the API key below — that&apos;s the only thing we need.
								</li>
							</ol>
							<a
								href="/guides/delyva-setup.html"
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center gap-1 self-start text-xs font-medium text-accent hover:underline"
							>
								Full step-by-step guide (print-ready){" "}
								<ExternalLink className="size-3" />
							</a>
						</div>

						<KeyInput
							value={apiKey}
							disabled={locked || busy}
							onChange={setApiKey}
						/>

						<div className="flex flex-col gap-2">
							<Button
								type="button"
								className="h-11 self-start"
								isLoading={busy}
								disabled={locked || !typedKey || busy}
								onClick={() => void handleConnect()}
							>
								Connect Delyva
							</Button>
							{locked ? (
								<p className="text-xs text-muted-foreground">
									Courier booking is a Pro feature — upgrade in Settings →
									Billing to connect. (Disconnecting is never locked.)
								</p>
							) : !typedKey ? (
								<p className="text-xs text-muted-foreground">
									One key is all we need — we fetch the rest from Delyva and
									store it encrypted.
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

/** Same anti-autofill posture as the Lalamove/HitPay key inputs: plain text,
 * never type="password", so the browser doesn't offer saved logins into a
 * credentials-for-another-service form. */
function KeyInput({
	value,
	disabled,
	onChange,
}: {
	value: string;
	disabled: boolean;
	onChange: (v: string) => void;
}) {
	return (
		<Input
			type="text"
			name="delyva-api-key"
			aria-label="Delyva API key"
			autoComplete="off"
			data-1p-ignore
			data-lpignore="true"
			data-form-type="other"
			value={value}
			disabled={disabled}
			onChange={(e) => onChange(e.target.value)}
			placeholder="API key (starts with dx…)"
			className="h-11 font-mono text-sm"
		/>
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
			    routinely returns a place with no postcode, and Delyva prices on
			    the postcode. Same component + parser as every other address in
			    the app, so MY territory names normalise identically. */}
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
				aria-label="Unit, floor or building (optional)"
				placeholder="Unit, floor, building (optional)"
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
			{/* Singapore has no state tier — the whole island is one city, and
			    the server arm enforces the SG_STATE_LABEL literal on both
			    fields. A dropdown with one option is not a choice, so there
			    isn't one. */}
			{country === "SG" ? null : (
				<Select
					aria-label="State"
					value={draft.state}
					disabled={disabled}
					onChange={(e) => onChange({ state: e.target.value })}
					variant="field"
					isError={error !== null && !draft.state.trim()}
				>
					<option value="">Select state…</option>
					{MY_STATES.map((state) => (
						<option key={state} value={state}>
							{state}
						</option>
					))}
				</Select>
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
