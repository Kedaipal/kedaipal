// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ORDER_COLUMN_MAX_WIDTH,
	ORDER_COLUMN_MIN_WIDTH,
	ORDER_COLUMNS_BY_KEY,
	type OrderColumnKey,
} from "../../../convex/lib/orderCsv";
import { OrderTable, type TableOrder } from "./order-table";

// The table renders <Link> and navigates on row click, both of which need a
// router. Stubs keep this a unit test of the table rather than of TanStack
// Router; `navigateSpy` lets the row-click tests assert where it went.
const navigateSpy = vi.fn();
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		className,
		onClick,
	}: {
		children: React.ReactNode;
		className?: string;
		onClick?: (e: React.MouseEvent) => void;
	}) => (
		<a href="/stub" className={className} onClick={onClick}>
			{children}
		</a>
	),
	useNavigate: () => navigateSpy,
}));

afterEach(() => {
	cleanup();
	navigateSpy.mockClear();
});

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

function renderTable(
	overrides: Partial<Parameters<typeof OrderTable>[0]> = {},
) {
	const props = {
		orders: [base],
		columns: cols("shortId", "customer", "total"),
		statusLabelFor: () => "Confirmed",
		sorting: [],
		onSortingChange: vi.fn(),
		onReorderColumns: vi.fn(),
		selectMode: false,
		selected: new Set<string>(),
		onToggleSelect: vi.fn(),
		onTogglePin: vi.fn(),
		empty: { title: "No orders match these filters", body: "Adjust or clear." },
		columnWidths: {},
		onColumnWidthsChange: vi.fn(),
		...overrides,
	};
	const view = render(<OrderTable {...props} />);
	return { ...props, ...view };
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

	it("keeps a long status on ONE line — a wrapped pill breaks into fragments", () => {
		renderTable({
			columns: cols("status"),
			statusLabelFor: () => "Ready for Pickup",
		});
		const badge = screen.getByText("Ready for Pickup");
		// The defect is purely visual (an inline span whose rounded background
		// splits across two lines), so the class is the only observable — pin it.
		expect(badge.className).toContain("inline-block");
		expect(badge.className).toContain("truncate");
		// Truncated text still has to be readable.
		expect(badge.getAttribute("title")).toBe("Ready for Pickup");
	});

	it("keeps the header — and its filters — when nothing matches", () => {
		// The dead end this avoids: pick a filter combination that matches
		// nothing, the table is replaced by a standalone empty panel, and the
		// header filter you just used is gone along with any way to un-use it.
		const onClearFilters = vi.fn();
		renderTable({ orders: [], onClearFilters });
		expect(screen.getByText(/no orders match these filters/i)).toBeTruthy();
		expect(
			screen.getByRole("button", { name: /order id — click to sort/i }),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /clear all filters/i }));
		expect(onClearFilters).toHaveBeenCalled();
	});

	it("offers no Clear button when nothing is filtered", () => {
		// Otherwise the empty state suggests an undo for something the seller
		// never did — the list is simply empty.
		renderTable({ orders: [] });
		expect(screen.getByText(/no orders match these filters/i)).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: /clear all filters/i }),
		).toBeNull();
	});

	it("bounds the scroll container, which is what makes the sticky header work", () => {
		// The trap: the wrapper is a scroll container on BOTH axes (overflow-x
		// forces overflow-y), so it — not the page — is the sticky containing
		// block. With no height cap it never scrolls vertically and `lg:sticky`
		// does nothing at all, silently. Deleting the max-height looks like
		// harmless tidying; this test is the tripwire.
		const { container } = renderTable();
		const scroller = container.querySelector(".overflow-x-auto");
		expect(scroller?.className).toContain("lg:max-h-");
		const head = container.querySelector("thead");
		expect(head?.className).toContain("lg:sticky");
	});

	it("gives every column but the last a resize handle", () => {
		renderTable({ columns: cols("shortId", "customer", "total") });
		expect(
			screen.getByRole("separator", { name: /resize order id/i }),
		).toBeTruthy();
		expect(
			screen.getByRole("separator", { name: /resize customer/i }),
		).toBeTruthy();
		// The right-most column has no neighbour to take width from — a handle
		// there would drag against nothing.
		expect(
			screen.queryByRole("separator", { name: /resize total/i }),
		).toBeNull();
	});

	it("double-clicking a handle drops that column's stored width", () => {
		// Back to the registry default, the spreadsheet convention — and the only
		// way out of a regretted width short of resetting the whole layout.
		const { onColumnWidthsChange } = renderTable({
			columns: cols("shortId", "customer", "total"),
			columnWidths: { shortId: 300, customer: 220 },
		});
		fireEvent.doubleClick(
			screen.getByRole("separator", { name: /resize order id/i }),
		);
		expect(onColumnWidthsChange).toHaveBeenCalledWith({ customer: 220 });
	});

	it("resizes from the keyboard, which a drag handle alone can never do", () => {
		const { onColumnWidthsChange } = renderTable({
			columns: cols("shortId", "customer", "total"),
			columnWidths: { shortId: 200 },
		});
		const handle = screen.getByRole("separator", { name: /resize order id/i });
		fireEvent.keyDown(handle, { key: "ArrowRight" });
		expect(onColumnWidthsChange).toHaveBeenLastCalledWith({ shortId: 208 });
		fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
		expect(onColumnWidthsChange).toHaveBeenLastCalledWith({ shortId: 160 });
		// Home is the keyboard twin of the double-click.
		fireEvent.keyDown(handle, { key: "Home" });
		expect(onColumnWidthsChange).toHaveBeenLastCalledWith({});
	});

	it("a keyboard nudge can't walk a column past its bounds", () => {
		const { onColumnWidthsChange } = renderTable({
			columns: cols("shortId", "customer", "total"),
			columnWidths: { shortId: ORDER_COLUMN_MIN_WIDTH },
		});
		fireEvent.keyDown(
			screen.getByRole("separator", { name: /resize order id/i }),
			{ key: "ArrowLeft", shiftKey: true },
		);
		expect(onColumnWidthsChange).toHaveBeenLastCalledWith({
			shortId: ORDER_COLUMN_MIN_WIDTH,
		});
	});

	it("reports the current width to assistive tech, so a splitter isn't a mystery control", () => {
		renderTable({
			columns: cols("shortId", "customer", "total"),
			columnWidths: { shortId: 210 },
		});
		const handle = screen.getByRole("separator", { name: /resize order id/i });
		expect(handle.getAttribute("aria-valuenow")).toBe("210");
		expect(handle.getAttribute("aria-valuemin")).toBe(
			String(ORDER_COLUMN_MIN_WIDTH),
		);
		expect(handle.getAttribute("aria-valuemax")).toBe(
			String(ORDER_COLUMN_MAX_WIDTH),
		);
	});

	it("a resize never starts a column drag — the handle is outside the drag target", () => {
		// dnd-kit's listeners live on the header BUTTON; the handle is its sibling,
		// so a pointer down on the border can't be read as a reorder.
		const { onReorderColumns } = renderTable({
			columns: cols("shortId", "customer", "total"),
		});
		const handle = screen.getByRole("separator", { name: /resize order id/i });
		fireEvent.mouseDown(handle, { clientX: 120 });
		fireEvent.mouseUp(handle, { clientX: 200 });
		expect(onReorderColumns).not.toHaveBeenCalled();
	});

	it("pins from the row, passing the order back", () => {
		const { onTogglePin } = renderTable();
		fireEvent.click(
			screen.getByRole("button", { name: /pin order ORD-1001/i }),
		);
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

	it("in select mode a row click selects instead of navigating", () => {
		// A stray click while ticking twenty rows must not throw the seller out of
		// the selection they were building.
		const { onToggleSelect } = renderTable({ selectMode: true });
		fireEvent.click(screen.getByText("Aisha"));
		expect(onToggleSelect).toHaveBeenCalledWith("o1");
		expect(navigateSpy).not.toHaveBeenCalled();
	});

	it("out of select mode a row click opens the order", () => {
		renderTable();
		fireEvent.click(screen.getByText("Aisha"));
		expect(navigateSpy).toHaveBeenCalledWith({
			to: "/app/orders/$shortId",
			params: { shortId: "ORD-1001" },
		});
	});

	it("the Order ID cell is a REAL link — a <tr> can't be one", () => {
		// Keeps middle-click, cmd-click and keyboard navigation working, which a
		// row-level onClick alone would break.
		renderTable();
		const link = screen.getByRole("link", { name: "ORD-1001" });
		expect(link).toBeTruthy();
		// Clicking it must not ALSO fire the row's navigate.
		fireEvent.click(link);
		expect(navigateSpy).not.toHaveBeenCalled();
	});

	it("renders nothing extra for an empty list", () => {
		renderTable({ orders: [] });
		expect(screen.getByText("Order ID")).toBeTruthy();
		expect(screen.queryByRole("link")).toBeNull();
	});

	it("uses real table markup, not divs", () => {
		// Visual consistency with customer-list.tsx and the rest of the app.
		const { container } = render(<div />);
		void container;
		renderTable();
		expect(document.querySelector("table")).toBeTruthy();
		expect(document.querySelector("thead")).toBeTruthy();
		expect(document.querySelectorAll("tbody tr").length).toBe(1);
	});
});

