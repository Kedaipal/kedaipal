// @vitest-environment jsdom
/**
 * Render cover for the step-0 deep link (`z8r3fdhkr7`): `/app/products/new?card=event`
 * is where the v2026.09.7 "Host an event" note sends a seller. The pure tests
 * pin the state; these pin what the seller actually SEES on arrival — which
 * card is lit, whether the store-type badge still claims the page, the Event
 * route's step count, the refusal a locked plan gets (under the card it
 * refuses, with a way to upgrade), the scroll that brings the answer out from
 * under a phone's sticky Continue, and a link that changes while the wizard
 * is already open.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
// The locked refusal carries the house Upgrade link (ProFeatureTease).
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		search,
		children,
		...rest
	}: {
		to: string;
		search?: Record<string, string>;
		children: React.ReactNode;
	}) => (
		<a
			href={search ? `${to}?${new URLSearchParams(search)}` : to}
			{...rest}
		>
			{children}
		</a>
	),
}));

import type { ProductKind } from "../../../convex/lib/productKind";
import type { KindCard } from "../../lib/kind-card";
import { ProductWizard } from "./product-wizard";

// jsdom has no layout, so no scrollIntoView — a spy stands in for the scroll
// and records WHICH element was brought into view.
const scrolled = vi.fn();
beforeEach(() => {
	scrolled.mockReset();
	Element.prototype.scrollIntoView = function (this: Element, arg) {
		scrolled(this, arg);
	};
});
afterEach(cleanup);

type Opts = {
	defaultKind?: ProductKind;
	linkedCard?: KindCard;
	eventsLocked?: boolean;
	currency?: string;
};

function wizard({
	defaultKind,
	linkedCard,
	eventsLocked = false,
	currency = "MYR",
}: Opts) {
	return (
		<ProductWizard
			retailerId={"r1" as never}
			categoriesLocked={false}
			eventsLocked={eventsLocked}
			currency={currency}
			defaultKind={defaultKind}
			linkedCard={linkedCard}
			onSubmit={vi.fn() as never}
			onSkipToFullForm={vi.fn()}
			onOpenFullForm={vi.fn()}
			onExit={vi.fn()}
		/>
	);
}

function renderWizard(opts: Opts = {}) {
	const r = render(wizard(opts));
	return {
		...r,
		/** The route re-renders with a new `?card=` — no remount. */
		relink: (linkedCard: KindCard | undefined) =>
			r.rerender(wizard({ ...opts, linkedCard })),
	};
}

const cardButton = (name: RegExp) => screen.getByRole("button", { name });
const pressed = (name: RegExp) => cardButton(name).getAttribute("aria-pressed");
const continueBtn = () => screen.getByRole("button", { name: /continue/i });
const scrolledTo = () => scrolled.mock.calls.map(([el]) => el as Element);

describe("wizard — `?card=` deep link (`z8r3fdhkr7`)", () => {
	it("lands on Event, not the store's own type — and the badge stops claiming the page", () => {
		renderWizard({ defaultKind: "booking", linkedCard: "event" });
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
		renderWizard({ defaultKind: "booking", linkedCard: "event" });
		const linked = screen.getByText(/^Step 1 of \d+$/).textContent;
		cleanup();
		renderWizard({ defaultKind: "booking" });
		fireEvent.click(cardButton(/^event/i));
		expect(screen.getByText(/^Step 1 of \d+$/).textContent).toBe(linked);
		expect(linked).toBe("Step 1 of 7");
	});

	it("scrolls the event hint into view once — on a phone the fifth card sits under the sticky Continue", () => {
		renderWizard({ defaultKind: "booking", linkedCard: "event" });
		// Exactly once, and onto the hint that sits directly under the Event
		// card — so the lit card AND what it means are both on screen.
		expect(scrolled).toHaveBeenCalledTimes(1);
		expect(scrolledTo()[0].textContent).toMatch(/RSVP to one date you fix/);
		// `nearest` + a phone-only scroll margin: scrolls only when covered, so
		// a desktop page that already shows it never jumps.
		expect(scrolled.mock.calls[0][1]).toEqual({ block: "nearest" });
		expect(scrolledTo()[0].className).toMatch(/scroll-mb-\d+/);
		expect(scrolledTo()[0].className).toMatch(/lg:scroll-mb-0/);
	});

	it("no link keeps today's opening — nothing lit but the store type, no scroll", () => {
		renderWizard({ defaultKind: "booking" });
		expect(pressed(/^booking/i)).toBe("true");
		expect(pressed(/^event/i)).toBe("false");
		expect(screen.queryByRole("alert")).toBeNull();
		expect(scrolled).not.toHaveBeenCalled();
	});

	it("the free-RSVP hint prices zero in the store's own symbol, never the ISO code", () => {
		// `currency` is the retailer's ISO code; the hint wears the symbol a
		// seller reads everywhere else (`currencySymbol`) — the link sends SG
		// stores here too, and "MYR 0" reads like a form field, not a price.
		renderWizard({ linkedCard: "event", currency: "SGD" });
		expect(screen.getByText(/S\$ 0 makes it a free RSVP/)).toBeTruthy();
		cleanup();
		renderWizard({ linkedCard: "event", currency: "MYR" });
		expect(screen.getByText(/RM 0 makes it a free RSVP/)).toBeTruthy();
		expect(screen.queryByText(/MYR 0/)).toBeNull();
	});
});

