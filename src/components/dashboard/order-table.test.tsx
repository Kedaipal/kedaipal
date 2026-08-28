// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ORDER_COLUMNS_BY_KEY,
	type OrderColumnKey,
} from "../../../convex/lib/orderCsv";
import { OrderTable, type TableOrder } from "./order-table";

// The table renders <Link>, which needs a router. A stub keeps this a unit test
// of the table rather than of TanStack Router.
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		className,
		style,
	}: {
		children: React.ReactNode;
		className?: string;
		style?: React.CSSProperties;
	}) => (
		<a href="/stub" className={className} style={style}>
			{children}
		</a>
	),
}));

afterEach(cleanup);

const base: TableOrder = {
	_id: "o1",
	shortId: "ORD-1001",
	createdAt: Date.UTC(2026, 5, 29, 16, 0, 0),
	status: "confirmed",
	customer: { name: "Aisha", waPhone: "+60123456789" },
	items: [{ name: "Kek Lapis", variantLabel: "1kg", quantity: 2 }],
	subtotal: 12500,
	total: 12500,
	currency: "MYR",
};

function cols(...keys: OrderColumnKey[]) {
	return keys.map((k) => {
		const c = ORDER_COLUMNS_BY_KEY.get(k);
		if (!c) throw new Error(`no column ${k}`);
		return c;
	});
}

function renderTable(overrides: Partial<Parameters<typeof OrderTable>[0]> = {}) {
	const props = {
		orders: [base],
		columns: cols("shortId", "customer", "total"),
		statusLabelFor: () => "Confirmed",
		selectMode: false,
		selected: new Set<string>(),
		onToggleSelect: vi.fn(),
		onTogglePin: vi.fn(),
		...overrides,
	};
	render(<OrderTable {...props} />);
	return props;
}

describe("OrderTable", () => {
	it("renders exactly the columns it is given, with registry labels", () => {
		renderTable();
		expect(screen.getByText("Order ID")).toBeTruthy();
		expect(screen.getByText("Customer")).toBeTruthy();
		expect(screen.getByText("Total")).toBeTruthy();
		// Not asked for → not rendered. This is what makes the picker meaningful.
		expect(screen.queryByText("Phone")).toBeNull();
	});

	it("renders values through the registry's own accessors", () => {
		renderTable({ columns: cols("shortId", "total", "fulfilmentDate") });
		expect(screen.getByText("ORD-1001")).toBeTruthy();
		expect(screen.getByText("125.00")).toBeTruthy();
	});

	it("a column added to the registry needs no change here", () => {
		// The address columns were the reported gap; they render purely from the
		// registry, with no per-column code in this component.
		renderTable({
			orders: [
				{
					...base,
					deliveryAddress: {
						line1: "12 Jalan Kenari",
						city: "Puchong",
						state: "Selangor",
						postcode: "47100",
					},
				},
			],
			columns: cols("addressLine1", "city", "postcode"),
		});
		expect(screen.getByText("12 Jalan Kenari")).toBeTruthy();
		expect(screen.getByText("Puchong")).toBeTruthy();
		expect(screen.getByText("47100")).toBeTruthy();
	});

	it("shows an em-dash for an empty cell, not a blank that reads as a bug", () => {
		renderTable({ columns: cols("courierName") });
		expect(screen.getByText("—")).toBeTruthy();
	});

	it("renders the status as a badge, not raw text", () => {
		renderTable({
			columns: cols("status"),
			statusLabelFor: () => "Being packed",
		});
		// The retailer's custom stage label wins over the raw status.
		expect(screen.getByText("Being packed")).toBeTruthy();
		expect(screen.queryByText("confirmed")).toBeNull();
	});

	it("pins from the row, passing the order back", () => {
		const { onTogglePin } = renderTable();
		fireEvent.click(screen.getByRole("button", { name: /pin order ORD-1001/i }));
		expect(onTogglePin).toHaveBeenCalledWith(base);
	});

	it("a pinned row offers Unpin and shows the control as pressed", () => {
		renderTable({ orders: [{ ...base, pinnedAt: 123 }] });
		const btn = screen.getByRole("button", { name: /unpin order ORD-1001/i });
		expect(btn.getAttribute("aria-pressed")).toBe("true");
	});

	it("the pin control is always rendered, never hover-only", () => {
		// A control you must hover to discover is one sellers never find.
		renderTable();
		expect(
			screen.getByRole("button", { name: /pin order ORD-1001/i }),
		).toBeTruthy();
	});

	it("disables just the row being written to", () => {
		renderTable({
			orders: [base, { ...base, _id: "o2", shortId: "ORD-1002" }],
			pinBusyId: "o1",
		});
		expect(
			screen
				.getByRole("button", { name: /pin order ORD-1001/i })
				.hasAttribute("disabled"),
		).toBe(true);
		expect(
			screen
				.getByRole("button", { name: /pin order ORD-1002/i })
				.hasAttribute("disabled"),
		).toBe(false);
	});

	it("in select mode the row selects instead of navigating", () => {
		// A stray click while ticking twenty rows must not throw the seller out of
		// the selection they were building.
		const { onToggleSelect } = renderTable({ selectMode: true });
		expect(screen.queryByRole("link")).toBeNull();
		fireEvent.click(
			screen.getAllByRole("button", { name: /select order ORD-1001/i })[0],
		);
		expect(onToggleSelect).toHaveBeenCalledWith("o1");
	});

	it("out of select mode the row is a link to the order", () => {
		renderTable();
		expect(screen.getByRole("link")).toBeTruthy();
		expect(screen.queryByRole("button", { name: /select order/i })).toBeNull();
	});

	it("renders nothing extra for an empty list", () => {
		renderTable({ orders: [] });
		expect(screen.getByText("Order ID")).toBeTruthy();
		expect(screen.queryByRole("link")).toBeNull();
	});
});
