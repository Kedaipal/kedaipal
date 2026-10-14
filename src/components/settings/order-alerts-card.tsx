/**
 * Settings → Store → Order alerts (86eye9xd4, group 7A).
 *
 * One card answering one question — "how do I find out an order came in?" —
 * with a row per channel. It replaced three sibling cards (browser alerts,
 * WhatsApp alerts, notification email) that each stated their own scope and
 * caveats, so a seller read three cards and assembled the answer themselves.
 *
 * The channels differ in WHERE they live, and the rows say so:
 * - WhatsApp (86eyhw9zy) and email are the STORE's, saved on the account and
 *   owner-only on the server — a teammate sees them, disabled with the reason.
 * - "This device" is per browser (localStorage + the Notification API), so a
 *   teammate at the counter can switch it on for their own screen.
 *
 * WhatsApp replaces the email for the same events while it's on, and the
 * email comes back as the backup if a WhatsApp can't be delivered (86eyd63r8).
 * The "What triggers an alert" disclosure states that, so it isn't hidden
 * behaviour.
 */

import { useState } from "react";
import { toast } from "sonner";
import type { Country } from "../../../convex/lib/country";
import { MOBILE_KIND, MOBILE_MESSAGE } from "../../../convex/lib/slug";
import {
	notificationsSupported,
	playChime,
	setNotifyPrefs,
	useNotifyPrefs,
} from "../../hooks/useOrderNotifications";
import { convexErrorMessage, formatMobile } from "../../lib/format";
import { toNationalPhoneInput } from "../../lib/phone";
import {
	settingsNotifyEmailFormSchema,
	waPhoneCheckoutSchema,
} from "../../lib/schemas";
import { cn } from "../../lib/utils";
import { ProBadge } from "../app/pro-gate";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { MyPhoneInput } from "../ui/my-phone-input";
import { ToggleSwitch } from "../ui/toggle-switch";
import {
	Glance,
	HelperBullets,
	InfoDisclosure,
	SectionHeading,
} from "./settings-primitives";

export type OrderAlertsPatch = {
	notifyWaPhone?: string;
	orderWaAlerts?: boolean;
	notifyEmail?: string;
};

export function OrderAlertsCard({
	whatsapp,
	notifyEmail,
	country,
	canEditAccount,
	onSave,
}: {
	/** Undefined when the deployment has no approved seller template — the
	 * channel doesn't exist there, so its row doesn't either. */
	whatsapp:
		| {
				enabled: boolean;
				/** retailer.notifyWaPhone (normalized "60…") or "". */
				currentPhone: string;
				/** retailer.waPhone — used when no alert number is saved yet. */
				fallbackPhone: string;
				/** The saved number holds a global STOP opt-out. */
				optedOut: boolean;
				/** Client mirror of PLAN_FEATURES.waOrderAlerts (server is the lock). */
				canUse: boolean;
		  }
		| undefined;
	notifyEmail: string;
	country: Country;
	/** Owner / admin. A teammate can't change the account channels. */
	canEditAccount: boolean;
	onSave: (patch: OrderAlertsPatch) => Promise<unknown>;
}) {
	const prefs = useNotifyPrefs();
	// Browser state, not React state — tracked locally so the row updates the
	// moment the permission prompt resolves.
	const [permission, setPermission] = useState<NotificationPermission | null>(
		notificationsSupported() ? Notification.permission : null,
	);
	const deviceOn = prefs.enabled && permission === "granted";
	const waOn = whatsapp?.enabled === true;
	const emailOn = notifyEmail.trim().length > 0;
	const channelsOn = [waOn, deviceOn, emailOn].filter(Boolean).length;
	const channelCount = whatsapp ? 3 : 2;

	return (
		<div className="flex flex-col gap-4">
			<SectionHeading
				title="Order alerts"
				description="How you hear about a new order or a payment claim."
				glance={
					channelsOn === 0 ? (
						<Glance tone="warn">No alerts on</Glance>
					) : (
						<Glance>
							{channelsOn === channelCount
								? `${channelsOn} channels on`
								: `${channelsOn} of ${channelCount} on`}
						</Glance>
					)
				}
			/>

			<div className="flex flex-col">
				{whatsapp ? (
					<WhatsAppRow
						{...whatsapp}
						country={country}
						canEdit={canEditAccount}
						onSave={onSave}
					/>
				) : null}
				<DeviceRow
					permission={permission}
					onPermission={setPermission}
					on={deviceOn}
					sound={prefs.sound}
				/>
				<EmailRow
					current={notifyEmail}
					canEdit={canEditAccount}
					whatsappOn={waOn}
					onSave={onSave}
				/>
			</div>

			{!canEditAccount ? (
				<p className="text-xs text-muted-foreground">
					WhatsApp and email alerts go to the store owner, so only they can
					change them. This device&apos;s alerts are yours to switch.
				</p>
			) : null}

			<InfoDisclosure summary="What triggers an alert">
				<HelperBullets
					items={[
						"A new storefront order lands — counter sales don't, you're already there",
						"A buyer says they've paid, or an online payment lands in your HitPay account",
						"While WhatsApp alerts are on they replace the email — if one can't be delivered, the email goes out as backup",
						"This device needs a Kedaipal tab open somewhere, phone or computer — even in the background",
						"WhatsApp alerts are written in your store's message language (WhatsApp tab)",
					]}
				/>
			</InfoDisclosure>
		</div>
	);
}

