/**
 * Lalamove connection card — Settings → Integrations (86eyjpv6z IA rework,
 * 2 Sep). The API half of the Lalamove story: which account, and does it
 * report back. Everything behavioural — live rider prices, the rider-booking
 * toggle, vehicle default, collection direction, prompt-on-packed — lives on
 * Fulfilment → Delivery pricing.
 *
 * Since 86eye9xd4 (5A) the card opens with a numbered setup checklist that
 * stays readable after onboarding: pickup address, API key, webhook — each a
 * mint tick, an amber "Action needed" with its fix in place, or not started.
 * The webhook step registers our URL in one tap (`lalamove.registerWebhook`,
 * Lalamove's free `PATCH /v3/webhook`) with the Partner-Portal paste kept as
 * the fallback; a verified event ticks it too, so a hand-pasted webhook
 * counts. The environment badge (86eypncfy — a sandbox key that LOOKS live
 * cost a real vendor 26 hours) rides the key step.
 */

import { Link } from "@tanstack/react-router";
import { useAction } from "convex/react";
import { ExternalLink, FlaskConical } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { DeliveryBookingSummary } from "../../../convex/retailers";
import { useActAsRetailerId } from "../../hooks/useActAs";
import { clientEnv } from "../../lib/env";
import { convexErrorMessage } from "../../lib/format";
import { AppImage } from "../ui/app-image";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
	Glance,
	HelperBullets,
	InfoDisclosure,
	SectionLabel,
	SetupChecklist,
	SetupStep,
} from "./settings-primitives";

/** The deployment's Lalamove webhook endpoint — Convex HTTP actions live on
 * the `.convex.site` twin of the client's `.convex.cloud` URL. Shown for the
 * manual Partner-Portal paste when one-tap registration isn't an option. */
function lalamoveWebhookUrl(): string {
	const convexUrl = clientEnv.VITE_CONVEX_URL ?? "";
	return `${convexUrl.replace(".convex.cloud", ".convex.site")}/webhook/lalamove`;
}

type BookingPatch = {
	deliveryBooking: {
		enabled: boolean;
		vehicleType: "MOTORCYCLE" | "CAR";
		apiKey?: string;
		apiSecret?: string;
	};
};