describe("OrderTable — per-column sorting", () => {
	const rows: TableOrder[] = [
		{ ...base, _id: "a", shortId: "ORD-A", total: 8600, createdAt: 300 },
		{ ...base, _id: "b", shortId: "ORD-B", total: 12500, createdAt: 100 },
		{ ...base, _id: "c", shortId: "ORD-C", total: 24500, createdAt: 200 },
	];
	const idsOnScreen = () =>
		screen.getAllByText(/ORD-[ABC]/).map((n) => n.textContent ?? "");

	it("every header is a sort control", () => {
		renderTable({ orders: rows });
		expect(
			screen.getByRole("button", { name: /order id — click to sort/i }),
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: /total — click to sort/i }),
		).toBeTruthy();
	});

	it("reports the column the seller clicked, biggest-first for money", () => {
		// Numeric columns open DESCENDING (TanStack's inference, and the right
		// instinct: clicking Total means "show me the big ones").
		const { onSortingChange } = renderTable({ orders: rows });
		fireEvent.click(
			screen.getByRole("button", { name: /total — click to sort/i }),
		);
		expect(onSortingChange).toHaveBeenCalledWith([{ id: "total", desc: true }]);
	});

	it("text columns open ascending — A first, not Z", () => {
		const { onSortingChange } = renderTable({ orders: rows });
		fireEvent.click(
			screen.getByRole("button", { name: /customer — click to sort/i }),
		);
		expect(onSortingChange).toHaveBeenCalledWith([
			{ id: "customer", desc: false },
		]);
	});

	it("sorts money NUMERICALLY, not as text", () => {
		// The whole reason columns carry a typed sortKey: as strings, "12500"
		// renders "125.00" and would sort below "86.00".
		renderTable({ orders: rows, sorting: [{ id: "total", desc: false }] });
		expect(idsOnScreen()).toEqual(["ORD-A", "ORD-B", "ORD-C"]);
	});

	it("reverses on desc", () => {
		renderTable({ orders: rows, sorting: [{ id: "total", desc: true }] });
		expect(idsOnScreen()).toEqual(["ORD-C", "ORD-B", "ORD-A"]);
	});

	it("sorts dates by their instant, not their rendered string", () => {
		// All three render the same day string here, so a lexical sort could not
		// tell them apart — only the epoch can.
		renderTable({
			orders: rows,
			columns: cols("shortId", "createdAt"),
			sorting: [{ id: "createdAt", desc: false }],
		});
		expect(idsOnScreen()).toEqual(["ORD-B", "ORD-C", "ORD-A"]);
	});

	it("sinks empty values whichever way the sort runs", () => {
		// A dateless order is unscheduled, not "earliest" — it must not lead an
		// ascending sort just because it has no value.
		const mixed: TableOrder[] = [
			{ ...base, _id: "x", shortId: "ORD-X", fulfilmentDate: 500 },
			{ ...base, _id: "y", shortId: "ORD-Y" },
			{ ...base, _id: "z", shortId: "ORD-Z", fulfilmentDate: 100 },
		];
		renderTable({
			orders: mixed,
			columns: cols("shortId", "fulfilmentDate"),
			sorting: [{ id: "fulfilmentDate", desc: false }],
		});
		expect(screen.getAllByText(/ORD-[XYZ]/).map((n) => n.textContent)).toEqual([
			"ORD-Z",
			"ORD-X",
			"ORD-Y",
		]);
	});

	it("keeps pinned orders on top of ANY sort", () => {
		// Pinning is a partition, never a competing sort key: the cheapest order
		// still leads a descending-by-total table when it is pinned.
		renderTable({
			orders: [rows[0], rows[1], { ...rows[2], pinnedAt: 1 }],
			sorting: [{ id: "total", desc: false }],
		});
		expect(idsOnScreen()[0]).toBe("ORD-C");
	});
});

