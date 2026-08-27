/**
 * Delyva courier booking card — Settings → Fulfilment (86eyjpv6z).
 *
 * BYO model, the Lalamove/HitPay credential card's sibling: the seller opens
 * their OWN Delyva account and pastes ONE API key. Delyva authenticates every
 * call with that single key, and the webhook HMAC secret + the integer
 * customerId are fetchable with it — so `delyva.connect` validates the key,
 * fetches the rest, encrypts it, and registers our webhook URL, all server
 * side. That is why this card asks for one field where the HitPay card asks
 * for two: there is nothing else for the seller to find.
 *
 * Unlike that card this one owns its own reads and actions rather than taking
 * a summary + `onSave` — Delyva has its own Convex namespace (four actions and
 * a mutation), so threading them through the tab would be five more props for
 * no gain. Act-as is honoured the way `useUpdateSettings` does it: the
 * seller's `retailerId` is injected so a white-glove edit lands on THEIR store.
 *
 * Connecting/enabling is Pro; disconnecting and pausing never are (downgrade
 * never traps). Malaysia-only for v1 — an SG store gets the reason, not a
 * button that fails server-side.
 */

import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useAction, useMutation } from "convex/react";
import { CircleCheck, ExternalLink, Snowflake, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { MY_STATES } from "../../../convex/lib/address";
import type { Country } from "../../../convex/lib/country";
import type { DelyvaItemType } from "../../../convex/lib/delyva";
import { useActAsRetailerId } from "../../hooks/useActAs";
import { convexErrorMessage } from "../../lib/format";
import { ProBadge } from "../app/pro-gate";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Input } from "../ui/input";

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
	canUse,
	country,
}: {
	/** Client mirror of PLAN_FEATURES.delivery (server is the lock). */
	canUse: boolean;
	/** Store country — Delyva booking is Malaysia-only for v1. */
	country: Country;
}) {
	const actAsRetailerId = useActAsRetailerId();
	const settings = useQuery(
		convexQuery(api.delyva.getSettings, { retailerId: actAsRetailerId }),
	).data;

	const connect = useAction(api.delyva.connect);
	const disconnect = useAction(api.delyva.disconnect);
	const resubscribe = useAction(api.delyva.resubscribeWebhooks);
	const updateSettings = useMutation(api.delyva.updateSettings);

	const [apiKey, setApiKey] = useState("");
	const [editingKey, setEditingKey] = useState(false);
	const [busy, setBusy] = useState(false);
	const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
	const [address, setAddress] = useState<PickupAddressDraft | null>(null);
	const [addressError, setAddressError] = useState<string | null>(null);

	const connected = settings?.connected === true;
	// A downgraded-but-connected seller keeps every control except re-enabling
	// — same posture as the HitPay card.
	const locked = !canUse && !connected;
	const countryBlocked = settings ? !settings.countryAllowed : country === "SG";
	const typedKey = apiKey.trim().length > 0;

	// The stored address is the draft's source of truth until the seller starts
	// editing; `null` draft = "showing what the server has".
	const storedAddress = settings?.pickupAddress;
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
				// The action returns its reason rather than throwing — a wrong key is
				// an ordinary outcome, not an exception.
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
		if (
			!draft.address1.trim() ||
			!draft.city.trim() ||
			!draft.state.trim() ||
			!/^\d{5}$/.test(draft.postcode.trim())
		) {
			// Mirrors the server rule in convex/delyva.ts so the seller is told
			// here, not by a thrown error after a round trip.
			setAddressError(
				"Fill in the street address, city, state and a 5-digit postcode.",
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
						city: draft.city.trim(),
						state: draft.state.trim(),
						postcode: draft.postcode.trim(),
					},
				}),
			"Pickup address saved",
		).then((ok) => {
			if (ok) setAddress(null);
		});
	}

	// A store in a country Delyva booking doesn't serve, with nothing connected,
	// has no action to take — so the card stays out of its settings entirely
	// (the SG-lite posture: MY-only delivery modes are hidden, not disabled). A
	// store that switched country WHILE connected still sees it, with the reason
	// and a way to disconnect.
	if (countryBlocked && !connected) return null;

	return (
		// Owns its own card container (the DespatchLabelCard posture) so the
		// hidden case above leaves no empty bordered box behind.
		<section className="flex flex-col gap-4 rounded-2xl border bg-background p-5 scroll-mt-24 lg:p-6">
			<div className="flex flex-col gap-2">
				<div className="flex items-center gap-2.5">
					<h2 className="font-heading text-lg font-bold">Delyva courier</h2>
					{!canUse ? <ProBadge /> : null}
				</div>
				<p className="text-sm text-muted-foreground">
					Book nationwide and cold-chain couriers straight from an order — J&amp;T,
					DHL, Ninja and more. The tracking number lands on your buyer&apos;s
					order page by itself.
				</p>
			</div>

			{/* Additive, not exclusive: a store that switched country while connected
			    still needs the controls below it — telling a seller the feature is
			    unavailable and giving them no way to disconnect is a dead end. */}
			{countryBlocked ? (
				<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
					Delyva courier booking is Malaysia-only for now — Singapore stores
					arrange their own courier and record the tracking number on the order.
					Your account stays connected until you disconnect it below.
				</p>
			) : null}

			{settings === undefined ? (
				<p className="text-sm text-muted-foreground">Loading…</p>
			) : connected ? (
				<>
					<div className="flex flex-col gap-2 rounded-xl border border-input p-3">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<span className="flex items-center gap-2 text-sm">
								<CircleCheck className="size-4 shrink-0 text-accent" />
								<span>
									{settings.accountName ? (
										<>
											Connected — <strong>{settings.accountName}</strong>
										</>
									) : (
										"Connected"
									)}{" "}
									<span className="text-muted-foreground">
										(key ending{" "}
										<span className="font-mono">…{settings.apiKeyHint}</span>)
									</span>
								</span>
							</span>
							<span
								className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
									settings.enabled
										? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
										: "bg-muted text-muted-foreground"
								}`}
							>
								{settings.enabled ? "On" : "Paused"}
							</span>
						</div>
						<p className="text-xs text-muted-foreground">
							{settings.enabled
								? "Book a courier from any confirmed delivery order — you pick from live prices, and the order updates itself once the parcel is collected."
								: "Paused — the Book button is hidden on your orders. Your key is kept, so resuming is one tap."}
						</p>
						{/* Webhooks are what make an order move itself. A failed
						    subscription is invisible until an order silently stops
						    updating, so it is said out loud with its own fix. */}
						{!settings.webhooksSubscribed ? (
							<div className="flex flex-col items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
								<p className="flex items-start gap-2">
									<TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
									<span>
										Delyva hasn&apos;t accepted our tracking webhook, so booked
										orders won&apos;t move to Shipped and Delivered on their own.
										Booking still works.
									</span>
								</p>
								<button
									type="button"
									disabled={busy}
									onClick={() =>
										void run(
											() => resubscribe({ retailerId: actAsRetailerId }),
											"Tracking webhook registered",
										)
									}
									className="min-h-9 font-semibold underline-offset-2 hover:underline disabled:opacity-60"
								>
									Retry now
								</button>
							</div>
						) : null}
					</div>

					{/* 1 · Pickup address — its own field, not the business address:
					    a parcel courier prices on postcode/state, and this is the
					    address Delyva activates for cold chain. */}
					<PickupAddressFields
						draft={addressDraft}
						dirty={addressDirty}
						disabled={busy}
						error={addressError}
						missing={!storedAddress}
						onChange={(patch) => {
							setAddress({ ...addressDraft, ...patch });
							setAddressError(null);
						}}
						onSave={saveAddress}
						onCancel={() => {
							setAddress(null);
							setAddressError(null);
						}}
					/>

					{/* 2 · Default parcel type */}
					<div className="flex flex-col gap-1.5">
						<span className="text-xs font-medium text-muted-foreground">
							Default parcel type
						</span>
						<div className="grid grid-cols-3 gap-2">
							{ITEM_TYPES.map((type) => (
								<button
									key={type.value}
									type="button"
									disabled={busy}
									aria-pressed={settings.defaultItemType === type.value}
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
									className={`relative flex min-h-[60px] flex-col items-start gap-0.5 rounded-xl border-2 py-2.5 pl-3 pr-9 text-left transition-colors ${
										settings.defaultItemType === type.value
											? "border-accent bg-accent/5"
											: "border-border bg-card hover:border-accent/40"
									}`}
								>
									<span className="text-sm font-semibold">{type.label}</span>
									<span className="text-xs text-muted-foreground">
										{type.hint}
									</span>
									<span
										aria-hidden="true"
										className={`absolute bottom-2.5 right-2.5 flex size-4 items-center justify-center rounded-full border-2 transition-colors ${
											settings.defaultItemType === type.value
												? "border-accent"
												: "border-border"
										}`}
									>
										{settings.defaultItemType === type.value ? (
											<span className="size-2 rounded-full bg-accent" />
										) : null}
									</span>
								</button>
							))}
						</div>
						<p className="text-xs text-muted-foreground">
							Just the default — you can switch it per order when you book.
						</p>
					</div>

					{/* Cold-chain activation is a manual step at Delyva's end and the
					    single most likely reason a frozen seller's first booking fails.
					    Said here, before they ever reach for the Book button. */}
					{settings.defaultItemType !== "PARCEL" ? (
						<p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
							<Snowflake className="mt-0.5 size-3.5 shrink-0" />
							<span>
								<strong className="text-foreground">
									Cold chain needs a one-time activation.
								</strong>{" "}
								Delyva activates your pickup address for chilled/frozen by hand
								— email{" "}
								<a
									href="mailto:support@delyva.com"
									className="font-medium text-accent hover:underline"
								>
									support@delyva.com
								</a>{" "}
								with this address if you haven&apos;t. Usually 1–2 business days;
								ordinary parcels book right away.
							</span>
						</p>
					) : null}

					{editingKey ? (
						<div className="flex flex-col gap-2">
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
					) : (
						<div className="flex flex-wrap items-center gap-2">
							<Button
								type="button"
								variant={settings.enabled ? "outline" : "default"}
								className="h-11"
								isLoading={busy}
								disabled={
									busy || (!settings.enabled && (!canUse || countryBlocked))
								}
								onClick={() =>
									void run(
										() =>
											updateSettings({
												retailerId: actAsRetailerId,
												enabled: !settings.enabled,
											}),
										settings.enabled
											? "Delyva booking paused"
											: "Delyva booking on",
									)
								}
							>
								{settings.enabled ? "Pause" : "Resume"}
							</Button>
							<Button
								type="button"
								variant="outline"
								className="h-11"
								onClick={() => setEditingKey(true)}
							>
								Replace key
							</Button>
							<button
								type="button"
								onClick={() => setConfirmingDisconnect(true)}
								className="ml-auto min-h-11 text-sm font-medium text-destructive hover:underline"
							>
								Disconnect
							</button>
						</div>
					)}
					{!editingKey && !settings.enabled && !canUse ? (
						<p className="text-xs text-muted-foreground">
							Resuming courier booking needs Pro — upgrade in Settings → Billing.
							Your key is kept meanwhile.
						</p>
					) : null}

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
							You <strong>pick the courier</strong> and see every price before you
							spend.
						</Bullet>
						<Bullet>
							The tracking number reaches your buyer <strong>by itself</strong>,
							and the order marks itself Shipped then Delivered.
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
								<span className="font-medium">Settings → API Integrations</span>.
							</li>
							<li>Paste the API key below — that&apos;s the only thing we need.</li>
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

					<KeyInput value={apiKey} disabled={locked || busy} onChange={setApiKey} />

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
								Courier booking is a Pro feature — upgrade in Settings → Billing
								to connect. (Disconnecting is never locked.)
							</p>
						) : !typedKey ? (
							<p className="text-xs text-muted-foreground">
								One key is all we need — we fetch the rest from Delyva and store
								it encrypted.
							</p>
						) : null}
					</div>
				</>
			)}
		</section>
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
	draft,
	dirty,
	disabled,
	error,
	missing,
	onChange,
	onSave,
	onCancel,
}: {
	draft: PickupAddressDraft;
	dirty: boolean;
	disabled: boolean;
	error: string | null;
	missing: boolean;
	onChange: (patch: Partial<PickupAddressDraft>) => void;
	onSave: () => void;
	onCancel: () => void;
}) {
	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-col gap-0.5">
				<span className="text-xs font-medium text-muted-foreground">
					Pickup address
				</span>
				<p className="text-xs text-muted-foreground">
					Where couriers collect from. The postcode decides the price, so make it
					exact — and match what Delyva has on file for cold chain.
				</p>
			</div>
			{missing && !dirty ? (
				<p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
					<TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
					<span>
						Add this before your first booking — couriers need somewhere to
						collect from.
					</span>
				</p>
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
				aria-label="Unit, floor or building (optional)"
				placeholder="Unit, floor, building (optional)"
				value={draft.address2}
				disabled={disabled}
				onChange={(e) => onChange({ address2: e.target.value })}
			/>
			<div className="grid grid-cols-2 gap-2">
				<Input
					variant="field"
					aria-label="City"
					placeholder="City"
					value={draft.city}
					disabled={disabled}
					isError={error !== null && !draft.city.trim()}
					onChange={(e) => onChange({ city: e.target.value })}
				/>
				<Input
					variant="field"
					aria-label="Postcode"
					placeholder="Postcode"
					inputMode="numeric"
					maxLength={5}
					value={draft.postcode}
					disabled={disabled}
					isError={error !== null && !/^\d{5}$/.test(draft.postcode.trim())}
					onChange={(e) =>
						onChange({ postcode: e.target.value.replace(/\D/g, "").slice(0, 5) })
					}
				/>
			</div>
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
			{error ? (
				<p className="text-xs font-medium text-destructive">{error}</p>
			) : null}
			{dirty ? (
				<div className="flex flex-wrap items-center gap-2">
					<Button
						type="button"
						className="h-11"
						isLoading={disabled}
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
