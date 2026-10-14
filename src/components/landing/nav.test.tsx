// @vitest-environment jsdom
// The landing bar's two doors OUT of the seller pitch (z8r3fdkmyp): the store
// directory and the blog. They shipped in the menu and the footer only; this
// pins them into the DESKTOP bar as well, and pins the two-tier split that
// makes room for them — the three ROUTES from `lg`, the scroll anchors from
// `xl`, because six labels plus the action cluster measurably overflow a
// 1024px bar in Bahasa.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BLOG_URL } from "../../lib/site-links";
import { m } from "../../paraglide/messages";
import { Nav } from "./nav";

vi.mock("@clerk/tanstack-react-start", () => ({
	useAuth: () => ({ isSignedIn: false }),
}));
vi.mock("../../hooks/useSupportWaNumber", () => ({
	useSupportWaNumber: () => "60123456789",
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		className,
		onClick,
		...rest
	}: {
		children: ReactNode;
		to: string;
		className?: string;
		onClick?: () => void;
	}) => (
		<a href={to} className={className} onClick={onClick} {...rest}>
			{children}
		</a>
	),
}));

afterEach(cleanup);

/** Every link in the bar pointing at `href`, menu rows included. */
function linksTo(href: string): HTMLAnchorElement[] {
	return screen
		.getAllByRole("link")
		.filter((el): el is HTMLAnchorElement => el.getAttribute("href") === href);
}

describe("landing nav", () => {
	it("puts Stores and Blog in the desktop bar, not just the menu", () => {
		render(<Nav />);

		const stores = linksTo("/stores");
		const blog = linksTo(BLOG_URL);
		expect(stores).toHaveLength(1);
		expect(blog).toHaveLength(1);
		expect(stores[0].textContent?.trim()).toBe(m.nav_stores());
		expect(blog[0].textContent?.trim()).toBe(m.nav_blog());
	});

	it("keeps both in the menu too, so no width drops them", () => {
		render(<Nav />);
		fireEvent.click(screen.getByLabelText(m.nav_menu_open()));

		// One in the bar, one in the open menu.
		expect(linksTo("/stores")).toHaveLength(2);
		expect(linksTo(BLOG_URL)).toHaveLength(2);
	});

	it("orders the bar as pitch anchors, then the three routes", () => {
		render(<Nav />);

		const row = linksTo("/stores")[0].parentElement;
		const labels = Array.from(row?.querySelectorAll("a") ?? []).map((a) =>
			a.textContent?.trim(),
		);
		expect(labels).toEqual([
			m.nav_delivery(),
			m.nav_payments(),
			m.nav_faq(),
			m.nav_pricing(),
			m.nav_stores(),
			m.nav_blog(),
		]);
	});

	it("gates the routes at lg and the scroll anchors at xl", () => {
		render(<Nav />);

		const row = linksTo("/stores")[0].parentElement;
		expect(row?.className).toContain("lg:flex");
		expect(row?.className).not.toContain("xl:flex");

		// The anchors are only scroll shortcuts, so they are the tier that waits
		// for the wider bar.
		const anchorGroup = screen
			.getAllByRole("link")
			.find((el) => el.getAttribute("href") === "/#delivery")?.parentElement;
		expect(anchorGroup?.className).toContain("xl:flex");
	});
});
