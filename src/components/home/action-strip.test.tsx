// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionStrip } from "./action-strip";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		className,
	}: {
		children: ReactNode;
		to?: string;
		className?: string;
	}) => (
		<a href={to} className={className}>
			{children}
		</a>
	),
}));

afterEach(cleanup);

// jsdom has no layout, so this pins the flex contract: three tiles share the
// row, and from `sm` a tile narrower than "icon · To collect · RM 7,418.64"
// (~320px) used to squeeze its words to nothing and draw the figure over them.
// The row now WRAPS — the figure takes its own line — and the words claim
// their width (basis auto, not flex-1's 0), which is what makes it wrap.
describe("a narrow tile wraps its figure instead of overlapping the words", () => {
	it("every tile row wraps, its words keep their width, its figure sits right", () => {
		const { container } = render(
			<ActionStrip
				loading={false}
				newCount={13}
				dueTodayCount={1}
				unpaidCount={117}
				unpaidAmount={741864}
				currency="MYR"
			/>,
		);
		const tiles = Array.from(container.querySelectorAll("a"));
		expect(tiles).toHaveLength(3);
		for (const tile of tiles) {
			expect(tile.classList).toContain("sm:flex-wrap");
			const [, words, figure] = Array.from(tile.children);
			expect(words.classList).toContain("sm:flex-[1_1_auto]");
			expect(words.classList).not.toContain("sm:flex-1");
			expect(figure.classList).toContain("sm:ml-auto");
		}
	});
});
