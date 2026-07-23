import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

/**
 * Browser notifications for the seller dashboard (docs/order-notifications.md):
 * a chime + system notification the moment a new order lands or a Lalamove
 * booking fails, on any device where the dashboard tab is open (foreground OR
 * background). Convex reactivity is the push channel — no polling, no service
 * worker. True closed-browser push is the separate "PWA + Push" roadmap item,
 * and the settings card says so.
 *
 * Preferences are PER DEVICE (localStorage) — a seller may want the counter
 * iPad chiming but not their personal phone.
 */

const PREFS_KEY = "kedaipal:notifyPrefs";

export type NotifyPrefs = {
	/** Master switch — also gates the Convex subscription entirely. */
	enabled: boolean;
	/** Play the chime alongside the system notification. */
	sound: boolean;
};

const DEFAULT_PREFS: NotifyPrefs = { enabled: false, sound: true };

let listeners: Array<() => void> = [];
let cache: NotifyPrefs | null = null;

function readPrefs(): NotifyPrefs {
	if (cache) return cache;
	if (typeof window === "undefined") return DEFAULT_PREFS;
	try {
		const raw = window.localStorage.getItem(PREFS_KEY);
		cache = raw
			? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<NotifyPrefs>) }
			: DEFAULT_PREFS;
	} catch {
		cache = DEFAULT_PREFS;
	}
	return cache;
}

export function setNotifyPrefs(next: Partial<NotifyPrefs>): void {
	const merged = { ...readPrefs(), ...next };
	cache = merged;
	try {
		window.localStorage.setItem(PREFS_KEY, JSON.stringify(merged));
	} catch {
		// private mode — prefs just won't persist
	}
	for (const fn of listeners) fn();
}

export function useNotifyPrefs(): NotifyPrefs {
	return useSyncExternalStore(
		(cb) => {
			listeners.push(cb);
			return () => {
				listeners = listeners.filter((fn) => fn !== cb);
			};
		},
		readPrefs,
		() => DEFAULT_PREFS,
	);
}

export function notificationsSupported(): boolean {
	return typeof window !== "undefined" && "Notification" in window;
}

/** Two-tone WebAudio chime — no asset, works offline, ~0.3s. */
export function playChime(): void {
	try {
		const AudioCtx =
			window.AudioContext ??
			(window as unknown as { webkitAudioContext?: typeof AudioContext })
				.webkitAudioContext;
		if (!AudioCtx) return;
		const ctx = new AudioCtx();
		const play = (freq: number, at: number) => {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = "sine";
			osc.frequency.value = freq;
			gain.gain.setValueAtTime(0.001, ctx.currentTime + at);
			gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + at + 0.02);
			gain.gain.exponentialRampToValueAtTime(
				0.001,
				ctx.currentTime + at + 0.28,
			);
			osc.connect(gain).connect(ctx.destination);
			osc.start(ctx.currentTime + at);
			osc.stop(ctx.currentTime + at + 0.3);
		};
		play(880, 0);
		play(1174.66, 0.16); // D6 — a cheerful up-interval
		window.setTimeout(() => void ctx.close(), 800);
	} catch {
		// Autoplay policy or no audio device — the visual notification stands.
	}
}

/** Flash the tab title briefly so a background tab is noticeable even with
 * system notifications off. */
function flashTitle(text: string): void {
	const original = document.title;
	document.title = text;
	window.setTimeout(() => {
		document.title = original;
	}, 6000);
}

function showSystemNotification(
	title: string,
	body: string,
	onClick: () => void,
): void {
	if (!notificationsSupported() || Notification.permission !== "granted")
		return;
	try {
		const n = new Notification(title, {
			body,
			icon: "/logo.svg",
			tag: "kedaipal-order-alert", // collapse bursts into one
		});
		n.onclick = () => {
			window.focus();
			onClick();
			n.close();
		};
	} catch {
		// Some browsers (iOS Safari non-PWA) throw despite reporting support.
	}
}

/**
 * Invisible bridge component — mounted once in the authed app shell. Watches
 * the latestActivity stamps and raises alerts on increases. The first sample
 * after (re)subscribe is the BASELINE, never an alert — otherwise every page
 * load would chime for the newest existing order.
 */
export function OrderNotificationsBridge({
	retailerId,
}: {
	retailerId: Id<"retailers"> | undefined;
}) {
	const prefs = useNotifyPrefs();
	const navigate = useNavigate();
	const activity = useQuery(
		api.notifications.latestActivity,
		retailerId && prefs.enabled ? { retailerId } : "skip",
	);
	const baseline = useRef<{
		orderAt: number;
		failedAt: number;
	} | null>(null);

	// Re-baseline whenever the subscription target changes or alerts are
	// toggled off (so re-enabling doesn't replay the backlog).
	useEffect(() => {
		baseline.current = null;
	}, [retailerId, prefs.enabled]);

	useEffect(() => {
		if (!activity) return;
		const orderAt = activity.newestOrder?.createdAt ?? 0;
		const failedAt = activity.newestFailedBooking?.failedAt ?? 0;
		if (baseline.current === null) {
			baseline.current = { orderAt, failedAt };
			return;
		}

		if (activity.newestOrder && orderAt > baseline.current.orderAt) {
			const { shortId } = activity.newestOrder;
			if (prefs.sound) playChime();
			flashTitle(`🔔 New order ${shortId} — Kedaipal`);
			const open = () => navigate({ to: `/app/orders/${shortId}` });
			showSystemNotification(
				`New order ${shortId}`,
				"Tap to open it in Kedaipal.",
				open,
			);
			toast.success(`New order ${shortId}`, {
				action: { label: "Open", onClick: open },
			});
		}

		if (
			activity.newestFailedBooking &&
			failedAt > baseline.current.failedAt
		) {
			const { shortId, reason } = activity.newestFailedBooking;
			if (prefs.sound) playChime();
			flashTitle(`⚠️ Rider booking failed — ${shortId}`);
			const open = () => navigate({ to: `/app/orders/${shortId}` });
			showSystemNotification(
				`Rider booking failed — ${shortId}`,
				`${reason ?? "The booking didn't go through"}. Tap to rebook.`,
				open,
			);
			toast.error(`Rider booking failed — ${shortId}`, {
				action: { label: "Rebook", onClick: open },
			});
		}

		baseline.current = { orderAt, failedAt };
	}, [activity, prefs.sound, navigate]);

	return null;
}
