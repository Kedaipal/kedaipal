// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StorefrontAppBar } from "./storefront-app-bar";

// The bar's links are plain hrefs — stub the router Link as an anchor, same
// as category-rail.test.tsx.
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		params,
		children,
		...rest
	}: {
		to: string;
		params?: Record<string, string>;
		children: ReactNode;
	} & ComponentProps<"a">) => (
		<a
			href={Object.entries(params ?? {}).reduce(
				(path, [key, value]) => path.replace(`$${key}`, value),
				to,
			)}
			{...rest}
		>
			{children}
		</a>
	),
}));

afterEach(cleanup);

const retailer = {
	storeName: "Dapur Nadia",
	storeDescription: "Kuih & pastry pre-order",
};

describe("StorefrontAppBar (z8r3fdegb5)", () => {
	it("owns 'back' — a 44px link to the store home", () => {
		render(<StorefrontAppBar retailer={retailer} slug="dapur-nadia" />);
		const back = screen.getByRole("link", { name: "Back to Dapur Nadia" });
		expect(back.getAttribute("href")).toBe("/dapur-nadia");
		expect(back.className).toContain("tap-target");
	});

	it("points back at the LISTING on pages that sit under a product", () => {
		render(
			<StorefrontAppBar
				retailer={retailer}
				slug="dapur-nadia"
				backToProductSlug="kek-batik"
			/>,
		);
		expect(
			screen
				.getByRole("link", { name: "Back to the listing" })
				.getAttribute("href"),
		).toBe("/dapur-nadia/p/kek-batik");
		// Exactly one back control per screen.
		expect(screen.getAllByRole("link")).toHaveLength(1);
	});

	it("names the store as plain text — the subpage owns its own <h1>", () => {
		render(<StorefrontAppBar retailer={retailer} slug="dapur-nadia" />);
		expect(screen.getByText("Dapur Nadia")).toBeTruthy();
		expect(screen.queryByRole("heading")).toBeNull();
	});

	it("falls back to an initials tile when the store has no logo", () => {
		render(<StorefrontAppBar retailer={retailer} slug="dapur-nadia" />);
		expect(screen.getByText("DN")).toBeTruthy();
	});

	it("shows the founding badge at app-bar size", () => {
		render(
			<StorefrontAppBar
				retailer={{
					...retailer,
					isFoundingMember: true,
					foundingMemberRank: 7,
				}}
				slug="dapur-nadia"
			/>,
		);
		expect(
			screen.getByRole("button", { name: "Founding Member #7 — what's this?" }),
		).toBeTruthy();
		const emblem = document.querySelector(
			"img[src='/img/badges/founding-badge-navy.png']",
		);
		expect(emblem?.className).toContain("h-[18px]");
	});

	it("keeps the live hours line — one truncating row, same schedule dialog", () => {
		const allDayWeek = Array.from({ length: 7 }, () => ({
			open: 0,
			close: 1439,
		}));
		render(
			<StorefrontAppBar
				retailer={{ ...retailer, openingHours: allDayWeek }}
				slug="dapur-nadia"
			/>,
		);
		const trigger = screen.getByRole("button", {
			name: /Open 24 hours today/,
		});
		expect(trigger.querySelector(".truncate")).toBeTruthy();
	});

	it("stays clutter-free for a 24/7 store with no closures", () => {
		render(<StorefrontAppBar retailer={retailer} slug="dapur-nadia" />);
		expect(screen.queryByText(/Open 24 hours|Closed ·|Open now/)).toBeNull();
	});

	it("carries a 44px share control", () => {
		render(<StorefrontAppBar retailer={retailer} slug="dapur-nadia" />);
		const share = screen.getByRole("button", { name: "Share this page" });
		expect(share.className).toContain("tap-target");
	});
});