/** One channel: name + what it reaches on the left, state + switch on the
 * right; an optional always-visible notice (warnings are never tucked away)
 * and an optional panel the seller opens to change details. */
function ChannelRow({
	title,
	badge,
	sub,
	on,
	toggleLabel,
	toggleDisabled,
	onToggle,
	editLabel,
	editing,
	onEdit,
	notice,
	children,
}: {
	title: string;
	badge?: React.ReactNode;
	sub: React.ReactNode;
	on: boolean;
	toggleLabel: string;
	toggleDisabled: boolean;
	onToggle: (next: boolean) => void;
	editLabel?: string;
	editing?: boolean;
	onEdit?: () => void;
	notice?: React.ReactNode;
	children?: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-2 border-t border-border/60 py-3 first:border-t-0 first:pt-0">
			<div className="flex items-center gap-3">
				<div className="flex min-w-0 flex-1 flex-col">
					<span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
						{title}
						{badge}
					</span>
					<span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
						<span className="min-w-0 truncate">{sub}</span>
						{editLabel && onEdit && !editing ? (
							<button
								type="button"
								onClick={onEdit}
								className="-my-2 py-2 font-semibold text-accent-emphasis hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
							>
								{editLabel}
							</button>
						) : null}
					</span>
				</div>
				<Glance tone={on ? "mint" : "grey"}>{on ? "On" : "Off"}</Glance>
				<ToggleSwitch
					on={on}
					label={toggleLabel}
					disabled={toggleDisabled}
					onChange={onToggle}
				/>
			</div>
			{notice}
			{editing ? (
				<div className="flex flex-col gap-3 pt-1">{children}</div>
			) : null}
		</div>
	);
}