export function LalamoveIntegrationCard({
	deliveryBooking,
	businessAddress,
	onSave,
}: {
	deliveryBooking: DeliveryBookingSummary | undefined;
	/** The store's pickup point — where every rider is sent. Edited under
	 * Fulfilment; this card only reports whether it's there. */
	businessAddress: { label: string } | undefined;
	onSave: (patch: BookingPatch) => Promise<unknown>;
}) {
	const actAsRetailerId = useActAsRetailerId();
	const registerWebhook = useAction(api.lalamove.registerWebhook);
	const [apiKey, setApiKey] = useState("");
	const [apiSecret, setApiSecret] = useState("");
	const [editingKeys, setEditingKeys] = useState(false);
	const [saving, setSaving] = useState(false);
	const [registering, setRegistering] = useState(false);
	const [showPaste, setShowPaste] = useState(false);

	const hasStoredKey = !!deliveryBooking?.apiKeyHint;
	const typedBothKeys = apiKey.trim().length > 0 && apiSecret.trim().length > 0;
	const webhookKnown = deliveryBooking?.webhookRegisteredAt !== undefined;
	const doneCount =
		(businessAddress ? 1 : 0) + (hasStoredKey ? 1 : 0) + (webhookKnown ? 1 : 0);

	async function saveKeys() {
		setSaving(true);
		try {
			await onSave({
				deliveryBooking: {
					// Keys can be stored before booking is ever switched on — the
					// enabled flag and vehicle stay whatever they are.
					enabled: deliveryBooking?.enabled ?? false,
					vehicleType: deliveryBooking?.vehicleType ?? "MOTORCYCLE",
					apiKey: apiKey.trim(),
					apiSecret: apiSecret.trim(),
				},
			});
			toast.success("Lalamove keys saved");
			setApiKey("");
			setApiSecret("");
			setEditingKeys(false);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	async function register() {
		setRegistering(true);
		try {
			const result = await registerWebhook({ retailerId: actAsRetailerId });
			if (result.ok) {
				toast.success("Webhook registered — orders now update themselves");
			} else {
				toast.error(result.message);
				setShowPaste(true);
			}
		} catch (err) {
			toast.error(convexErrorMessage(err));
			setShowPaste(true);
		} finally {
			setRegistering(false);
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-2">
				<div className="flex items-center gap-2.5">
					<AppImage
						src="/img/lalamove-logo.svg"
						alt="Lalamove"
						aspect="h-5 w-auto"
						fill={false}
						className="shrink-0"
					/>
					<span className="ml-auto flex shrink-0">
						{!hasStoredKey ? (
							<Glance tone="grey">Not connected</Glance>
						) : doneCount < 3 ? (
							<Glance tone="warn">Setup {doneCount} of 3</Glance>
						) : deliveryBooking?.env === "sandbox" ? (
							// The key step carries "Test keys"; the header says what it
							// means for the store at a glance.
							<Glance tone="warn">Test mode</Glance>
						) : (
							<Glance>Connected</Glance>
						)}
					</span>
				</div>
				<p className="text-sm text-muted-foreground">
					Same-day riders across your city, on your own Lalamove Business
					account. Live rider prices and booking are switched on under{" "}
					<Link
						to="/app/settings/delivery-pricing"
						className="font-medium text-accent-emphasis hover:underline"
					>
						Delivery pricing
					</Link>
					.
				</p>
			</div>

			<SectionLabel>Setup</SectionLabel>
			<SetupChecklist>
				<SetupStep
					n={1}
					state={businessAddress ? "done" : "action"}
					title="Pickup address"
					detail={
						businessAddress ? (
							<>
								{businessAddress.label} —{" "}
								<Link
									to="/app/settings"
									search={{ tab: "fulfilment", spot: "business_address" }}
									className="font-medium text-accent-emphasis hover:underline"
								>
									change it
								</Link>
							</>
						) : (
							<>
								Riders are sent to your business address.{" "}
								<Link
									to="/app/settings"
									search={{ tab: "fulfilment", fix: "business_address" }}
									className="font-semibold text-accent-emphasis hover:underline"
								>
									Set it under Fulfilment
								</Link>
							</>
						)
					}
				/>

				<SetupStep
					n={2}
					state={hasStoredKey ? "done" : "action"}
					title={
						<>
							API key
							{deliveryBooking?.env === "sandbox" ? (
								<Glance tone="warn">Test keys</Glance>
							) : deliveryBooking?.env === "production" ? (
								<Glance>Live</Glance>
							) : null}
						</>
					}
					detail={
						hasStoredKey && !editingKeys ? (
							<>
								Ends{" "}
								<span className="font-mono">
									…{deliveryBooking?.apiKeyHint}
								</span>{" "}
								·{" "}
								<button
									type="button"
									onClick={() => setEditingKeys(true)}
									className="-my-2 py-2 font-medium text-accent-emphasis hover:underline"
								>
									Replace
								</button>
							</>
						) : (
							<>
								From the Lalamove Partner Portal → Developers.{" "}
								<a
									href="/guides/lalamove-setup.html"
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex items-center gap-1 font-medium text-accent-emphasis hover:underline"
								>
									Step-by-step guide <ExternalLink className="size-3" />
								</a>
							</>
						)
					}
				>
					{/* Say what the badge COSTS, not just what it is (86eypncfy). */}
					{hasStoredKey &&
					!editingKeys &&
					deliveryBooking?.env === "sandbox" ? (
						<p className="flex items-start gap-2 rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
							<FlaskConical aria-hidden className="mt-0.5 size-3.5 shrink-0" />
							<span>
								<span className="font-medium">
									No real rider will be dispatched.
								</span>{" "}
								Sandbox keys (
								<code className="rounded bg-amber-200/60 px-1 dark:bg-amber-900/60">
									pk_test_
								</code>
								) book simulated trips and quote your buyers test prices.
								Replace them with your live{" "}
								<code className="rounded bg-amber-200/60 px-1 dark:bg-amber-900/60">
									pk_prod_
								</code>{" "}
								keys before telling buyers.
							</span>
						</p>
					) : null}
					{!hasStoredKey || editingKeys ? (
						<div className="mt-1 flex flex-col gap-2">
							{/* Same anti-autofill posture as every credential input:
							    plain text + a CSS mask, never type="password". */}
							<Input
								type="text"
								name="lalamove-api-key"
								aria-label="Lalamove API key"
								autoComplete="off"
								data-1p-ignore
								data-lpignore="true"
								data-form-type="other"
								value={apiKey}
								onChange={(e) => setApiKey(e.target.value)}
								placeholder="API key (pk_prod_…)"
								className="h-11 font-mono text-sm"
							/>
							<Input
								type="text"
								name="lalamove-api-secret"
								aria-label="Lalamove API secret"
								autoComplete="off"
								data-1p-ignore
								data-lpignore="true"
								data-form-type="other"
								value={apiSecret}
								onChange={(e) => setApiSecret(e.target.value)}
								placeholder="API secret (sk_prod_…)"
								className="h-11 font-mono text-sm"
								style={
									apiSecret.length > 0
										? ({ WebkitTextSecurity: "disc" } as React.CSSProperties)
										: undefined
								}
							/>
							<div className="flex flex-wrap items-center gap-2">
								<Button
									type="button"
									className="h-11"
									isLoading={saving}
									disabled={!typedBothKeys || saving}
									onClick={() => void saveKeys()}
								>
									{hasStoredKey ? "Save new keys" : "Save keys"}
								</Button>
								{hasStoredKey ? (
									<Button
										type="button"
										variant="outline"
										className="h-11"
										onClick={() => {
											setEditingKeys(false);
											setApiKey("");
											setApiSecret("");
										}}
									>
										Keep the stored key
									</Button>
								) : null}
							</div>
						</div>
					) : null}
				</SetupStep>

				<SetupStep
					n={3}
					state={webhookKnown ? "done" : hasStoredKey ? "action" : "todo"}
					title="Webhook"
					detail={
						webhookKnown
							? "Registered — shipped and delivered updates and live tracking run themselves."
							: hasStoredKey
								? "Powers the automatic “shipped” message and live tracking."
								: "After your API key."
					}
				>
					{hasStoredKey && !webhookKnown ? (
						<div className="mt-1 flex flex-col gap-2">
							<Button
								type="button"
								className="h-11 self-start"
								isLoading={registering}
								onClick={() => void register()}
							>
								Register automatically
							</Button>
							{showPaste ? (
								<WebhookPaste />
							) : (
								<button
									type="button"
									onClick={() => setShowPaste(true)}
									className="-my-2 self-start py-2 text-xs text-muted-foreground hover:underline"
								>
									or copy the URL to paste in the Partner Portal yourself
								</button>
							)}
						</div>
					) : null}
				</SetupStep>
			</SetupChecklist>

			<InfoDisclosure summary="Lalamove's limits — good to know">
				<HelperBullets
					items={[
						"Serves the city zone around your pickup (e.g. Klang Valley) — roughly 40–70 km, never across zones",
						"Bike and car cover the same area — the difference is parcel size and price",
						"Cancel free until a rider accepts; after that Lalamove's cancel fee applies",
						"Bookings fail on an empty wallet — top up the Lalamove Business account these keys belong to",
						"You pay Lalamove directly — Kedaipal never books or pays on your behalf",
					]}
				/>
			</InfoDisclosure>
		</div>
	);
}

/** The manual fallback: our URL, a copy button, and where it goes. */
function WebhookPaste() {
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center gap-2">
				<code className="min-w-0 flex-1 truncate rounded-lg border border-input bg-muted/40 px-3 py-2.5 font-mono text-xs">
					{lalamoveWebhookUrl()}
				</code>
				<Button
					type="button"
					variant="outline"
					className="h-11 shrink-0 px-3 text-xs"
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
				Paste it in your Lalamove Partner Portal → Developers → Webhook URL
				(version 3). It ticks itself here once Lalamove sends the first update.
			</p>
		</div>
	);
}
