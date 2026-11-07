// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import type { AdminPickerStore } from "../../../convex/adminSellers";
import { ADMIN_COUNT_SCAN_LIMIT } from "../../../convex/lib/adminDirectory";
import { ShowcaseStorePicker } from "./showcase-store-picker";

// The picker's one read goes via `useQuery(convexQuery(api.x, args)).data`.
// The mock answers from a fixture and remembers the last call, so a test can
// assert WHICH read the sheet makes and with what, not just what it draws.
const fixture = vi.hoisted(() => {
	let data: unknown;
	let last: { fn: unknown; args: unknown } | null = null;
	return {
		set: (next: unknown) => {
			data = next;
		},
		get: () => data,
		last: () => last,
		remember: (fn: unknown, args: unknown) => {
			last = { fn, args };
		},
	};
});
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => {
		fixture.remember(fn, args);
		return { __fn: fn, args };
	},
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: (q: { args: unknown }) => ({
		data: q.args === "skip" ? undefined : fixture.get(),
	}),
}));

afterEach(cleanup);

const id = (s: string) => s as Id<"retailers">;
function store(
	o: Partial<AdminPickerStore> & { slug: string },
): AdminPickerStore {
	return {
		_id: id(`r_${o.slug}`),
		storeName: o.slug,
		internal: false,
		hidden: false,
		unlisted: false,
		...o,
	};
}
const STORES: AdminPickerStore[] = [
	store({ storeName: "Haji Catering", slug: "haji" }),
	store({ storeName: "iKuih by Mak", slug: "ikuih" }),
	store({ storeName: "Admin Test Store", slug: "admin-test", internal: true }),
	store({ storeName: "Hidden Bakes", slug: "hidden-bakes", hidden: true }),
	store({ storeName: "Quiet Kuih", slug: "quiet-kuih", unlisted: true }),
];

function renderPicker(
	props: Partial<Parameters<typeof ShowcaseStorePicker>[0]> = {},
	// `"pending"` = the read has not answered yet (a default parameter would
	// swallow an `undefined`).
	data: { stores: AdminPickerStore[]; capped: boolean } | "pending" = {
		stores: STORES,
		capped: false,
	},
) {
	fixture.set(data === "pending" ? undefined : data);
	const onAdd = vi.fn();
	render(
		<ShowcaseStorePicker
			open
			onOpenChange={() => {}}
			showcaseTitle="QA Weekend Pop-up"
			country="MY"
			alreadyIn={new Set([id("r_ikuih")])}
			capacityLeft={10}
			onAdd={onAdd}
			{...props}
		/>,
	);
	return { onAdd };
}

const checkbox = (name: RegExp) =>
	screen.getByRole("checkbox", { name }) as HTMLInputElement;
const addButton = () =>
	screen.getByRole("button", { name: /^Add \d+ store/ }) as HTMLButtonElement;

describe("ShowcaseStorePicker — reads the slim country list", () => {
	it("asks for the showcase's country, and only while the sheet is open", () => {
		renderPicker({ open: false, country: "SG" });
		expect(fixture.last()?.args).toBe("skip");
		cleanup();
		renderPicker({ country: "SG" });
		const last = fixture.last();
		expect(getFunctionName(last?.fn as never)).toBe(
			"adminSellers:listPickerStores",
		);
		expect(last?.args).toEqual({ country: "SG" });
	});

	it("draws every row's state and counts them honestly", () => {
		renderPicker();
		expect(
			screen.getByText("5 matches · 1 already in · 1 can't be added"),
		).toBeTruthy();
		const inShowcase = checkbox(/iKuih by Mak \(already in this showcase\)/);
		expect(inShowcase.checked).toBe(true);
		expect(inShowcase.disabled).toBe(true);
		expect(
			checkbox(/Admin Test Store \(can't be added — a Kedaipal or test store\)/)
				.disabled,
		).toBe(true);
		expect(
			screen.getByText("Hidden from /stores by Kedaipal — won't show"),
		).toBeTruthy();
		expect(
			screen.getByText("Seller turned off their /stores listing — won't show"),
		).toBeTruthy();
		// Select-all covers the ADDABLE rows: not the one already in, not the
		// internal one.
		expect(checkbox(/^All 3 stores — 0 of 3 stores selected$/)).toBeTruthy();
	});

	it("select-all picks the addable rows and the button says how many", () => {
		renderPicker();
		fireEvent.click(checkbox(/^All 3 stores/));
		expect(addButton().textContent).toBe("Add 3 stores");
		expect(checkbox(/^Haji Catering$/).checked).toBe(true);
		expect(checkbox(/^Admin Test Store/).checked).toBe(false);
	});

	it("search narrows by name or slug, and Add hands back names with the ids", () => {
		const { onAdd } = renderPicker();
		fireEvent.change(screen.getByLabelText("Search stores"), {
			target: { value: "kuih" },
		});
		expect(screen.getByText("2 matches · 1 already in")).toBeTruthy();
		fireEvent.click(checkbox(/^Quiet Kuih$/));
		expect(addButton().textContent).toBe("Add 1 store");
		fireEvent.click(addButton());
		expect(onAdd).toHaveBeenCalledWith([
			{
				retailerId: id("r_quiet-kuih"),
				storeName: "Quiet Kuih",
				slug: "quiet-kuih",
			},
		]);
	});

	it("names the scan cap beside the count, like the directory does", () => {
		renderPicker({}, { stores: STORES, capped: true });
		expect(
			screen.getByText(
				`5 matches · 1 already in · 1 can't be added · scanned the newest ${ADMIN_COUNT_SCAN_LIMIT.toLocaleString("en-MY")} stores`,
			),
		).toBeTruthy();
	});

	it("refuses a pick past the showcase's room, and says how much is left", () => {
		renderPicker({ capacityLeft: 1 });
		fireEvent.click(checkbox(/^Haji Catering$/));
		fireEvent.click(checkbox(/^Hidden Bakes$/));
		expect(addButton().disabled).toBe(true);
		expect(screen.getByText(/room for 1 more/)).toBeTruthy();
	});

	it("shows skeletons until the read answers", () => {
		renderPicker({}, "pending");
		expect(screen.getByText("Loading…")).toBeTruthy();
		expect(screen.queryByRole("checkbox")).toBeNull();
	});
});