describe("OrderTable — column order", () => {
	it("renders columns in the order it is given, not the registry's", () => {
		// The seller's drag order has to stick — and it is the same order the CSV
		// export follows.
		renderTable({ columns: cols("total", "customer", "shortId") });
		const headers = screen
			.getAllByRole("button", { name: /— click to sort/i })
			.map((b) => b.textContent?.trim());
		expect(headers).toEqual(["Total", "Customer", "Order ID"]);
	});
});

describe("OrderTable — pinned rows sort within their own group", () => {
	// Pinning partitions; the ACTIVE sort still applies inside each half. If the
	// pinned block froze in data order (what the table's own row pinning does),
	// the two halves would disagree about what "sorted by total" means.
	const rows: TableOrder[] = [
		{ ...base, _id: "p1", shortId: "ORD-P1", total: 30000, pinnedAt: 10 },
		{ ...base, _id: "p2", shortId: "ORD-P2", total: 10000, pinnedAt: 20 },
		{ ...base, _id: "n1", shortId: "ORD-N1", total: 50000 },
		{ ...base, _id: "n2", shortId: "ORD-N2", total: 20000 },
	];
	const order = () =>
		screen.getAllByText(/ORD-(P|N)\d/).map((n) => n.textContent);

	it("ascending sorts inside the pinned block and inside the rest", () => {
		renderTable({ orders: rows, sorting: [{ id: "total", desc: false }] });
		expect(order()).toEqual(["ORD-P2", "ORD-P1", "ORD-N2", "ORD-N1"]);
	});

	it("descending reverses both halves, pins still on top", () => {
		renderTable({ orders: rows, sorting: [{ id: "total", desc: true }] });
		expect(order()).toEqual(["ORD-P1", "ORD-P2", "ORD-N1", "ORD-N2"]);
	});

	it("a pinned order never falls below an unpinned one, whatever the sort", () => {
		for (const desc of [false, true]) {
			cleanup();
			renderTable({ orders: rows, sorting: [{ id: "total", desc }] });
			const ids = order();
			expect(ids.slice(0, 2).every((id) => id?.startsWith("ORD-P"))).toBe(true);
		}
	});
});

describe("OrderTable — headers are the reorder handle", () => {
	it("each header is both a sort control and a drag handle", () => {
		renderTable();
		const header = screen.getByRole("button", {
			name: /order id — click to sort, drag to move/i,
		});
		expect(header).toBeTruthy();
		// touch-none is what lets a held header drag instead of scrolling the
		// table sideways under the finger.
		expect(header.className).toContain("touch-none");
	});

	it("clicking a header still sorts — the drag sensor has an 8px threshold", () => {
		const { onSortingChange } = renderTable();
		fireEvent.click(
			screen.getByRole("button", { name: /total — click to sort/i }),
		);
		expect(onSortingChange).toHaveBeenCalled();
	});
});
