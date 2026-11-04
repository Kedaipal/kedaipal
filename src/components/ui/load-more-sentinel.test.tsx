// @vitest-environment jsdom
// The one "end of a paginated list" primitive: loads the next page when its
// zone scrolls near, keeps a real button for keyboard and reduced-motion
// users, and says plainly when the list has run out.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ inView: false }));
vi.mock("react-intersection-observer", () => ({
	useInView: () => ({ ref: () => {}, inView: io.inView }),
}));

import { LoadMoreSentinel } from "./load-more-sentinel";

afterEach(() => {
	cleanup();
	io.inView = false;
});

const base = {
	onLoadMore: vi.fn(),
	loadingSlot: <div data-testid="skeletons">…</div>,
	exhaustedLabel: "That’s every seller",
	loadMoreLabel: "Load more",
	loadMoreHint: "Scroll or press to load the next 25",
};

describe("LoadMoreSentinel", () => {
	it("asks for the next page once the zone is in view and more can load", () => {
		io.inView = true;
		const onLoadMore = vi.fn();
		render(
			<LoadMoreSentinel
				{...base}
				status="CanLoadMore"
				onLoadMore={onLoadMore}
			/>,
		);
		expect(onLoadMore).toHaveBeenCalledTimes(1);
	});

	it("keeps a real Load more button when the zone is not in view", () => {
		const onLoadMore = vi.fn();
		render(
			<LoadMoreSentinel
				{...base}
				status="CanLoadMore"
				onLoadMore={onLoadMore}
			/>,
		);
		expect(onLoadMore).not.toHaveBeenCalled();
		const button = screen.getByRole("button", { name: "Load more" });
		expect(button.className).toMatch(/tap-target/);
		fireEvent.click(button);
		expect(onLoadMore).toHaveBeenCalledTimes(1);
		expect(
			screen.getByText("Scroll or press to load the next 25"),
		).toBeTruthy();
	});

	it("shows the loading slot, marked busy, and no button while a page loads", () => {
		io.inView = true;
		const onLoadMore = vi.fn();
		render(
			<LoadMoreSentinel
				{...base}
				status="LoadingMore"
				onLoadMore={onLoadMore}
			/>,
		);
		expect(screen.getByTestId("skeletons")).toBeTruthy();
		expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
		expect(screen.queryByRole("button")).toBeNull();
		expect(onLoadMore).not.toHaveBeenCalled();
	});

	it("names the end of the list once exhausted", () => {
		render(<LoadMoreSentinel {...base} status="Exhausted" />);
		expect(screen.getByText("That’s every seller")).toBeTruthy();
		expect(screen.queryByRole("button")).toBeNull();
	});

	it("renders nothing before the first page", () => {
		const { container } = render(
			<LoadMoreSentinel {...base} status="LoadingFirstPage" />,
		);
		expect(container.textContent).toBe("");
	});
});
