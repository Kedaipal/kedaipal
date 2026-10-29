// @vitest-environment jsdom

import { useQuery } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverseasDelivery } from "./overseas-delivery";

/**
 * Settings → Overseas delivery (z8r3fdr5yy) — the three things the /test-code
 * pass found on this page: a badge reading "Off" beside a switch showing on,
 * a help line pointing at a card that only exists once it's on, and the
 * saved price printed twice.
 */
vi.mock("convex/react");
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn() }));
vi.mock("../../hooks/useUpdateSettings", () => ({
	useUpdateSettings: () => vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("../../hooks/usePermission", () => ({
	usePermission: () => ({ canRead: true, canWrite: true, role: "owner" }),
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		search: _search,
		...props
	}: Record<string, unknown> & { to?: string; search?: unknown }) => (
		<a href={to} {...props} />
	),
	useNavigate: () => vi.fn(),
}));

beforeEach(() => {
	vi.mocked(useQuery).mockReturnValue({
		data: undefined,
		isPending: false,
	} as never);
});

afterEach(() => cleanup());

type Props = Parameters<typeof OverseasDelivery>[0];

function renderPage(over: Partial<Props> = {}) {
	return render(
		<OverseasDelivery
			retailerId={"rt_1" as never}
			storeCountry="SG"
			currency="SGD"
			// No features object = every feature (hasFeature's legacy default).
			subscription={undefined}
			offerDelivery
			deliveryConfig={undefined}
			lanes={undefined}
			{...over}
		/>,
	);
}

const toggle = () =>
	screen.getByRole("switch", { name: "Deliver to Malaysia" });

describe("the switch and its badge agree", () => {
	it("off reads Off; flipped on but unsaved reads 'Not saved yet', never Off", () => {
		renderPage();
		expect(screen.getByText("Off")).toBeTruthy();
		fireEvent.click(toggle());
		expect(toggle().getAttribute("aria-checked")).toBe("true");
		expect(screen.getByText("Not saved yet")).toBeTruthy();
		expect(screen.queryByText("Off")).toBeNull();
	});

	it("a saved lane reads On", () => {
		renderPage({
			lanes: [{ country: "MY", pricing: { kind: "flat", fee: 1200 } }],
		});
		expect(screen.getByText("On")).toBeTruthy();
	});
});

describe("the help never points at a card that isn't there", () => {
	it("off: no 'What can go' card, and the help doesn't send the seller to it", () => {
		renderPage();
		expect(screen.queryByRole("heading", { name: "What can go" })).toBeNull();
		expect(screen.queryByText(/Untick it under What can go/)).toBeNull();
		expect(
			screen.getByText(/Once delivery is on, you choose which products/),
		).toBeTruthy();
	});

	it("on: the card is there and the help names it", () => {
		renderPage({
			lanes: [{ country: "MY", pricing: { kind: "flat", fee: 1200 } }],
		});
		expect(screen.getByRole("heading", { name: "What can go" })).toBeTruthy();
		expect(screen.getByText(/Untick it under What can go/)).toBeTruthy();
	});

	it("an SG store is told Lalamove stays home — never Delyva, which it can't connect", () => {
		renderPage();
		expect(
			screen.getByText(/Lalamove delivers within Singapore only/),
		).toBeTruthy();
		expect(screen.queryByText(/Delyva/)).toBeNull();
	});
});

describe("the saved price is shown once — in the editor", () => {
	it("no summary line above the editor repeats it", () => {
		renderPage({
			lanes: [{ country: "MY", pricing: { kind: "flat", fee: 1200 } }],
		});
		// crossBorderPricingSummary's spelling — "S$12.00 per order".
		expect(screen.queryByText(/12\.00 per order/)).toBeNull();
		expect(
			(screen.getByLabelText("Fee per order") as HTMLInputElement).value,
		).toBe("12.00");
	});
});