function WhatsAppRow({
	enabled,
	currentPhone,
	fallbackPhone,
	optedOut,
	canUse,
	country,
	canEdit,
	onSave,
}: {
	enabled: boolean;
	currentPhone: string;
	fallbackPhone: string;
	optedOut: boolean;
	canUse: boolean;
	country: Country;
	canEdit: boolean;
	onSave: (patch: OrderAlertsPatch) => Promise<unknown>;
}) {
	const seedPhone = currentPhone || fallbackPhone;
	const [phone, setPhone] = useState(toNationalPhoneInput(seedPhone, country));
	const [phoneError, setPhoneError] = useState<string | null>(null);
	const [editing, setEditing] = useState(false);
	const [saving, setSaving] = useState(false);

	async function save(patch: OrderAlertsPatch, message: string) {
		setSaving(true);
		try {
			await onSave(patch);
			toast.success(message);
			setEditing(false);
			setPhoneError(null);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	/** Mirror of the server's mobile check (store-country arm) for a friendlier
	 * inline error; the server re-validates either way. */
	function normalized(raw: string): string | null {
		const parsed = waPhoneCheckoutSchema[country].safeParse(raw);
		if (!parsed.success) {
			setPhoneError(parsed.error.issues[0]?.message ?? MOBILE_MESSAGE[country]);
			return null;
		}
		setPhoneError(null);
		return parsed.data;
	}

	function onToggle(next: boolean) {
		if (!next) {
			void save({ orderWaAlerts: false }, "WhatsApp order alerts are off");
			return;
		}
		// One tap when there's a number to send to — the alert number, or the
		// store's own WhatsApp (which is who it is for most sellers). Otherwise
		// open the field and ask for it.
		const ready = seedPhone ? normalized(phone) : null;
		if (!ready) {
			setEditing(true);
			return;
		}
		void save(
			{ notifyWaPhone: ready, orderWaAlerts: true },
			`WhatsApp order alerts are on — sent to ${formatMobile(ready)}`,
		);
	}

	const sub = enabled
		? formatMobile(currentPhone)
		: seedPhone
			? `Will go to ${formatMobile(seedPhone)}`
			: "Add the number that should get alerts";

	return (
		<ChannelRow
			title="WhatsApp"
			badge={!canUse ? <ProBadge /> : null}
			sub={sub}
			on={enabled}
			toggleLabel="WhatsApp order alerts"
			// Turning OFF is never plan-locked; turning on is Pro.
			toggleDisabled={!canEdit || saving || (!enabled && !canUse)}
			onToggle={onToggle}
			editLabel={canEdit && (enabled || canUse) ? "Change number" : undefined}
			editing={editing}
			onEdit={() => {
				setPhone(toNationalPhoneInput(seedPhone, country));
				setEditing(true);
			}}
			notice={
				<>
					{!canUse && !enabled ? (
						<p className="text-xs text-muted-foreground">
							A Pro feature — upgrade in Settings → Billing to turn it on.
							Turning off is never locked.
						</p>
					) : null}
					{enabled && optedOut ? (
						<p className="rounded-lg bg-amber-100 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
							This number replied <b>STOP</b> to Kedaipal&apos;s WhatsApp, so
							alerts to it are suppressed. Reply <b>START</b> to Kedaipal&apos;s
							number from that phone to get them again.
						</p>
					) : null}
				</>
			}
		>
			<div className="flex flex-col gap-1">
				<MyPhoneInput
					value={phone}
					country={country}
					disabled={saving}
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
						{MOBILE_KIND[country]} with WhatsApp — usually your own number.
					</p>
				)}
			</div>
			<div className="flex flex-wrap gap-2">
				<Button
					type="button"
					className="h-11"
					isLoading={saving}
					disabled={saving || phone.trim().length === 0}
					onClick={() => {
						const ready = normalized(phone);
						if (!ready) return;
						void save(
							enabled
								? { notifyWaPhone: ready }
								: { notifyWaPhone: ready, orderWaAlerts: true },
							enabled ? "Alert number updated" : "WhatsApp order alerts are on",
						);
					}}
				>
					{enabled ? "Save number" : "Turn on WhatsApp alerts"}
				</Button>
				<Button
					type="button"
					variant="outline"
					className="h-11"
					onClick={() => {
						setEditing(false);
						setPhone(toNationalPhoneInput(seedPhone, country));
						setPhoneError(null);
					}}
				>
					Cancel
				</Button>
			</div>
		</ChannelRow>
	);
}

function DeviceRow({
	permission,
	onPermission,
	on,
	sound,
}: {
	permission: NotificationPermission | null;
	onPermission: (p: NotificationPermission) => void;
	on: boolean;
	sound: boolean;
}) {
	const [editing, setEditing] = useState(false);
	const unsupported = permission === null;
	const blocked = permission === "denied";
	const android =
		typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);

	function sendTest() {
		if (sound) playChime();
		try {
			new Notification("Kedaipal test alert", {
				body: "This is how a new order will look. 🎉",
				icon: "/logo.svg",
			});
		} catch {
			toast.info("Test chime played — notifications appear when supported.");
		}
	}

	async function onToggle(next: boolean) {
		if (!next) {
			setNotifyPrefs({ enabled: false });
			setEditing(false);
			toast.success("Order alerts are off on this device.");
			return;
		}
		if (!notificationsSupported()) return;
		const result = await Notification.requestPermission();
		onPermission(result);
		if (result === "granted") {
			setNotifyPrefs({ enabled: true });
			toast.success("Order alerts are on for this device.");
			sendTest();
		} else if (result === "denied") {
			toast.error(
				"Notifications are blocked for this site — see the steps above.",
			);
		}
	}

	return (
		<ChannelRow
			title="This device"
			sub={
				unsupported
					? "Not supported in this browser"
					: "Chime and a system notification"
			}
			on={on}
			toggleLabel="Order alerts on this device"
			toggleDisabled={unsupported || blocked}
			onToggle={(next) => void onToggle(next)}
			editLabel={on ? "Sound & test" : undefined}
			editing={editing && on}
			onEdit={() => setEditing(true)}
			notice={
				unsupported ? (
					<p className="text-xs text-muted-foreground">
						On iPhone, add Kedaipal to your Home Screen (Share → Add to Home
						Screen) and turn alerts on from there — or use Chrome on a computer.
					</p>
				) : blocked ? (
					<div className="rounded-lg bg-amber-100 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
						<p className="font-semibold">
							Alerts are blocked in this browser. To unblock:
						</p>
						<ol className="mt-1 list-inside list-decimal">
							{android ? (
								<>
									<li>Tap ⋮ → Settings → Site settings</li>
									<li>Notifications → find kedaipal.com → Allow</li>
								</>
							) : (
								<>
									<li>Tap the lock beside the address bar</li>
									<li>Site settings → Notifications → Allow</li>
								</>
							)}
							<li>Reload this page</li>
						</ol>
					</div>
				) : null
			}
		>
			<div className="flex flex-wrap items-center gap-2">
				<Button
					type="button"
					variant="outline"
					className="h-11"
					onClick={() => {
						setNotifyPrefs({ sound: !sound });
						if (!sound) playChime();
					}}
				>
					Sound: {sound ? "on" : "off"}
				</Button>
				<Button
					type="button"
					variant="outline"
					className="h-11"
					onClick={sendTest}
				>
					Send a test
				</Button>
				<Button
					type="button"
					variant="ghost"
					className="h-11"
					onClick={() => setEditing(false)}
				>
					Done
				</Button>
			</div>
		</ChannelRow>
	);
}

