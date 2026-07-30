// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { CategoryChips } from "./category-chips";

// The chips are plain links over a single categories subscription — stub the
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
