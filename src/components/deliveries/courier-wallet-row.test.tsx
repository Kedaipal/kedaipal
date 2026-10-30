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
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: (o: { fn: unknown }) => ({
		data:
			getFunctionName(o.fn as never) === "courierWallets:list"
				? s.wallets
				: undefined,
	}),
}));
vi.mock("convex/react", () => ({
	useAction: () =>
		vi.fn(async () => ({ ok: true, balanceMinor: 5000, currency: "SGD" })),
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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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

function row(
	view: CourierWalletView,
	opts: { editable?: boolean; topUp?: "needed" | "always" } = {},
) {
	render(
		<CourierWalletList
			wallets={[view]}
			retailerId={"r1" as never}
			country="MY"
			editable={opts.editable ?? true}
			topUp={opts.topUp ?? "needed"}
		/>,
	);
	return screen.getByTestId(`courier-wallet-${view.provider}`);
}

afterEach(() => {
	cleanup();
	s.lock = { readOnly: false, reason: "", cause: null };
	s.canReadIntegrations = true;
	s.wallets = [];
});

describe("CourierWalletRow", () => {
	it("a healthy wallet is quiet — no Top up on Home/Deliveries, but the account's home offers one", () => {
		row(v());
		expect(screen.queryByRole("button", { name: /^Top up/ })).toBeNull();
		cleanup();
		row(v(), { topUp: "always" });
		expect(
			screen.getByRole("button", { name: "Top up Lalamove" }),
		).toBeTruthy();
	});

	it("a low Lalamove wallet leads with Top up and the Business-account note", () => {
		const el = row(v({ state: "low", balanceMinor: 1240 }));
		expect(el.getAttribute("data-state")).toBe("low");
		expect(
			screen.getByRole("button", { name: "Top up Lalamove" }),
		).toBeTruthy();
		expect(el.textContent).toMatch(/Business account your keys belong to/);
	});

	it("a test account never asks for money", () => {
		row(v({ isTest: true, state: "empty", balanceMinor: 0 }), {
			topUp: "always",
		});
		expect(screen.queryByRole("button", { name: /^Top up/ })).toBeNull();
		expect(screen.getByText("Test")).toBeTruthy();
	});

	it("Delyva's unshared wallet offers the way to look it up there", () => {
		row(
			v({
				provider: "delyva",
				state: "unshared",
				balanceMinor: null,
				at: null,
				source: null,
			}),
		);
		expect(
			screen.getByRole("button", { name: "Check in Delyva" }),
		).toBeTruthy();
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
		).toBe("https://web.lalamove.com");
		expect(screen.queryByRole("button", { name: /I've topped up/ })).toBeNull();
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
	const line = (provider: "lalamove" | "easyparcel", price: number) => {
		render(
			<DispatchWalletLine
				provider={provider}
				priceMinor={price}
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
		expect(line("easyparcel", 1150).getAttribute("data-verdict")).toBe("block");
	});

	it("renders nothing for a courier that isn't connected", () => {
		s.wallets = [];
		render(
			<DispatchWalletLine
				provider="delyva"
				priceMinor={500}
				retailerId={"r1" as never}
				country="MY"
			/>,
		);
		expect(screen.queryByTestId("dispatch-wallet-delyva")).toBeNull();
	});
});
