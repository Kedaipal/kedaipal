// @vitest-environment jsdom
// One labelled trigger + one radio list: the toolbar control for "pick one of
// these" (a status filter, a sort). Status and Sort on Admin · Sellers are the
// same component, so the two can't drift into two looks.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OptionMenu } from "./option-menu";

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

function renderMenu(
	props: Partial<Parameters<typeof OptionMenu<Status>>[0]> = {},
) {
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
});
