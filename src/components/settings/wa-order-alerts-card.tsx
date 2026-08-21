/**
 * Seller WhatsApp order alerts card — Settings → Store (86eyhw9zy).
 *
 * Opt-in WhatsApp pings to the SELLER's own number, sent from Kedaipal's
 * shared WABA as Meta utility templates: one when a new storefront order
 * lands, one when a buyer taps "I've paid". Off by default (each alert is a
 * billable Meta send, absorbed into Pro — no add-on); enabling is Pro-gated,
 * turning it off never is.
 *
 * WhatsApp REPLACES the email for these two events while it's on (86eyd63r8):
 * the email self-suppresses when this alert will actually be attempted, and
 * comes back automatically if the alert is gated or fails. Browser alerts are
 * untouched. The copy below states that so it isn't hidden behaviour.
 *
 * The card only mounts when the deployment has an approved template configured
 * (`retailer.waOrderAlertsAvailable`) — the mount site in app.settings.tsx
 * owns that check, mirroring the confirmPushEnabled posture.
 */

import { MessageCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { convexErrorMessage, formatMyMobile } from "../../lib/format";
import { toMyNationalInput } from "../../lib/phone";
import { myWaPhoneCheckoutSchema } from "../../lib/schemas";
import { ProBadge } from "../app/pro-gate";
import { Button } from "../ui/button";
import { MyPhoneInput } from "../ui/my-phone-input";

type WaOrderAlertsPatch = {
	notifyWaPhone?: string;
	orderWaAlerts?: boolean;
};

export function WaOrderAlertsCard({
	enabled,
	currentPhone,
	fallbackPhone,
	optedOut,
	canUse,
	onSave,
}: {
	/** retailer.orderWaAlerts — the saved opt-in state. */
	enabled: boolean;
	/** retailer.notifyWaPhone (normalized "60…" form) or "". */
	currentPhone: string;
	/** retailer.waPhone — prefills the input so most sellers just tap once. */
	fallbackPhone: string;
	/** The saved number holds a global STOP opt-out — sends would be suppressed. */
	optedOut: boolean;
	/** Client mirror of PLAN_FEATURES.waOrderAlerts (server is the lock). */
	canUse: boolean;
	onSave: (patch: WaOrderAlertsPatch) => Promise<unknown>;
}) {
	// Seed from the saved alert number, else the store's WhatsApp contact — the
	// overwhelmingly common case is "alert me on my own number". Both are stored
	// in the `60…` form, so they go through `toMyNationalInput` or the field
	// would read `+60 | 601159399791`.
	const [phone, setPhone] = useState(
		toMyNationalInput(currentPhone || fallbackPhone),
	);
	const [phoneError, setPhoneError] = useState<string | null>(null);
	const [editingNumber, setEditingNumber] = useState(false);
	const [saving, setSaving] = useState(false);

	async function save(patch: WaOrderAlertsPatch, successMessage: string) {
		setSaving(true);
		try {
			await onSave(patch);
			toast.success(successMessage);
			setEditingNumber(false);
			setPhoneError(null);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	/** Client-side mirror of the server's MY-mobile check for a friendlier
	 * inline error; the server re-validates either way. Returns the normalized
	 * "60…" form, or null after setting the inline error. */
	function normalizedPhone(): string | null {
		const parsed = myWaPhoneCheckoutSchema.safeParse(phone);
		if (!parsed.success) {
			setPhoneError(
				parsed.error.issues[0]?.message ??
					"Enter a Malaysian mobile number (e.g. 012-345 6789)",
			);
			return null;
		}
		setPhoneError(null);
		return parsed.data;
	}

	const phoneInput = (
		<div className="flex flex-col gap-1">
			<MyPhoneInput
				value={phone}
				disabled={!canUse || saving}
				isError={phoneError !== null}
				onChange={(next) => {
					setPhone(next);
					if (phoneError) setPhoneError(null);
				}}
				className="max-w-xs"
			/>
			{phoneError ? (
				<p className="text-xs font-medium text-destructive">{phoneError}</p>
			) : (
				<p className="text-xs text-muted-foreground">
					Malaysian mobile with WhatsApp — usually your own number.
				</p>
			)}
		</div>
	);

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-2">
				<div className="flex items-center gap-2.5">
					<MessageCircle className="size-5 shrink-0 text-accent" />
					<h2 className="font-heading text-lg font-bold">
						WhatsApp order alerts
					</h2>
					{!canUse ? <ProBadge /> : null}
				</div>
				<p className="text-sm text-muted-foreground">
					Get a WhatsApp from Kedaipal the moment a{" "}
					<span className="font-medium text-foreground">new order</span> lands,
					and when a buyer says{" "}
					<span className="font-medium text-foreground">they&apos;ve paid</span>{" "}
					— with a button straight to the order. Counter sales don&apos;t alert
					(you&apos;re already there). While this is on, these two alerts come
					by WhatsApp instead of email; if one can&apos;t be delivered, the
					email goes out as backup so you never miss an order.
				</p>
				{/* The alert language isn't a separate setting — it follows the
				    store's message language, same as the retailer emails. Said here
				    so a BM seller isn't surprised either way (no hidden behaviour). */}
				<p className="text-xs text-muted-foreground">
					Alerts are written in your store&apos;s message language — change it
					under the WhatsApp tab.
				</p>
			</div>

			{enabled ? (
				<>
					<div className="flex flex-col gap-2 rounded-xl border border-input p-3">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<span className="text-sm">
								On — alerts go to{" "}
								<span className="font-medium">
									{formatMyMobile(currentPhone)}
								</span>
							</span>
							<span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
								On
							</span>
						</div>
						{optedOut ? (
							<p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
								This number previously replied <b>STOP</b> to Kedaipal&apos;s
								WhatsApp, so alerts to it are suppressed. Reply{" "}
								<b>START</b> to Kedaipal&apos;s number from that phone to
								receive them again.
							</p>
						) : null}
					</div>

					{editingNumber ? phoneInput : null}

					<div className="flex flex-wrap items-center gap-2">
						{editingNumber ? (
							<>
								<Button
									type="button"
									className="h-11"
									isLoading={saving}
									disabled={saving}
									onClick={() => {
										const normalized = normalizedPhone();
										if (!normalized) return;
										void save(
											{ notifyWaPhone: normalized },
											"Alert number updated",
										);
									}}
								>
									Save number
								</Button>
								<Button
									type="button"
									variant="outline"
									className="h-11"
									onClick={() => {
										setEditingNumber(false);
										setPhone(toMyNationalInput(currentPhone || fallbackPhone));
										setPhoneError(null);
									}}
								>
									Cancel
								</Button>
							</>
						) : (
							<>
								<Button
									type="button"
									variant="outline"
									className="h-11"
									isLoading={saving}
									onClick={() =>
										save(
											{ orderWaAlerts: false },
											"WhatsApp order alerts are off",
										)
									}
								>
									Turn off
								</Button>
								<Button
									type="button"
									variant="outline"
									className="h-11"
									onClick={() => {
										setPhone(toMyNationalInput(currentPhone || fallbackPhone));
										setEditingNumber(true);
									}}
								>
									Change number
								</Button>
							</>
						)}
					</div>
				</>
			) : (
				<>
					{phoneInput}
					<div className="flex flex-col gap-2">
						<Button
							type="button"
							className="h-11 self-start"
							isLoading={saving}
							disabled={!canUse || saving || phone.trim().length === 0}
							onClick={() => {
								const normalized = normalizedPhone();
								if (!normalized) return;
								void save(
									{ notifyWaPhone: normalized, orderWaAlerts: true },
									"WhatsApp order alerts are on",
								);
							}}
						>
							<MessageCircle className="size-4" /> Turn on WhatsApp alerts
						</Button>
						{!canUse ? (
							<p className="text-xs text-muted-foreground">
								WhatsApp order alerts are a Pro feature — upgrade in Settings →
								Billing to turn them on. (Turning off is never locked.)
							</p>
						) : phone.trim().length === 0 ? (
							<p className="text-xs text-muted-foreground">
								Enter the number that should receive the alerts first.
							</p>
						) : null}
					</div>
				</>
			)}
		</div>
	);
}
