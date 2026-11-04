// @vitest-environment jsdom
// One labelled trigger + one radio list: the toolbar control for "pick one of
// these" (a status filter, a sort). Status and Sort on Admin · Sellers are the
// same component, so the two can't drift into two looks.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OptionMenu, type OptionMenuSingleProps } from "./option-menu";

afterEach(cleanup);

vi.stubGlobal(
	"ResizeObserver",
	class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
);

type Status = "all" | "past_due" | "trialing" | "none";

const GROUPS = [
	{ options: [{ value: "all" as Status, label: "All sellers", count: 412 }] },
	{
		heading: "Needs your action",
		options: [
			{
				value: "past_due" as Status,
				label: "Past due",
				count: 3,
				countTone: "attention" as const,
			},
		],
	},
	{
		heading: "By subscription",
		options: [
			{ value: "trialing" as Status, label: "Trialing", count: 38 },
			{ value: "none" as Status, label: "No subscription", count: 0 },
		],
	},
];

function renderMenu(props: Partial<OptionMenuSingleProps<Status>> = {}) {
	const onChange = props.onChange ?? vi.fn();
	render(
		<OptionMenu<Status>
			label="Status"
			value="all"
			defaultValue="all"
			groups={GROUPS}
			onChange={onChange}
			countNoun="seller"
			{...props}
		/>,
	);
	return { onChange };
}

describe("OptionMenu", () => {
	it("names the label and the current value on the closed trigger", () => {
		renderMenu();
		expect(
			screen.getByRole("button", { name: "Status: All sellers" }),
		).toBeTruthy();
	});

	it("opens a radio list with group headings, counts and a selected row", () => {
		renderMenu();
		fireEvent.click(
			screen.getByRole("button", { name: "Status: All sellers" }),
		);
		expect(screen.getByText("Needs your action")).toBeTruthy();
		expect(screen.getByText("By subscription")).toBeTruthy();
		const all = screen.getByRole("button", {
			name: "All sellers, 412 sellers",
		});
		expect(all.getAttribute("aria-pressed")).toBe("true");
		expect(
			screen.getByRole("button", { name: "Past due, 3 sellers" }),
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "No subscription, 0 sellers" }),
		).toBeTruthy();
	});

	it("picking an option reports it and closes the list", () => {
		const { onChange } = renderMenu();
		fireEvent.click(
			screen.getByRole("button", { name: "Status: All sellers" }),
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Past due, 3 sellers" }),
		);
		expect(onChange).toHaveBeenCalledWith("past_due");
		expect(screen.queryByText("Needs your action")).toBeNull();
	});

	it("a non-default value shows a count pill on the trigger and a Clear in the panel", () => {
		const { onChange } = renderMenu({ value: "past_due" });
		const trigger = screen.getByRole("button", {
			name: "Status: Past due, 3 sellers",
		});
		expect(trigger.textContent).toContain("3");
		fireEvent.click(trigger);
		fireEvent.click(screen.getByRole("button", { name: "Clear" }));
		expect(onChange).toHaveBeenCalledWith("all");
	});

	it("without counts (a sort) the trigger and rows carry none", () => {
		renderMenu({
			label: "Sort",
			value: "founding" as unknown as Status,
			defaultValue: "founding" as unknown as Status,
			groups: [
				{
					options: [
						{ value: "founding" as unknown as Status, label: "Founding rank" },
						{ value: "name" as unknown as Status, label: "Name A–Z" },
					],
				},
			],
		});
		fireEvent.click(
			screen.getByRole("button", { name: "Sort: Founding rank" }),
		);
		expect(screen.getByRole("button", { name: "Name A–Z" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
	});

	// z8r3fdzn6r: a status filter is an OR over several picks, so the same
	// control has a multi mode — checkbox rows, a panel that stays open while
	// you tick, and an "All" row that reads mixed while some are on.
	describe("multi mode", () => {
		function renderMulti(values: Status[], onToggle = vi.fn()) {
			render(
				<OptionMenu<Status>
					label="Status"
					mode="multi"
					values={values}
					emptyValue="all"
					summary={(v) => v.map((s) => s.replace("_", " ")).join(" or ")}
					groups={GROUPS}
					onToggle={onToggle}
					countNoun="seller"
				/>,
			);
			return { onToggle };
		}

		it("with nothing picked the trigger reads the empty option and the All row is ticked", () => {
			renderMulti([]);
			fireEvent.click(
				screen.getByRole("button", { name: "Status: All sellers" }),
			);
			expect(
				screen
					.getByRole("button", { name: "All sellers, 412 sellers" })
					.getAttribute("aria-pressed"),
			).toBe("true");
			expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
		});

		it("one pick carries its count on the trigger; two read as the caller's phrase, and the All row is mixed", () => {
			const { rerender } = render(
				<OptionMenu<Status>
					label="Status"
					mode="multi"
					values={["past_due"]}
					emptyValue="all"
					summary={(v) => v.join(" or ")}
					groups={GROUPS}
					onToggle={vi.fn()}
					countNoun="seller"
				/>,
			);
			expect(
				screen.getByRole("button", { name: "Status: Past due, 3 sellers" }),
			).toBeTruthy();
			rerender(
				<OptionMenu<Status>
					label="Status"
					mode="multi"
					values={["past_due", "trialing"]}
					emptyValue="all"
					summary={(v) => v.join(" or ")}
					groups={GROUPS}
					onToggle={vi.fn()}
					countNoun="seller"
				/>,
			);
			const trigger = screen.getByRole("button", {
				name: "Status: past_due or trialing",
			});
			fireEvent.click(trigger);
			const all = screen.getByRole("button", {
				name: "All sellers, 412 sellers",
			});
			expect(all.getAttribute("aria-pressed")).toBe("mixed");
			for (const name of ["Past due, 3 sellers", "Trialing, 38 sellers"]) {
				expect(
					screen.getByRole("button", { name }).getAttribute("aria-pressed"),
				).toBe("true");
			}
		});

		it("ticking a row reports it and keeps the panel open; Clear reports the empty value", () => {
			const { onToggle } = renderMulti(["past_due"]);
			fireEvent.click(
				screen.getByRole("button", { name: "Status: Past due, 3 sellers" }),
			);
			fireEvent.click(
				screen.getByRole("button", { name: "Trialing, 38 sellers" }),
			);
			expect(onToggle).toHaveBeenLastCalledWith("trialing");
			// Still open: a second tick is the point of a multi-select.
			expect(screen.getByText("Needs your action")).toBeTruthy();
			fireEvent.click(screen.getByRole("button", { name: "Clear" }));
			expect(onToggle).toHaveBeenLastCalledWith("all");
		});
	});
});
