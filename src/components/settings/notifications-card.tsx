import { Bell, BellOff, BellRing } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	notificationsSupported,
	playChime,
	setNotifyPrefs,
	useNotifyPrefs,
} from "../../hooks/useOrderNotifications";
import { Button } from "../ui/button";

/**
 * Settings → Store → "Order alerts on this device" (docs/order-notifications.md).
 *
 * Per-DEVICE browser notifications: enable → browser permission prompt →
 * chime + system notification whenever a new order lands or a rider booking
 * fails, as long as a dashboard tab is open somewhere. Every permission state
 * has a next step (never a dead toggle): unsupported browsers say so, denied
 * permission gets unblock instructions, granted gets a test button.
 */
export function NotificationsCard() {
	const prefs = useNotifyPrefs();
	// Permission is browser state, not React state — track it locally so the
	// UI updates the moment the prompt resolves.
	const [permission, setPermission] = useState<NotificationPermission | null>(
		notificationsSupported() ? Notification.permission : null,
	);

	async function enable() {
		if (!notificationsSupported()) return;
		const result = await Notification.requestPermission();
		setPermission(result);
		if (result === "granted") {
			setNotifyPrefs({ enabled: true });
			toast.success("Order alerts are on for this device.");
			sendTest();
		} else if (result === "denied") {
			toast.error(
				"Notifications are blocked for this site — see the unblock steps below.",
			);
		}
	}

	function sendTest() {
		if (prefs.sound) playChime();
		try {
			new Notification("Kedaipal test alert", {
				body: "This is how a new order will look. 🎉",
				icon: "/logo.svg",
			});
		} catch {
			toast.info("Test chime played — notifications appear when supported.");
		}
	}

	if (!notificationsSupported() || permission === null) {
		return (
			<div className="flex items-start gap-3">
				<BellOff className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
				<div>
					<p className="text-sm font-semibold">Order alerts on this device</p>
					<p className="mt-1 text-xs text-muted-foreground leading-relaxed">
						This browser doesn&apos;t support notifications. On iPhone, add
						Kedaipal to your Home Screen (Share → Add to Home Screen) and
						enable alerts from there, or use Chrome on a computer.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-start justify-between gap-4">
				<div className="flex items-start gap-3">
					{prefs.enabled && permission === "granted" ? (
						<BellRing className="mt-0.5 size-5 shrink-0 text-accent" />
					) : (
						<Bell className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
					)}
					<div>
						<p className="text-sm font-semibold">
							Order alerts on this device
						</p>
						<p className="mt-1 text-xs text-muted-foreground leading-relaxed">
							A sound + notification the moment a new order lands or a rider
							booking fails — works while a Kedaipal tab is open, even in the
							background. Per device: turn it on at the counter, off on your
							personal phone.
						</p>
					</div>
				</div>
			</div>

			{permission === "denied" ? (
				<p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
					Notifications are <b>blocked</b> for kedaipal.com in this browser.
					To unblock: tap the 🔒 (or ⓘ) icon beside the address bar → Site
					settings → Notifications → <b>Allow</b>, then reload this page. On
					Android Chrome: ⋮ → Settings → Site settings → Notifications.
				</p>
			) : permission === "default" || !prefs.enabled ? (
				<Button type="button" onClick={enable} className="h-11 w-fit px-5">
					<Bell className="size-4" /> Turn on order alerts
				</Button>
			) : (
				<div className="flex flex-wrap items-center gap-2">
					<Button
						type="button"
						variant="outline"
						className="h-10 px-4 text-xs"
						onClick={() => {
							setNotifyPrefs({ enabled: false });
							toast.success("Order alerts are off on this device.");
						}}
					>
						Turn off
					</Button>
					<Button
						type="button"
						variant="outline"
						className="h-10 px-4 text-xs"
						onClick={() => {
							setNotifyPrefs({ sound: !prefs.sound });
							if (!prefs.sound) playChime();
						}}
					>
						Sound: {prefs.sound ? "on" : "off"}
					</Button>
					<Button
						type="button"
						variant="outline"
						className="h-10 px-4 text-xs"
						onClick={sendTest}
					>
						Send a test
					</Button>
				</div>
			)}
			<p className="text-[11px] text-muted-foreground">
				Alerts need a Kedaipal tab open somewhere (phone or computer).
				Closed-browser push notifications come with the Kedaipal app
				(coming later).
			</p>
		</div>
	);
}