describe("wizard — a locked plan's Event refusal (`z8r3fdhkr7` review)", () => {
	/** The Event card's own block — the card plus anything rendered under it. */
	const eventBlock = () => cardButton(/^event/i).parentElement as HTMLElement;

	it("arrival: the store type stays lit and the refusal sits UNDER the Event card, with the way to upgrade", () => {
		renderWizard({
			defaultKind: "booking",
			linkedCard: "event",
			eventsLocked: true,
		});
		expect(pressed(/^booking/i)).toBe("true");
		expect(pressed(/^event/i)).toBe("false");
		expect(screen.getByText("Your store type")).toBeTruthy();
		const alert = screen.getByRole("alert");
		expect(alert.textContent).toMatch(/Events are part of the Pro plan/);
		// Under the card it refuses — not below the whole list, where a
		// phone's sticky Continue hid it.
		expect(eventBlock().contains(alert)).toBe(true);
		// A next step, not just a reason: the house Upgrade strip.
		const upgrade = screen.getByRole("link", { name: /upgrade/i });
		expect(upgrade.getAttribute("href")).toBe("/app/settings?tab=billing");
		// And that block is what gets scrolled into view.
		expect(scrolled).toHaveBeenCalledTimes(1);
		expect(scrolledTo()[0]).toBe(eventBlock());
	});

	it("a tap gets the same refusal in the same place; picking an allowed card clears it", () => {
		renderWizard({ defaultKind: "booking", eventsLocked: true });
		expect(screen.queryByRole("alert")).toBeNull();
		fireEvent.click(cardButton(/^event/i));
		expect(eventBlock().contains(screen.getByRole("alert"))).toBe(true);
		fireEvent.click(cardButton(/^food/i));
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("'Pick one to continue' keeps its own slot — only the lock moved", () => {
		renderWizard({ eventsLocked: true });
		fireEvent.click(cardButton(/^event/i));
		// The refusal is the one alert; step 0's structural hint is unchanged.
		expect(screen.getAllByRole("alert")).toHaveLength(1);
		expect(screen.getByText(/Pick one to continue/)).toBeTruthy();
	});
});

describe("wizard — a `?card=` that changes while the wizard is open", () => {
	it("is applied once, as a tap: back to step 0, card lit, brought into view", () => {
		const { relink } = renderWizard({ defaultKind: "physical" });
		// Mid-draft: past step 0.
		fireEvent.click(continueBtn());
		expect(screen.queryByText("What are you selling?")).toBeNull();
		relink("event");
		expect(screen.getByText("What are you selling?")).toBeTruthy();
		expect(pressed(/^event/i)).toBe("true");
		expect(scrolled).toHaveBeenCalledTimes(1);
	});

	it("a re-render with the same link never re-applies it over the seller's own tap", () => {
		const { relink } = renderWizard({
			defaultKind: "physical",
			linkedCard: "event",
		});
		fireEvent.click(cardButton(/^food/i));
		relink("event"); // same value — the route re-rendering, not a new link
		expect(pressed(/^food/i)).toBe("true");
		expect(pressed(/^event/i)).toBe("false");
	});

	it("on a locked plan it refuses with the reason, exactly like the tap", () => {
		const { relink } = renderWizard({
			defaultKind: "booking",
			eventsLocked: true,
		});
		relink("event");
		expect(pressed(/^booking/i)).toBe("true");
		expect(screen.getByRole("alert").textContent).toMatch(/Pro plan/);
	});
});
