// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MobileHeader } from "./mobile-header";

/**
 * The phone header (z8r3fdx34j): the credits ticket rides beside the plan
 * pill, so the balance is on every page; the avatar is just the person.
 */

const profile = vi.hoisted(() => ({
	stub: null as null | { ticket: { short: string } | null },
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: ReactNode }) => (
		<a href="/app">{children}</a>
	),
}));
vi.mock("./profile-menu", () => ({
	useCreditStub: () => profile.stub,
	ProfileMenu: ({ trigger }: { trigger: ReactNode }) => trigger,
	ProfileAvatar: () => <span data-slot="avatar" />,
}));
vi.mock("./credit-ticket", () => ({
	CreditTicket: ({
		stub,
		variant,
	}: {
		stub: { ticket: { short: string } | null };
		variant: string;
	}) =>
		stub.ticket ? (
			<a href="/billing" data-ticket={variant}>
				{stub.ticket.short}
			</a>
		) : null,
}));
vi.mock("./tier-pill", () => ({
	TierPill: () => <span data-slot="tier-pill">Pro</span>,
}));
vi.mock("../ui/app-image", () => ({
	AppImage: (props: { alt: string }) => <img alt={props.alt} src="/x.svg" />,
}));
vi.mock("../ui/theme-toggle", () => ({
	ThemeToggle: () => <button type="button">Theme</button>,
}));

beforeAll(() => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		},
	);
});
afterEach(() => {
	cleanup();
	profile.stub = null;
});

const STORE = { storeName: "Kuih Lab", slug: "kuih-lab" } as never;

describe("MobileHeader — the credits ticket", () => {
	it("sits beside the plan pill, in the same row", () => {
		profile.stub = { ticket: { short: "254 left" } };
		const { container } = render(<MobileHeader retailer={STORE} />);
		const ticket = container.querySelector('[data-ticket="phone"]');
		expect(ticket?.textContent).toBe("254 left");
		expect(
			ticket?.parentElement?.querySelector('[data-slot="tier-pill"]'),
		).not.toBeNull();
		expect(
			screen.getByTestId("profile-trigger").getAttribute("aria-label"),
		).toBe("Account menu");
	});

	it("is absent for a reader without the credits grant and for an unmetered store", () => {
		const first = render(<MobileHeader retailer={STORE} />);
		expect(first.container.querySelector("[data-ticket]")).toBeNull();
		first.unmount();
		profile.stub = { ticket: null };
		const { container } = render(<MobileHeader retailer={STORE} />);
		expect(container.querySelector("[data-ticket]")).toBeNull();
	});
});
