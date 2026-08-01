// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { CategoryChips } from "./category-chips";

// The chips are plain links over a single categories subscription — stub the
// router Link as an anchor and feed categories through the mocked useQuery.
//
// `activeOptions` is surfaced as a data attribute rather than dropped: the real
// Link computes its own `aria-current` from prefix matching, so the store-home
// chip needs `{exact: true}` or it reads as the current page on every category
// page too. A plain-anchor stub can't reproduce that, and this test suite
// passed while the bug was live — so the request itself is what we pin.
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		params,
		activeOptions,
		children,
		...rest
	}: {
		to: string;
		params?: Record<string, string>;
		activeOptions?: { exact?: boolean };
		children: ReactNode;
	} & ComponentProps<"a">) => (
		<a
			href={Object.entries(params ?? {}).reduce(
				(path, [key, value]) => path.replace(`$${key}`, value),
				to,
			)}
			data-exact-active={activeOptions?.exact ? "true" : undefined}
			{...rest}
		>
			{children}
		</a>
	),
}));

const categories: Array<{ _id: string; slug: string; name: string }> | null =
	[];
vi.mock("convex/react", () => ({
	useQuery: () => categories,
}));

afterEach(() => {
	cleanup();
	categories.length = 0;
});

const RID = "r1" as unknown as Id<"retailers">;

describe("CategoryChips", () => {
	it("renders nothing for a zero-category store", () => {
		const { container } = render(
			<CategoryChips retailerId={RID} storeSlug="herb" />,
		);
		expect(container.innerHTML).toBe("");
	});

	it("renders an All chip plus a link per category", () => {
		categories.push(
			{ _id: "c1", slug: "cakes", name: "Cakes" },
			{ _id: "c2", slug: "kuih", name: "Kuih" },
		);
		render(<CategoryChips retailerId={RID} storeSlug="herb" />);
		expect(screen.getByRole("link", { name: "All" }).getAttribute("href")).toBe(
			"/herb",
		);
		expect(
			screen.getByRole("link", { name: "Kuih" }).getAttribute("href"),
		).toBe("/herb/c/kuih");
	});

	it("asks the router to match the store-home chip EXACTLY", () => {
		// Without this, TanStack's prefix matching marks /herb active on
		// /herb/c/cakes and stamps its own aria-current="page" — two current
		// pages announced on one screen.
		categories.push({ _id: "c1", slug: "cakes", name: "Cakes" });
		render(
			<CategoryChips
				retailerId={RID}
				storeSlug="herb"
				activeCategorySlug="cakes"
			/>,
		);
		expect(
			screen
				.getByRole("link", { name: "All" })
				.getAttribute("data-exact-active"),
		).toBe("true");
	});

	it("marks All active on the store home, the category on its page", () => {
		categories.push({ _id: "c1", slug: "cakes", name: "Cakes" });
		render(<CategoryChips retailerId={RID} storeSlug="herb" />);
		expect(
			screen.getByRole("link", { name: "All" }).getAttribute("aria-current"),
		).toBe("page");
		cleanup();

		render(
			<CategoryChips
				retailerId={RID}
				storeSlug="herb"
				activeCategorySlug="cakes"
			/>,
		);
		expect(
			screen.getByRole("link", { name: "All" }).getAttribute("aria-current"),
		).toBeNull();
		expect(
			screen.getByRole("link", { name: "Cakes" }).getAttribute("aria-current"),
		).toBe("page");
	});
});
