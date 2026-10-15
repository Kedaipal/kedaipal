// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ContinueShoppingLink,
	OrderStoreEyebrow,
	requestCardLinksBack,
	storeLinkSlug,
} from "./order-store-links";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		params,
		children,
		...rest
	}: {
		to: string;
		params?: { slug: string };
		children: ReactNode;
	}) => (
		<a href={params ? to.replace("$slug", params.slug) : to} {...rest}>
			{children}
		</a>
	),
}));

afterEach(cleanup);

// The order page's way back into the store (z8r3fducgw). The rules carry no
// order-SOURCE branch on purpose: a storefront, counter and claim order all
// land on the same page and all get the same exits.

describe("storeLinkSlug — where 'back to the store' goes", () => {
	it("is the store's slug for an open or paused store", () => {
		expect(
			storeLinkSlug({ retailerSlug: "dapur-nadia", storeOffline: false }),
		).toBe("dapur-nadia");
	});

	it("is nowhere when Kedaipal took the store offline — its storefront is only the unavailable page", () => {
		expect(
			storeLinkSlug({ retailerSlug: "dapur-nadia", storeOffline: true }),
		).toBeUndefined();
	});

	it("is nowhere when the store is gone", () => {
		expect(storeLinkSlug({ storeOffline: false })).toBeUndefined();
	});
});

describe("requestCardLinksBack — never two links back", () => {
	it("is true for a declined or expired request, whose card links back itself", () => {
		expect(requestCardLinksBack({ bookingResolution: "declined" })).toBe(true);
		expect(requestCardLinksBack({ bookingResolution: "expired" })).toBe(true);
	});

	it("is false for an ordinary order", () => {
		expect(requestCardLinksBack({})).toBe(false);
	});
});

describe("OrderStoreEyebrow", () => {
	it("links the store name back to the storefront, same tab", () => {
		render(<OrderStoreEyebrow storeName="Yap" slug="yap" ms={false} />);
		const link = screen.getByRole("link", { name: "Go to Yap" });
		expect(link.getAttribute("href")).toBe("/yap");
		expect(link.getAttribute("target")).toBeNull();
		expect(link.textContent).toBe("Yap");
	});

	it("names the store in Malay for a Malay store", () => {
		render(<OrderStoreEyebrow storeName="Yap" slug="yap" ms />);
		expect(screen.getByRole("link", { name: "Ke kedai Yap" })).toBeTruthy();
	});

	it("is plain text when there is nowhere to go", () => {
		render(<OrderStoreEyebrow storeName="Yap" slug={undefined} ms={false} />);
		expect(screen.queryByRole("link")).toBeNull();
		expect(screen.getByText("Yap")).toBeTruthy();
	});

	it("falls back to 'Your order' with no store name, and never links it", () => {
		render(<OrderStoreEyebrow storeName="" slug="yap" ms={false} />);
		expect(screen.queryByRole("link")).toBeNull();
		expect(screen.getByText("Your order")).toBeTruthy();
	});
});

describe("ContinueShoppingLink", () => {
	it("says where it goes, and goes there in the same tab", () => {
		render(<ContinueShoppingLink storeName="Yap" slug="yap" ms={false} />);
		const link = screen.getByRole("link", {
			name: "Continue shopping at Yap",
		});
		expect(link.getAttribute("href")).toBe("/yap");
		expect(link.getAttribute("target")).toBeNull();
	});

	it("wraps a long store name instead of cutting it off", () => {
		render(
			<ContinueShoppingLink
				storeName="Lekor Mr Ganu Kuala Terengganu"
				slug="lekor"
				ms={false}
			/>,
		);
		const label = screen.getByText(
			"Continue shopping at Lekor Mr Ganu Kuala Terengganu",
		);
		expect(label.className).not.toMatch(/\btruncate\b/);
		expect(label.className).toMatch(/\bbreak-words\b/);
	});

	it("reads in Malay for a Malay store", () => {
		render(<ContinueShoppingLink storeName="Yap" slug="yap" ms />);
		expect(
			screen.getByRole("link", { name: "Teruskan membeli di Yap" }),
		).toBeTruthy();
	});
});