function EmailRow({
	current,
	canEdit,
	whatsappOn,
	onSave,
}: {
	current: string;
	canEdit: boolean;
	whatsappOn: boolean;
	onSave: (patch: OrderAlertsPatch) => Promise<unknown>;
}) {
	const [value, setValue] = useState(current);
	const [error, setError] = useState<string | null>(null);
	const [editing, setEditing] = useState(false);
	const [saving, setSaving] = useState(false);
	const on = current.trim().length > 0;

	async function saveEmail(next: string, message: string) {
		setSaving(true);
		try {
			await onSave({ notifyEmail: next });
			toast.success(message);
			setEditing(false);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	function submit() {
		const parsed =
			settingsNotifyEmailFormSchema.shape.notifyEmail.safeParse(value);
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? "Check the email address");
			return;
		}
		setError(null);
		if (parsed.data.length === 0) {
			setError("Enter an email, or switch email alerts off instead");
			return;
		}
		void saveEmail(parsed.data, "Notification email saved.");
	}

	function onToggle(next: boolean) {
		if (next) {
			setValue(current);
			setEditing(true);
			return;
		}
		// Off = no address on file, which is what "off" has always meant for
		// email. Undo puts the same address straight back.
		const previous = current;
		setSaving(true);
		onSave({ notifyEmail: "" })
			.then(() => {
				setEditing(false);
				toast.success("Email alerts are off.", {
					action: {
						label: "Undo",
						onClick: () => {
							void onSave({ notifyEmail: previous }).then(() =>
								toast.success("Email alerts are back on."),
							);
						},
					},
				});
			})
			.catch((err) => toast.error(convexErrorMessage(err)))
			.finally(() => setSaving(false));
	}

	return (
		<ChannelRow
			title="Email"
			sub={
				on
					? whatsappOn
						? `${current} · backup while WhatsApp is on`
						: current
					: "No email set"
			}
			on={on}
			toggleLabel="Email order alerts"
			toggleDisabled={!canEdit || saving}
			onToggle={onToggle}
			editLabel={canEdit && on ? "Change email" : undefined}
			editing={editing}
			onEdit={() => {
				setValue(current);
				setError(null);
				setEditing(true);
			}}
		>
			<div className="flex flex-col gap-1">
				<Input
					type="email"
					variant="field"
					value={value}
					placeholder="orders@yourstore.com"
					isError={error !== null}
					aria-label="Notification email"
					onChange={(e) => {
						setValue(e.target.value);
						if (error) setError(null);
					}}
					className="max-w-sm"
				/>
				{error ? (
					<p className="text-xs font-medium text-destructive">{error}</p>
				) : null}
			</div>
			<div className="flex flex-wrap gap-2">
				<Button
					type="button"
					className={cn("h-11")}
					isLoading={saving}
					disabled={saving}
					onClick={submit}
				>
					Save email
				</Button>
				<Button
					type="button"
					variant="outline"
					className="h-11"
					onClick={() => {
						setEditing(false);
						setError(null);
					}}
				>
					Cancel
				</Button>
			</div>
		</ChannelRow>
	);
}
