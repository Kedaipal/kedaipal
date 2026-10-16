// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The merged Order alerts card (86eye9xd4, 7A). Carries over every behaviour
 * the old WhatsApp-alerts card pinned (normalized patch, inline phone error,
 * the +60 plate, STOP warning) and adds the two
 * channels that joined it — this device (per browser) and email — plus the
 * owner-only split a teammate sees. Since z8r3fdv55f the WhatsApp switch is
 * on by default on every plan, so the row separates "switched on" from
 * "actually sending" (no number yet / subscription paused).
 */

const prefs = { enabled: false, sound: true };
const setNotifyPrefs = vi.fn();
vi.mock("../../hooks/useOrderNotifications", () => ({
	useNotifyPrefs: () => prefs,
	setNotifyPrefs: (next: Partial<typeof prefs>) => setNotifyPrefs(next),
	notificationsSupported: () => typeof globalThis.Notification !== "undefined",
	playChime: vi.fn(),
}));

const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
	toast: {
		success: (...a: unknown[]) => toastSuccess(...a),
		error: vi.fn(),
		info: vi.fn(),
	},
}));

import { OrderAlertsCard } from "./order-alerts-card";

type Props = Parameters<typeof OrderAlertsCard>[0];
type WhatsApp = NonNullable<Props["whatsapp"]>;

const WA_OFF: WhatsApp = {
	switchedOn: false,
	currentPhone: "",
	fallbackPhone: "",
	optedOut: false,
	covered: true,
};
const wa = (over: Partial<WhatsApp>): WhatsApp => ({ ...WA_OFF, ...over });

function renderCard(overrides: Partial<Props> = {}) {
	const onSave = vi.fn().mockResolvedValue({ ok: true });
	render(
		<OrderAlertsCard
			whatsapp={WA_OFF}
			notifyEmail=""
			country="MY"
			canEditAccount
			onSave={onSave}
			{...overrides}
		/>,
	);
	return onSave;
}

function stubNotification(permission: NotificationPermission) {
	vi.stubGlobal(
		"Notification",
		Object.assign(vi.fn(), {
			permission,
			requestPermission: vi.fn().mockResolvedValue("granted"),
		}),
	);
}

beforeEach(() => {
	prefs.enabled = false;
	prefs.sound = true;
	stubNotification("default");
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

const toggle = (name: RegExp) =>
	screen.getByRole("switch", { name }) as HTMLButtonElement;

describe("OrderAlertsCard — WhatsApp row", () => {
	it("on by default with no number: says so, offers the store's number in one tap, and email is the live channel", async () => {
		const onSave = renderCard({
			notifyEmail: "orders@shop.my",
			whatsapp: wa({ switchedOn: true, fallbackPhone: "60198765432" }),
		});
		expect(toggle(/whatsapp order alerts/i).getAttribute("aria-checked")).toBe(
			"true",
		);
		expect(screen.getByText("Needs a number")).toBeDefined();
		expect(
			screen.getByText(/Until then, alerts go to your email/i),
		).toBeDefined();
		// The email isn't labelled a backup while WhatsApp can't send.
		expect(screen.getByText("orders@shop.my")).toBeDefined();
		expect(screen.queryByText(/backup while WhatsApp is on/i)).toBeNull();
		expect(screen.getByText("1 of 3 on")).toBeDefined();
		fireEvent.click(
			screen.getByRole("button", { name: /use \+60 19-876 5432/i }),
		);
		await waitFor(() =>
			expect(onSave).toHaveBeenCalledWith({ notifyWaPhone: "60198765432" }),
		);
	});

	it("on by default with no number anywhere: Add number opens the field and saves only the number", async () => {
		const onSave = renderCard({ whatsapp: wa({ switchedOn: true }) });
		expect(screen.queryByRole("button", { name: /^use /i })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: /add number/i }));
		// The editor opens behind the +60 plate, never a blank country code.
		expect(screen.getByText("+60")).toBeDefined();
		fireEvent.change(screen.getByPlaceholderText("12-345 6789"), {
			target: { value: "019-876 5432" },
		});
		fireEvent.click(screen.getByRole("button", { name: /save number/i }));
		await waitFor(() =>
			expect(onSave).toHaveBeenCalledWith({ notifyWaPhone: "60198765432" }),
		);
	});

	it("switching back on uses the store's own number in ONE tap, saving the normalized form", async () => {
		const onSave = renderCard({
			whatsapp: wa({ fallbackPhone: "60198765432" }),
		});
		fireEvent.click(toggle(/whatsapp order alerts/i));
		await waitFor(() =>
			expect(onSave).toHaveBeenCalledWith({
				notifyWaPhone: "60198765432",
				orderWaAlerts: true,
			}),
		);
	});

	it("switching back on with no number anywhere still turns it on, then asks for one", async () => {
		const onSave = renderCard();
		fireEvent.click(toggle(/whatsapp order alerts/i));
		await waitFor(() =>
			expect(onSave).toHaveBeenCalledWith({ orderWaAlerts: true }),
		);
		expect(await screen.findByText("+60")).toBeDefined();
	});

	it("rejects a non-mobile number inline without calling onSave", async () => {
		const onSave = renderCard({ whatsapp: wa({ switchedOn: true }) });
		fireEvent.click(screen.getByRole("button", { name: /add number/i }));
		fireEvent.change(screen.getByPlaceholderText("12-345 6789"), {
			target: { value: "03-8888 1234" },
		});
		fireEvent.click(screen.getByRole("button", { name: /save number/i }));
		expect(await screen.findByText(/Malaysian mobile number/i)).toBeDefined();
		expect(onSave).not.toHaveBeenCalled();
	});

	it("live: shows the number, On, and email becomes the backup", () => {
		renderCard({
			notifyEmail: "orders@shop.my",
			whatsapp: wa({ switchedOn: true, currentPhone: "60198765432" }),
		});
		expect(screen.getByText("+60 19-876 5432")).toBeDefined();
		expect(screen.getAllByText("On").length).toBeGreaterThan(0);
		expect(screen.getByText(/backup while WhatsApp is on/i)).toBeDefined();
		expect(screen.queryByText("Pro")).toBeNull();
	});

	it("subscription not covering it: Paused, says email has it, and points at Billing", () => {
		renderCard({
			notifyEmail: "orders@shop.my",
			whatsapp: wa({
				switchedOn: true,
				currentPhone: "60198765432",
				covered: false,
			}),
		});
		expect(screen.getByText("Paused")).toBeDefined();
		expect(screen.getByText(/Settings → Billing/)).toBeDefined();
		expect(screen.queryByText(/backup while WhatsApp is on/i)).toBeNull();
	});

	it("turning OFF saves only the switch", async () => {
		const onSave = renderCard({
			whatsapp: wa({ switchedOn: true, currentPhone: "60198765432" }),
		});
		fireEvent.click(toggle(/whatsapp order alerts/i));
		await waitFor(() =>
			expect(onSave).toHaveBeenCalledWith({ orderWaAlerts: false }),
		);
	});

	it("a STOP'd number shows the suppression warning with the START fix", () => {
		renderCard({
			whatsapp: wa({
				switchedOn: true,
				currentPhone: "60198765432",
				optedOut: true,
			}),
		});
		expect(screen.getByText("Blocked")).toBeDefined();
		expect(screen.getByText(/STOP/)).toBeDefined();
		expect(screen.getByText(/START/)).toBeDefined();
	});

	it("has no WhatsApp row where the deployment has no seller template", () => {
		renderCard({ whatsapp: undefined, notifyEmail: "a@b.co" });
		expect(screen.queryByRole("switch", { name: /whatsapp/i })).toBeNull();
		expect(screen.getByText("1 of 2 on")).toBeDefined();
	});
});

