// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CourierWalletView } from "../../lib/courier-wallets";

/**
 * The ONE courier-wallet row (z8r3fdx34j) and the hand-off it opens: every
 * surface draws this, so its rules are pinned here once.
 */

const s = vi.hoisted(() => ({
	lock: { readOnly: false, reason: "", cause: null as string | null },
	canReadIntegrations: true,
	wallets: [] as unknown[],
	suggestion: null as unknown,
	refresh: vi.fn(async () => ({
		ok: true,
		balanceMinor: 5000,
		currency: "SGD",
	})),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: (o: { fn: unknown }) => ({
		data:
			getFunctionName(o.fn as never) === "courierWallets:list"
				? s.wallets
				: getFunctionName(o.fn as never) === "courierWallets:topUpSuggestion"
					? s.suggestion
					: undefined,
	}),
}));
vi.mock("convex/react", () => ({
	useAction: () => s.refresh,
	useMutation: () => vi.fn(),
}));
vi.mock("../../hooks/usePermission", () => ({
	usePermission: () => ({
		canRead: s.canReadIntegrations,
		canWrite: true,
		role: "owner",
	}),
}));
vi.mock("../../hooks/useStoreLock", () => ({
	useAreaLock: () => s.lock,
}));
vi.mock("../../hooks/useActAs", () => ({
	useActAsRetailerId: () => undefined,
}));
vi.mock("sonner", () => ({
	toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import { act } from "@testing-library/react";
import { resetTopUpAwaiting } from "../../lib/top-up-awaiting";
import { CourierWalletList } from "./courier-wallets-section";
import { DispatchWalletLine } from "./dispatch-wallet-line";

const v = (o: Partial<CourierWalletView> = {}): CourierWalletView => ({
	provider: "lalamove",
	armed: true,
	isTest: false,
	state: "ok",
	balanceMinor: 8450,
	currency: "MYR",
	at: Date.now() - 60_000,
	lowAlertMinor: 3000,
	lowAlertCustom: false,
	source: "webhook",
	refusedAt: null,
	refusedPriceMinor: null,
	...o,
});

function row(view: CourierWalletView, opts: { editable?: boolean } = {}) {
	render(
		<CourierWalletList
			wallets={[view]}
			retailerId={"r1" as never}
			country="MY"
			editable={opts.editable ?? true}
		/>,
	);
	return screen.getByTestId(`courier-wallet-${view.provider}`);
}

afterEach(() => {
	cleanup();
	s.lock = { readOnly: false, reason: "", cause: null };
	s.canReadIntegrations = true;
	s.wallets = [];
	s.suggestion = null;
	s.refresh.mockClear();
	resetTopUpAwaiting();
});

describe("CourierWalletRow", () => {
	it("every real wallet offers its top-up — quiet when healthy, filled when it needs money", () => {
		// Zaki, 31 Oct: Top up is always there, on every surface.
		row(v());
		const quiet = screen.getByRole("button", { name: "Top up Lalamove" });
		expect(quiet.className).toContain("border");
		expect(quiet.className).not.toContain("bg-accent");
		cleanup();
		row(v({ state: "low", balanceMinor: 1240 }));
		expect(
			screen.getByRole("button", { name: "Top up Lalamove" }).className,
		).toContain("bg-accent");
	});

	it("a low Lalamove wallet leads with Top up and the Business-account note", () => {
		const el = row(v({ state: "low", balanceMinor: 1240 }));
		expect(el.getAttribute("data-state")).toBe("low");
		expect(
			screen.getByRole("button", { name: "Top up Lalamove" }),
		).toBeTruthy();
		expect(el.textContent).toMatch(
			/Partner Portal, the account your API keys come from/,
		);
	});

	it("a test account never asks for money", () => {
		row(v({ isTest: true, state: "empty", balanceMinor: 0 }));
		expect(screen.queryByRole("button", { name: /^Top up/ })).toBeNull();
		expect(screen.getByText("Test")).toBeTruthy();
	});

	it("a word figure carries its state's colour — 'Too low' reads red, 'Not shared' stays quiet", () => {
		row(
			v({
				state: "short",
				balanceMinor: null,
				source: null,
				refusedAt: Date.now() - 60_000,
			}),
		);
		expect(screen.getByText("Too low").className).toMatch(/text-red-700/);
		cleanup();
		row(
			v({
				provider: "delyva",
				state: "unshared",
				balanceMinor: null,
				at: null,
				source: null,
			}),
		);
		expect(screen.getByText("Not shared").className).toMatch(
			/text-muted-foreground/,
		);
	});

	it("Delyva's unshared wallet still offers Top up — the sheet says it can't be read", () => {
		row(
			v({
				provider: "delyva",
				state: "unshared",
				balanceMinor: null,
				at: null,
				source: null,
			}),
		);
		expect(screen.getByRole("button", { name: "Top up Delyva" })).toBeTruthy();
		// An alert line on a number we never see would be a setting that does nothing.
		expect(screen.queryByText(/Alert at/)).toBeNull();
	});

	it("only a wallet we can ASK offers Refresh (EasyParcel), and only to integrations readers", () => {
		row(v({ provider: "easyparcel", currency: "SGD", source: "pull" }));
		expect(screen.getByRole("button", { name: /Refresh/ })).toBeTruthy();
		cleanup();
		row(v());
		expect(screen.queryByRole("button", { name: /Refresh/ })).toBeNull();
		cleanup();
		s.canReadIntegrations = false;
		row(v({ provider: "easyparcel", currency: "SGD", source: "pull" }));
		expect(screen.queryByRole("button", { name: /Refresh/ })).toBeNull();
	});

	it("the alert line is editable in place — or a statement with the reason when locked", () => {
		row(v());
		expect(
			screen.getByRole("button", {
				name: /Alert at RM\s?30 — change the low alert/,
			}),
		).toBeTruthy();
		cleanup();
		s.lock = {
			readOnly: true,
			reason: "Ask the store owner for edit access to Integrations.",
			cause: "permission",
		};
		row(v());
		expect(
			screen.queryByRole("button", { name: /change the low alert/ }),
		).toBeNull();
		expect(screen.getByText(/Alert at RM\s?30/).getAttribute("title")).toMatch(
			/Ask the store owner/,
		);
	});

	it("Top up opens the hand-off: the steps, the courier's own site, no 'I've topped up' for push-only Lalamove", () => {
		row(v({ state: "low", balanceMinor: 1240 }));
		fireEvent.click(screen.getByRole("button", { name: "Top up Lalamove" }));
		const dialog = screen.getByRole("dialog");
		expect(dialog.textContent).toMatch(
			/Lalamove holds this money, not Kedaipal/,
		);
		expect(
			screen.getByRole("link", { name: /Open Lalamove/ }).getAttribute("href"),
		).toBe("https://partnerportal.lalamove.com/wallet");
		expect(screen.queryByRole("button", { name: /I've topped up/ })).toBeNull();
	});

	it("suggests an amount from the store's own bookings — a guide, not a charge", () => {
		s.suggestion = {
			currency: "MYR",
			bookings: 9,
			options: [
				{ label: "~1 week", trips: 2, minor: 2500 },
				{ label: "~4 trips", trips: 4, minor: 5000 },
			],
		};
		row(v({ state: "low", balanceMinor: 1240 }));
		fireEvent.click(screen.getByRole("button", { name: "Top up Lalamove" }));
		const box = screen.getByTestId("top-up-suggestion");
		expect(box.textContent).toMatch(/RM\s?25~1 week/);
		expect(box.textContent).toMatch(/RM\s?50~4 trips/);
		expect(box.textContent).toMatch(/From your last 9 Lalamove bookings/);
		// Lalamove has no auto top-up of its own to offer.
		expect(screen.queryByText(/Never run dry/)).toBeNull();
	});

	it("leaving for the courier marks the wallet as waiting, until a newer balance lands", () => {
		const view = v({
			state: "low",
			balanceMinor: 1240,
			at: Date.now() - 60_000,
		});
		const { rerender } = render(
			<CourierWalletList
				wallets={[view]}
				retailerId={"r1" as never}
				country="MY"
				editable={false}
			/>,
		);
		expect(screen.queryByTestId("wallet-awaiting-top-up")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Top up Lalamove" }));
		fireEvent.click(screen.getByRole("link", { name: /Open Lalamove/ }));
		expect(screen.getByTestId("wallet-awaiting-top-up").textContent).toMatch(
			/Waiting for Lalamove to report your top-up/,
		);
		// A booking's spend is a newer reading too — still waiting.
		rerender(
			<CourierWalletList
				wallets={[{ ...view, balanceMinor: 80, at: Date.now() + 500 }]}
				retailerId={"r1" as never}
				country="MY"
				editable={false}
			/>,
		);
		expect(screen.getByTestId("wallet-awaiting-top-up")).toBeTruthy();
		// Lalamove's webhook lands a newer, higher balance: waiting ends by itself.
		rerender(
			<CourierWalletList
				wallets={[{ ...view, balanceMinor: 9240, at: Date.now() + 1_000 }]}
				retailerId={"r1" as never}
				country="MY"
				editable={false}
			/>,
		);
		expect(screen.queryByTestId("wallet-awaiting-top-up")).toBeNull();
		// …and the open sheet says it landed, rather than going quiet.
		expect(screen.getByTestId("top-up-landed").textContent).toMatch(
			/Lalamove reported your top-up — the wallet holds RM\s?92\.40 now/,
		);
	});

	it("EasyParcel: the auto top-up way out, and coming back re-reads the balance once", async () => {
		row(
			v({
				provider: "easyparcel",
				state: "low",
				balanceMinor: 1500,
				source: "pull",
				at: Date.now() - 60_000,
			}),
		);
		fireEvent.click(screen.getByRole("button", { name: "Top up EasyParcel" }));
		expect(
			screen.getByRole("link", { name: /Never run dry/ }).getAttribute("href"),
		).toBe("https://app.easyparcel.com/my/en/account/auto-topup/");
		fireEvent.click(screen.getByRole("link", { name: /Open EasyParcel/ }));
		await act(async () => {
			document.dispatchEvent(new Event("visibilitychange"));
		});
		expect(s.refresh).toHaveBeenCalledTimes(1);
		// A second return within the minute doesn't ask EasyParcel again.
		await act(async () => {
			document.dispatchEvent(new Event("visibilitychange"));
		});
		expect(s.refresh).toHaveBeenCalledTimes(1);
	});

	it("EasyParcel's hand-off can re-check the balance after a top-up", () => {
		row(
			v({
				provider: "easyparcel",
				currency: "SGD",
				state: "empty",
				balanceMinor: 0,
				source: "pull",
			}),
		);
		fireEvent.click(screen.getByRole("button", { name: "Top up EasyParcel" }));
		expect(
			screen.getByRole("button", { name: /I've topped up — check again/ }),
		).toBeTruthy();
	});
});

describe("DispatchWalletLine", () => {
	const line = (
		provider: "lalamove" | "easyparcel",
		price: number,
		currency = "MYR",
	) => {
		render(
			<DispatchWalletLine
				provider={provider}
				priceMinor={price}
				priceCurrency={currency}
				retailerId={"r1" as never}
				country="MY"
			/>,
		);
		return screen.getByTestId(`dispatch-wallet-${provider}`);
	};

	it("warns (Book stays live) on a pushed balance that looks short", () => {
		s.wallets = [v({ balanceMinor: 840, state: "low" })];
		const el = line("lalamove", 1270);
		expect(el.getAttribute("data-verdict")).toBe("warn");
		expect(el.textContent).toMatch(/Lalamove has the final say/);
		// A live key: the Business-account trap is worth saying.
		expect(el.textContent).toMatch(
			/Partner Portal, the account your API keys come from/,
		);
	});

	it("a sandbox key's warn never says to top up in the Partner Portal", () => {
		// Regression (test-code, 31 Oct): it contradicted the sandbox banner.
		s.wallets = [v({ balanceMinor: 840, state: "low", isTest: true })];
		const el = line("lalamove", 1270);
		expect(el.getAttribute("data-verdict")).toBe("warn");
		expect(el.textContent).not.toMatch(/Partner Portal/);
		expect(screen.queryByRole("button", { name: /Top up/ })).toBeNull();
	});

	it("a quote in another currency than the wallet is never compared", () => {
		s.wallets = [
			v({
				provider: "easyparcel",
				source: "pull",
				at: Date.now(),
				balanceMinor: 300,
			}),
		];
		const el = line("easyparcel", 475, "HKD");
		expect(el.getAttribute("data-verdict")).toBe("unknown");
		expect(el.textContent).not.toMatch(/short|Top up first/);
	});

	it("blocks on a balance pulled moments ago that can't pay", () => {
		s.wallets = [
			v({
				provider: "easyparcel",
				currency: "SGD",
				source: "pull",
				at: Date.now(),
				balanceMinor: 800,
			}),
		];
		expect(line("easyparcel", 1150, "SGD").getAttribute("data-verdict")).toBe(
			"block",
		);
	});

	it("renders nothing for a courier that isn't connected", () => {
		s.wallets = [];
		render(
			<DispatchWalletLine
				provider="delyva"
				priceMinor={500}
				priceCurrency="MYR"
				retailerId={"r1" as never}
				country="MY"
			/>,
		);
		expect(screen.queryByTestId("dispatch-wallet-delyva")).toBeNull();
	});
});
