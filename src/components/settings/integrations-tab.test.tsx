// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SPOTLIGHT_ANCHOR } from "../../lib/spotlight";
import { IntegrationsTab } from "./integrations-tab";

// The account cards each own Convex reads/actions; the tab under test is the
// frame around them, so they are stubbed to a marker each. The two courier
// cards wrap their OWN AccountCard shell (so hiding takes the border with
// them — z8r3fdcje2), so their stubs render the real shell with the props the
// tab hands down, which is exactly the wiring these tests pin.
vi.mock("./lalamove-integration-card", () => ({
	LalamoveIntegrationCard: () => <p>lalamove card</p>,
}));
vi.mock("./delyva-card", async () => {
	const { AccountCard } = await import("./settings-primitives");
	return {
		DelyvaCard: ({
			shellId,
			highlight,
		}: {
			shellId: string;
			highlight: "spotlight" | undefined;
		}) => (
			<AccountCard id={shellId} highlight={highlight}>
				<p>delyva card</p>
			</AccountCard>
		),
	};
});
vi.mock("./easyparcel-card", async () => {
	const { AccountCard } = await import("./settings-primitives");
	return {
		EasyparcelCard: ({
			shellId,
			highlight,
		}: {
			shellId: string;
			highlight: "spotlight" | undefined;
		}) => (
			<AccountCard id={shellId} highlight={highlight}>
				<p>easyparcel card</p>
			</AccountCard>
		),
	};
});
vi.mock("./online-payments-card", () => ({
	OnlinePaymentsCard: () => <p>hitpay card</p>,
}));

afterEach(cleanup);

function renderTab(target?: { anchor: string; highlight: "spotlight" }) {
	return render(
		<IntegrationsTab
			target={target}
			retailerId={"r1" as never}
			country="MY"
			deliveryBooking={undefined}
			businessAddress={undefined}
			hitpay={undefined}
			subscription={undefined}
			onSave={vi.fn() as never}
			onOpenPayments={vi.fn()}
		/>,
	);
}

describe("IntegrationsTab deep-link cards", () => {
	it("renders every account card under its registry anchor", () => {
		// The What's-new notes for Delyva and Lalamove SG land here; a card
		// without its id is a note that scrolls nowhere.
		const { container } = renderTab();
		for (const key of ["lalamove", "delyva", "easyparcel", "hitpay"] as const) {
			const el = container.querySelector(`#${SPOTLIGHT_ANCHOR[key].anchor}`);
			expect(el, `${key} card is missing its anchor`).not.toBeNull();
			expect(el?.tagName).toBe("SECTION");
		}
	});

	it("a spotlight target rings exactly that card, in mint", () => {
		const { container } = renderTab({
			anchor: SPOTLIGHT_ANCHOR.delyva.anchor,
			highlight: "spotlight",
		});
		const ringed = container.querySelectorAll("[data-fix-highlight]");
		expect(ringed).toHaveLength(1);
		expect(ringed[0]?.id).toBe(SPOTLIGHT_ANCHOR.delyva.anchor);
		expect(ringed[0]?.getAttribute("data-fix-highlight")).toBe("spotlight");
		expect(ringed[0]?.className).toMatch(/ring-accent/);
	});

	it("no target means no ring — the mint glow is never a resting state", () => {
		const { container } = renderTab();
		expect(container.querySelectorAll("[data-fix-highlight]")).toHaveLength(0);
	});
});