describe("OrderAlertsCard — this device", () => {
	it("switching on asks the browser, then saves the per-device preference", async () => {
		renderCard();
		fireEvent.click(toggle(/order alerts on this device/i));
		await waitFor(() =>
			expect(setNotifyPrefs).toHaveBeenCalledWith({ enabled: true }),
		);
	});

	it("blocked permission shows the unblock steps and a disabled switch", () => {
		stubNotification("denied");
		renderCard();
		expect(screen.getByText(/blocked in this browser/i)).toBeDefined();
		expect(screen.getByText(/Reload this page/i)).toBeDefined();
		expect(toggle(/order alerts on this device/i).disabled).toBe(true);
	});

	it("an unsupported browser says how to get alerts, not just that it can't", () => {
		vi.unstubAllGlobals();
		// @ts-expect-error — removing the API is the point of this case.
		delete globalThis.Notification;
		renderCard();
		expect(screen.getByText(/Not supported in this browser/i)).toBeDefined();
		expect(screen.getByText(/Add to Home Screen/i)).toBeDefined();
		expect(toggle(/order alerts on this device/i).disabled).toBe(true);
	});
});

describe("OrderAlertsCard — email", () => {
	it("switching email off clears the address and offers Undo with the same address", async () => {
		const onSave = renderCard({ notifyEmail: "orders@shop.my" });
		fireEvent.click(toggle(/email order alerts/i));
		await waitFor(() =>
			expect(onSave).toHaveBeenCalledWith({ notifyEmail: "" }),
		);
		const [, options] = toastSuccess.mock.calls.at(-1) as [
			string,
			{ action: { onClick: () => void } },
		];
		options.action.onClick();
		expect(onSave).toHaveBeenLastCalledWith({ notifyEmail: "orders@shop.my" });
	});

	it("switching email on with none saved opens the field and validates it", async () => {
		const onSave = renderCard();
		fireEvent.click(toggle(/email order alerts/i));
		expect(onSave).not.toHaveBeenCalled();
		fireEvent.change(screen.getByLabelText("Notification email"), {
			target: { value: "not-an-email" },
		});
		fireEvent.click(screen.getByRole("button", { name: /save email/i }));
		expect(await screen.findByText(/name@example.com/)).toBeDefined();
		expect(onSave).not.toHaveBeenCalled();
		fireEvent.change(screen.getByLabelText("Notification email"), {
			target: { value: " orders@shop.my " },
		});
		fireEvent.click(screen.getByRole("button", { name: /save email/i }));
		await waitFor(() =>
			expect(onSave).toHaveBeenCalledWith({ notifyEmail: "orders@shop.my" }),
		);
	});
});

describe("OrderAlertsCard — who can change what", () => {
	it("a teammate can switch THIS device but not the store's WhatsApp or email", () => {
		renderCard({
			canEditAccount: false,
			notifyEmail: "orders@shop.my",
			whatsapp: wa({ switchedOn: true, currentPhone: "60198765432" }),
		});
		expect(toggle(/whatsapp order alerts/i).disabled).toBe(true);
		expect(toggle(/email order alerts/i).disabled).toBe(true);
		expect(toggle(/order alerts on this device/i).disabled).toBe(false);
		expect(screen.getByText(/only they can change them/i)).toBeDefined();
	});

	it("the header glance counts channels on, and warns when none are", () => {
		renderCard();
		expect(screen.getByText("No alerts on")).toBeDefined();
	});
});
