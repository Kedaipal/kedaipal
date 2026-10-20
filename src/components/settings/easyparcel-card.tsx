/**
 * EasyParcel connection card — Settings → Integrations (z8r3fdcje2). The
 * ACCOUNT half of the EasyParcel story: the one-key connect (an Individual
 * API key), the prepaid wallet balance, and the pickup address couriers
 * collect from. Whether the store actually books through EasyParcel is
 * decided in Fulfilment → Courier booking — connection and use are two
 * different questions, the Delyva/Lalamove split.
 *
 * EasyParcel differences the card says out loud:
 *  - PREPAID: every booking draws from the wallet, so the balance lives here
 *    with a refresh — an empty wallet is the most likely first failure.
 *  - Their sandbox is a separate HOST, resolved at connect (which host
 *    accepted the key); a demo key gets the test-mode banner at the account
 *    step, the 86eypncfy posture.
 *  - AMBIENT ONLY: EasyParcel couriers don't carry chilled/frozen — stated
 *    on the card, not discovered at a failed pickup.
 *
 * Owns its own reads/actions (EasyParcel has its own Convex namespace);
 * act-as is honoured the way the Delyva card does it. Connecting is Pro;
 * disconnecting never is.
 */

import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useAction, useMutation } from "convex/react";
import { ExternalLink, FlaskConical, RefreshCw, Snowflake, Wallet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { MY_STATES, postcodeRule } from "../../../convex/lib/address";
import type { Country } from "../../../convex/lib/country";
import { useActAsRetailerId } from "../../hooks/useActAs";
import type { FixHighlight } from "../../lib/country-setup-copy";
import { convexErrorMessage, formatPrice } from "../../lib/format";
import { parseGoogleAddress } from "../../lib/google-address";
import { ProBadge } from "../app/pro-gate";
import { GoogleAddressAutocomplete } from "../forms/google-address-autocomplete";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Input } from "../ui/input";
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
	/** Store country — drives the address form's shape and which EasyParcel
	 * platform (easyparcel.sg / .my) the copy points at. */
	country: Country;
}) {
	const actAsRetailerId = useActAsRetailerId();
	const settings = useQuery(
		convexQuery(api.easyparcel.getSettings, { retailerId: actAsRetailerId }),
	).data;

	const connect = useAction(api.easyparcel.connect);
	const refreshBalance = useAction(api.easyparcel.refreshBalance);
	const disconnect = useMutation(api.easyparcel.disconnect);
	const updateSettings = useMutation(api.easyparcel.updateSettings);

	const [apiKey, setApiKey] = useState("");
	const [editingKey, setEditingKey] = useState(false);
	const [busy, setBusy] = useState(false);
	const [refreshing, setRefreshing] = useState(false);
	const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
	const [address, setAddress] = useState<PickupAddressDraft | null>(null);
	const [addressError, setAddressError] = useState<string | null>(null);
	// A set address reads as one quiet row (86eye9xd4 5A); "change it" opens
	// the editor, and a save or cancel folds it again.
	const [editingPickup, setEditingPickup] = useState(false);

	const connected = settings?.connected === true;
	// A downgraded-but-connected seller keeps every control except re-enabling
	// (which lives in Fulfilment) — connection management is never gated.
	const locked = !canUse && !connected;
	const countryBlocked = settings ? !settings.available : false;
	const typedKey = apiKey.trim().length > 0;
	const portalHost =
		country === "SG" ? "easyparcel.com/sg" : "easyparcel.com/my";

	const storedAddress = settings?.pickupAddress;
	// The setup checklist's count: account, pickup address. (No webhook step —
	// this API has none; status is polled.)
	const setupDone = (connected ? 1 : 0) + (storedAddress ? 1 : 0);
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
			toast.success("EasyParcel connected");
			if (result.isDemo) {
				toast.warning(
					"This key belongs to EasyParcel's DEMO environment — bookings are simulated and no courier is dispatched.",
				);
			}
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setBusy(false);
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
			// a thrown error after a round trip.
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
						unit: draft.unit.trim() || undefined,
						address1: draft.address1.trim(),
						address2: draft.address2.trim() || undefined,
						city: draft.city.trim() || undefined,
						state: draft.state.trim() || undefined,
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

	// Nothing to offer in a country EasyParcel booking doesn't serve, and
	// nothing connected to unwind — stay out of the tab entirely (shell
	// included).
	if (countryBlocked && !connected) return null;

	return (
		<AccountCard id={shellId} highlight={highlight}>
			<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-2">
				<div className="flex items-center gap-2.5">
					{/* No brand mark shipped yet (marks are never redrawn or
					    re-tinted) — the name carries the identity until EasyParcel's
					    approved asset lands. */}
					<h2 className="font-heading text-lg font-bold">EasyParcel</h2>
					{!canUse ? <ProBadge /> : null}
					<span className="ml-auto flex shrink-0">
						{!connected ? (
							<Glance tone="grey">Not connected</Glance>
						) : setupDone < 2 ? (
							<Glance tone="warn">Setup {setupDone} of 2</Glance>
						) : settings?.isDemo ? (
							<Glance tone="warn">Test mode</Glance>
						) : (
							<Glance>Connected</Glance>
						)}
					</span>
				</div>
				<p className="text-sm text-muted-foreground">
					Singapore parcel couriers — J&amp;T, SingPost, Qxpress, Ninja Van,
					Teleport and more — on your own EasyParcel account. Booking is
					switched on under{" "}
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
					EasyParcel booking isn&apos;t available in your store&apos;s country
					— Malaysian stores book couriers through Delyva instead. Your account
					stays connected until you disconnect it below.
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
									) : (
										<Glance>Live</Glance>
									)}
								</>
							}
							detail={
								editingKey ? (
									"Paste the key from your live EasyParcel account."
								) : (
									<>
										key{" "}
										<span className="font-mono">…{settings.apiKeyHint}</span> ·{" "}
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
										<strong>Test mode — no courier will come.</strong> This key
										authenticated on EasyParcel&apos;s demo environment, so
										bookings are simulated and its credit is play money. Connect
										the key from your live account at{" "}
										<a
											href={`https://${portalHost}`}
											target="_blank"
											rel="noopener noreferrer"
											className="font-medium underline underline-offset-2"
										>
											{portalHost}
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
						    prices on the postcode, and this is where pickups happen. */}
						<SetupStep
							n={2}
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
											`${storedAddress.postcode}${storedAddress.city ? ` ${storedAddress.city}` : ""}`,
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
					</SetupChecklist>

					{/* The wallet is the thing that fails first on a prepaid platform —
					    it gets its own section, not a footnote. */}
					<SectionLabel>Wallet</SectionLabel>
					<div className="flex items-center gap-2 rounded-xl border border-input bg-muted/30 px-3 py-2.5">
						<Wallet className="size-4 shrink-0 text-muted-foreground" />
						<span className="text-sm">
							{settings.balanceMinor !== undefined ? (
								<strong className="font-semibold">
									{formatPrice(
										settings.balanceMinor,
										settings.balanceCurrency ?? "SGD",
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
							className="ml-auto h-9"
							isLoading={refreshing}
							onClick={() => void handleRefreshBalance()}
						>
							<RefreshCw className="size-3.5" />
							Refresh
						</Button>
					</div>

					{/* The constraint, surfaced where the account lives — never
					    discovered at a failed pickup. */}
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

					{/* Where the on/off lives — the one cross-page pointer, so a
					    seller who lands here first still finds the switch. */}
					{!countryBlocked ? (
						<p className="text-xs text-muted-foreground">
							{settings.enabled
								? "Booking is on — you'll see EasyParcel on your delivery orders."
								: "Booking is currently off."}{" "}
							Manage it under{" "}
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
						title="Disconnect EasyParcel?"
						description="The Book button disappears from your orders. Parcels already booked keep delivering and their tracking keeps updating from EasyParcel until they finish. Your pickup address is kept, so reconnecting is just one key."
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
							The <strong>courier&apos;s own label PDF</strong> comes back with
							the booking, with the tracking number already on your buyer&apos;s
							order.
						</Bullet>
						<Bullet>
							Runs on <strong>your own EasyParcel account</strong> at their
							normal rates. <strong>Kedaipal adds nothing</strong> to your
							price.
						</Bullet>
					</ul>

					<div className="flex flex-col gap-2 rounded-xl border border-input bg-muted/30 p-3 text-sm">
						<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
							How to connect
						</p>
						<ol className="flex list-decimal flex-col gap-1 pl-5">
							<li>
								Create a free account at{" "}
								<a
									href={`https://${portalHost}`}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
								>
									{portalHost} <ExternalLink className="size-3" />
								</a>{" "}
								and top up some credit — EasyParcel is prepaid, each booking
								draws from your balance.
							</li>
							<li>
								In the EasyParcel dashboard, open{" "}
								<span className="font-medium">
									Integrations → Add New Store → API Key
								</span>{" "}
								and choose <span className="font-medium">Individual API</span>.
							</li>
							<li>
								Paste the API key below — that&apos;s the only thing we need.
							</li>
						</ol>
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
							Connect EasyParcel
						</Button>
						{locked ? (
							<p className="text-xs text-muted-foreground">
								Courier booking is a Pro feature — upgrade in Settings → Billing
								to connect. (Disconnecting is never locked.)
							</p>
						) : !typedKey ? (
							<p className="text-xs text-muted-foreground">
								One key is all we need — we check it with EasyParcel and store
								it encrypted.
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

/** Same anti-autofill posture as the Delyva/Lalamove/HitPay key inputs. */
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
			name="easyparcel-api-key"
			aria-label="EasyParcel API key"
			autoComplete="off"
			data-1p-ignore
			data-lpignore="true"
			data-form-type="other"
			value={value}
			disabled={disabled}
			onChange={(e) => onChange(e.target.value)}
			placeholder="Individual API key"
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
