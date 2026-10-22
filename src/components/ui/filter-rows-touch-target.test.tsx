// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BulkSelectRow } from "./bulk-select-row";
import { FilterOptionRow } from "./filter-option-row";

afterEach(cleanup);

/**
 * The tickable rows every filter / column panel is built from. They are
 * tapped on phones, so below `lg` they meet the house 44px touch target; on
 * desktop they stay a compact 36px. jsdom has no layout, so this pins the
 * class contract — the 36px-everywhere rows were found in the PR #402 review.
 */
describe("filter panel rows meet the touch target on phones", () => {
	it("FilterOptionRow: 44px below lg, 36px from lg", () => {
		render(
			<FilterOptionRow label="Delivered" selected={false} onToggle={vi.fn()} />,
		);
		const cls = screen.getByRole("button", { name: "Delivered" }).className;
		expect(cls).toMatch(/(^|\s)min-h-11(\s|$)/);
		expect(cls).toMatch(/(^|\s)lg:min-h-9(\s|$)/);
	});

	it("BulkSelectRow: the same pair, so a group row and its children line up", () => {
		const { container } = render(
			<BulkSelectRow
				label="Booking"
				selected={0}
				total={4}
				onToggle={vi.fn()}
			/>,
		);
		const cls = container.querySelector("label")?.className ?? "";
		expect(cls).toMatch(/(^|\s)min-h-11(\s|$)/);
		expect(cls).toMatch(/(^|\s)lg:min-h-9(\s|$)/);
	});

	it("BulkSelectRow size=touch stays 44px on desktop too", () => {
		const { container } = render(
			<BulkSelectRow
				label="All products"
				selected={0}
				total={4}
				onToggle={vi.fn()}
				size="touch"
			/>,
		);
		const cls = container.querySelector("label")?.className ?? "";
		expect(cls).toMatch(/(^|\s)lg:min-h-11(\s|$)/);
		expect(cls).not.toMatch(/(^|\s)lg:min-h-9(\s|$)/);
	});
});
