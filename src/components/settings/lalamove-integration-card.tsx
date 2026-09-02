/**
 * Lalamove connection card — Settings → Integrations (86eyjpv6z IA rework,
 * 2 Sep). The API half of the Lalamove story, extracted from the Fulfilment
 * tab's delivery-charge section where it lived since 86eyb5hrf: keys, the
 * environment badge (86eypncfy — a sandbox key that LOOKS live cost a real
 * vendor 26 hours), and the webhook the seller registers in their own Partner
 * Portal.
 *
 * What stays in Fulfilment: everything behavioural — the live-quote pricing
 * mode, the rider-booking toggle, vehicle default, collection direction,
 * prompt-on-packed. This card is only "which Lalamove account, and does it
 * report back" — the HitPay card's presentational summary-in/patch-out shape,
 * so the parent owns the mutation and act-as.
 */

import { ExternalLink, FlaskConical } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { DeliveryBookingSummary } from "../../../convex/retailers";
import { clientEnv } from "../../lib/env";
import { convexErrorMessage } from "../../lib/format";
import { AppImage } from "../ui/app-image";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

/** The deployment's Lalamove webhook endpoint — Convex HTTP actions live on
 * the `.convex.site` twin of the client's `.convex.cloud` URL. Surfaced here
 * so BYO sellers can paste it into their own Partner Portal. */
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
	onSave,
}: {
	deliveryBooking: DeliveryBookingSummary | undefined;
	onSave: (patch: BookingPatch) => Promise<unknown>;
}) {
	const [apiKey, setApiKey] = useState("");
	const [apiSecret, setApiSecret] = useState("");
	const [editingKeys, setEditingKeys] = useState(false);
	const [saving, setSaving] = useState(false);

	const hasStoredKey = !!deliveryBooking?.apiKeyHint;
	const typedBothKeys =
		apiKey.trim().length > 0 && apiSecret.trim().length > 0;

	async function saveKeys() {
		setSaving(true);
		try {
			await onSave({
				deliveryBooking: {
					// Keys can be stored before booking is ever switched on — the
					// enabled flag and vehicle stay whatever they are (the mutation's
					// undefined-keeps semantics don't cover these two required
					// fields, so restate the stored values).
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
					<h2 className="font-heading text-lg font-bold">Lalamove</h2>
				</div>
				<p className="text-sm text-muted-foreground">
					Same-day riders across your city, on your own Lalamove Business
					account. Powers live rider prices at checkout and one-tap rider
					booking — both switched on under{" "}
					<span className="font-medium">Settings → Fulfilment</span>.
				</p>
			</div>

			{hasStoredKey && !editingKeys ? (
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between rounded-lg border border-input px-3 py-2 text-sm">
						<span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
							Key ending{" "}
							<span className="font-mono">…{deliveryBooking?.apiKeyHint}</span>{" "}
							stored
							{deliveryBooking?.env === "sandbox" ? (
								<span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
									Test keys
								</span>
							) : deliveryBooking?.env === "production" ? (
								<span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-200">
									Live
								</span>
							) : null}
						</span>
						<button
							type="button"
							onClick={() => setEditingKeys(true)}
							className="text-xs font-medium text-accent hover:underline"
						>
							Replace
						</button>
					</div>
					{/* Say what the badge COSTS, not just what it is (86eypncfy). */}
					{deliveryBooking?.env === "sandbox" ? (
						<p className="flex items-start gap-2 rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
							<FlaskConical className="mt-0.5 size-3.5 shrink-0" />
							<span>
								<span className="font-medium">
									No real rider will be dispatched.
								</span>{" "}
								Sandbox keys (
								<code className="rounded bg-amber-200/60 px-1 dark:bg-amber-900/60">
									pk_test_
								</code>
								) book simulated trips and quote your buyers test prices, and
								the sandbox wallet can&apos;t be topped up with real money.
								Replace them with your live{" "}
								<code className="rounded bg-amber-200/60 px-1 dark:bg-amber-900/60">
									pk_prod_
								</code>{" "}
								keys before telling buyers.
							</span>
						</p>
					) : null}
				</div>
			) : (
				<div className="flex flex-col gap-2">
					{/* Same anti-autofill posture as every credential input: plain
					    text + a CSS mask, never type="password". */}
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
			)}

			<p className="text-xs text-muted-foreground">
				From the Lalamove Partner Portal (partnerportal.lalamove.com) →
				Developers tab. You pay Lalamove directly from your own prepaid wallet —
				Kedaipal never books or pays on your behalf.{" "}
				<a
					href="/guides/lalamove-setup.html"
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
				>
					Full step-by-step guide <ExternalLink className="size-3" />
				</a>
			</p>

			{/* Webhook — each seller registers OUR endpoint in THEIR Partner
			    Portal; without it bookings still work but the shipped/delivered
			    updates stop being automatic. */}
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
						Paste this in your Lalamove Partner Portal → Developers → Webhook
						URL (choose version 3). It powers the automatic Shipped and
						Delivered updates, and the live tracking on the buyer&apos;s order
						page.
					</p>
				</div>
			) : null}
		</div>
	);
}
