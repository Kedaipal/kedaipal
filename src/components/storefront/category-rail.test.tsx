// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { CategoryRail } from "./category-rail";

// The tiles are plain links over a single categories subscription — stub the
// router Link as an anchor and feed categories through the mocked useQuery.
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

const categories: Array<{
	_id: string;
	slug: string;
	name: string;
	productCount: number;
	imageUrl?: string;
}> = [];
vi.mock("convex/react", () => ({
	useQuery: () => categories,
}));

afterEach(() => {
	cleanup();
	categories.length = 0;
});

const RID = "r1" as unknown as Id<"retailers">;

describe("CategoryRail", () => {
	const cat = (slug: string, name: string, productCount = 3) => ({
		_id: `c-${slug}`,
		slug,
		name,
		productCount,
	});

	it("renders nothing for a zero-category store", () => {
		const { container } = render(
			<CategoryRail retailerId={RID} storeSlug="herb" />,
		);
		expect(container.innerHTML).toBe("");
	});

	it("renders a tile per category, linking to its page, with the product count", () => {
		categories.push(cat("cakes", "Cakes", 6), cat("kuih", "Kuih", 8));
		render(<CategoryRail retailerId={RID} storeSlug="herb" />);
		expect(
			screen.getByRole("link", { name: /Kuih/ }).getAttribute("href"),
		).toBe("/herb/c/kuih");
		expect(
			screen.getByRole("link", { name: /Cakes/ }).getAttribute("href"),
		).toBe("/herb/c/cakes");
		// The count badge is what tells a buyer a category is worth opening.
		expect(screen.getByText("6")).toBeTruthy();
		expect(screen.getByText("8")).toBeTruthy();
	});

	// The rail is store-home-only, so no tile is ever "the page you're on" —
	// it had an active-ring variant while it also rendered inside a category,
	// and that whole surface was cut.
	it("never marks a tile as the current page", () => {
		categories.push(cat("cakes", "Cakes"), cat("kuih", "Kuih"));
		render(<CategoryRail retailerId={RID} storeSlug="herb" />);
		expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(0);
	});

	it("falls back to a deterministic gradient when a category has no image", () => {
		categories.push(cat("cakes", "Cakes"));
		const { container: first } = render(
			<CategoryRail retailerId={RID} storeSlug="herb" />,
		);
		const gradientOf = (root: HTMLElement) =>
			[...root.querySelectorAll("div")]
				.map((d) => d.className)
				.find((c) => c.includes("bg-gradient-to-br"));
		const a = gradientOf(first);
		expect(a).toBeTruthy();
		// Same slug must keep its colour across visits/pages, or the store looks
		// different on every render.
		cleanup();
		const { container: second } = render(
			<CategoryRail retailerId={RID} storeSlug="herb" />,
		);
		expect(gradientOf(second)).toBe(a);
	});

	it("uses the category's own image when it has one", () => {
		categories.push({ ...cat("cakes", "Cakes"), imageUrl: "https://x/y.jpg" });
		const { container } = render(
			<CategoryRail retailerId={RID} storeSlug="herb" />,
		);
		// Queried by tag, not role: the tile art is decorative (`alt=""`, which
		// drops the img role) because the category name is already text beside
		// it — a screen reader shouldn't hear the name twice.
		const img = container.querySelector("img");
		expect(img?.getAttribute("src")).toBe("https://x/y.jpg");
		expect(img?.getAttribute("alt")).toBe("");
	});
});
