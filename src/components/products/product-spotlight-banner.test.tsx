// @vitest-environment jsdom
/**
 * The first hop of a product-page spotlight. Pins the two states (an
 * eligible listing exists / none does), that the cap hides the create
 * button, that "Got it" hands control back, and that the banner wears the
 * same mint ring the destination card will — never a warning colour.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		children,
		...rest
	}: {
		to: string;
		children: React.ReactNode;
	}) => (
		<a href={to} {...rest}>
			{children}
		</a>
	),
}));

import { PRODUCT_SPOTLIGHT } from "../../lib/product-spotlight";
import { ProductSpotlightBanner } from "./product-spotlight-banner";

afterEach(cleanup);

describe("ProductSpotlightBanner", () => {
	it("with an eligible listing: says to open one below, no create button", () => {
		render(
			<ProductSpotlightBanner
				spot="weekend_rate"
				eligibleCount={2}
				canCreate
				onDismiss={vi.fn()}
			/>,
		);
		expect(screen.getByText(PRODUCT_SPOTLIGHT.weekend_rate.title)).toBeTruthy();
		expect(screen.getByText(PRODUCT_SPOTLIGHT.weekend_rate.body)).toBeTruthy();
		expect(screen.queryByRole("link", { name: /new product/i })).toBeNull();
	});

	it("with no eligible listing: says so and offers + New product", () => {
		render(
			<ProductSpotlightBanner
				spot="weekend_rate"
				eligibleCount={0}
				canCreate
				onDismiss={vi.fn()}
			/>,
		);
		expect(screen.getByText(PRODUCT_SPOTLIGHT.weekend_rate.empty)).toBeTruthy();
		expect(
			screen.getByRole("link", { name: /new product/i }).getAttribute("href"),
		).toBe("/app/products/new");
	});

	it("at the product cap the create button is withheld (the cap banner explains)", () => {
		render(
			<ProductSpotlightBanner
				spot="weekend_rate"
				eligibleCount={0}
				canCreate={false}
				onDismiss={vi.fn()}
			/>,
		);
		expect(screen.queryByRole("link", { name: /new product/i })).toBeNull();
	});

	it("Got it hands control back to the page", () => {
		const onDismiss = vi.fn();
		render(
			<ProductSpotlightBanner
				spot="weekend_rate"
				eligibleCount={1}
				canCreate
				onDismiss={onDismiss}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: /got it/i }));
		expect(onDismiss).toHaveBeenCalledTimes(1);
	});

	it("wears the spotlight ring — a real border, the brand mint, never a warning", () => {
		render(
			<ProductSpotlightBanner
				spot="weekend_rate"
				eligibleCount={1}
				canCreate
				onDismiss={vi.fn()}
			/>,
		);
		const cls = screen.getByRole("region").className;
		// `highlightRingClass` sets the border COLOUR only; a box with no
		// `border` width would show the ring and no edge.
		expect(cls.split(" ")).toContain("border");
		expect(cls).toMatch(/ring-accent/);
		expect(cls).toMatch(/animate-kp-spotlight/);
		expect(cls).not.toMatch(/destructive|amber/);
	});
});
