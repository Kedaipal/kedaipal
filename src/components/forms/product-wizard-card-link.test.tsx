// @vitest-environment jsdom
/**
 * Render cover for the step-0 deep link (`z8r3fdhkr7`): `/app/products/new?card=event`
 * is where the v2026.09.7 "Host an event" note sends a seller. The pure tests
 * pin the state; these pin what the seller actually SEES on arrival — which
 * card is lit, whether the store-type badge still claims the page, the Event
 * route's step count, and the refusal a locked plan gets instead of a flow it
 * can't publish.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("convex/react", () => ({
	useMutation: () => vi.fn(),
}));
// The wizard reads pickup points + categories via the adapter — stub to "loading".
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: undefined, isPending: true }),
}));

import type { ProductKind } from "../../../convex/lib/productKind";
import { type KindCard, ProductWizard } from "./product-wizard";

afterEach(cleanup);

function renderWizard({
	defaultKind,
	initialCard,
	eventsLocked = false,
	currency = "RM",
}: {
	defaultKind?: ProductKind;
	initialCard?: KindCard;
	eventsLocked?: boolean;
	currency?: string;
} = {}) {
	return render(
		<ProductWizard
			retailerId={"r1" as never}
			categoriesLocked={false}
			eventsLocked={eventsLocked}
			currency={currency}
			defaultKind={defaultKind}
			initialCard={initialCard}
			onSubmit={vi.fn() as never}
			onSkipToFullForm={vi.fn()}
			onOpenFullForm={vi.fn()}
			onExit={vi.fn()}
		/>,
	);
}

const pressed = (name: RegExp) =>
	screen.getByRole("button", { name }).getAttribute("aria-pressed");
const continueBtn = () => screen.getByRole("button", { name: /continue/i });

describe("wizard — `?card=` deep link (`z8r3fdhkr7`)", () => {
	it("lands on Event, not the store's own type — and the badge stops claiming the page", () => {
		renderWizard({ defaultKind: "booking", initialCard: "event" });
		expect(pressed(/^event/i)).toBe("true");
		expect(pressed(/^booking/i)).toBe("false");
		// "Your store type" explains a PRE-selection; with the link's card lit
		// it would badge a card that isn't selected.
		expect(screen.queryByText("Your store type")).toBeNull();
		// The Event route's hint and a live Continue — one tap from Next.
		expect(screen.getByText(/RSVP to one date you fix/i)).toBeTruthy();
		expect(continueBtn().getAttribute("disabled")).toBeNull();
	});

	it("opens the SAME route a tap on Event does", () => {
		renderWizard({ defaultKind: "booking", initialCard: "event" });
		const linked = screen.getByText(/^Step 1 of \d+$/).textContent;
		cleanup();
		renderWizard({ defaultKind: "booking" });
		fireEvent.click(screen.getByRole("button", { name: /^event/i }));
		expect(screen.getByText(/^Step 1 of \d+$/).textContent).toBe(linked);
		expect(linked).toBe("Step 1 of 7");
	});

	it("a locked plan keeps the store type lit and shows the Pro refusal on arrival", () => {
		renderWizard({
			defaultKind: "booking",
			initialCard: "event",
			eventsLocked: true,
		});
		expect(pressed(/^booking/i)).toBe("true");
		expect(pressed(/^event/i)).toBe("false");
		expect(screen.getByText("Your store type")).toBeTruthy();
		expect(screen.getByRole("alert").textContent).toMatch(
			/Events are part of the Pro plan/,
		);
		// Picking something the plan allows clears the refusal.
		fireEvent.click(screen.getByRole("button", { name: /^food/i }));
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("no link keeps today's opening", () => {
		renderWizard({ defaultKind: "booking" });
		expect(pressed(/^booking/i)).toBe("true");
		expect(pressed(/^event/i)).toBe("false");
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("the free-RSVP hint prices zero in the store's own symbol, never the ISO code", () => {
		// `currency` is the retailer's ISO code; the hint wears the symbol a
		// seller reads everywhere else (`currencySymbol`) — the link sends SG
		// stores here too, and "MYR 0" reads like a form field, not a price.
		renderWizard({ initialCard: "event", currency: "SGD" });
		expect(screen.getByText(/S\$ 0 makes it a free RSVP/)).toBeTruthy();
		cleanup();
		renderWizard({ initialCard: "event", currency: "MYR" });
		expect(screen.getByText(/RM 0 makes it a free RSVP/)).toBeTruthy();
		expect(screen.queryByText(/MYR 0/)).toBeNull();
	});
});
