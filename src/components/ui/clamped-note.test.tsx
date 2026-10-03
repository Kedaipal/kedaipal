// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClampedNote } from "./clamped-note";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

/** jsdom has no layout — fake the clamped box's heights. */
function fakeHeights(scrollHeight: number, clientHeight: number) {
	vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(
		scrollHeight,
	);
	vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(
		clientHeight,
	);
}

describe("ClampedNote", () => {
	it("links a Markdown label inside the note", () => {
		fakeHeights(20, 20);
		render(<ClampedNote text="Park at the [back lot](https://x.co/park)." />);
		const link = screen.getByRole("link", { name: "back lot" });
		expect(link.getAttribute("href")).toBe("https://x.co/park");
		expect(link.getAttribute("rel")).toContain("noopener");
	});

	it("offers no Show more when nothing is cut off", () => {
		fakeHeights(20, 20);
		render(<ClampedNote text="Side counter." />);
		expect(screen.queryByRole("button")).toBeNull();
	});

	it("offers Show more when the clamp hides text, and lifts the clamp", () => {
		fakeHeights(120, 48);
		const { container } = render(
			<ClampedNote text="A long note with https://x.co/far-down at the end." />,
		);
		const toggle = screen.getByRole("button", { name: "Show more" });
		expect(container.querySelector(".line-clamp-3")).not.toBeNull();

		fireEvent.click(toggle);
		expect(screen.getByRole("button", { name: "Show less" })).toBeTruthy();
		expect(container.querySelector(".line-clamp-3")).toBeNull();
	});

	it("expanding inside a label doesn't also pick the option", () => {
		fakeHeights(120, 48);
		const onChange = vi.fn();
		render(
			<label>
				<input type="radio" onChange={onChange} />
				<ClampedNote text="Long note" lines={2} />
			</label>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Show more" }));
		expect(onChange).not.toHaveBeenCalled();
	});
});

describe("ClampedNote — new text", () => {
	it("starts collapsed again when the note changes", () => {
		fakeHeights(120, 48);
		const { rerender } = render(<ClampedNote text="First long note" />);
		fireEvent.click(screen.getByRole("button", { name: "Show more" }));
		expect(screen.getByRole("button", { name: "Show less" })).toBeTruthy();

		rerender(<ClampedNote text="A different long note" />);
		expect(screen.getByRole("button", { name: "Show more" })).toBeTruthy();
	});
});
