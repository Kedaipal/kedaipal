// @vitest-environment jsdom
import {
	createBrowserHistory,
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import type { AdminShowcase } from "../../../convex/showcases";
import { ShowcaseEditor } from "./showcase-editor";

// Reads go via `useQuery(convexQuery(api.x, args)).data`. The mock answers
// from a tiny external store, so a test can change the SAVED row under an
// open editor — a save, a cover upload, another admin — and watch the form.
const store = vi.hoisted(() => {
	let row: unknown = null;
	const listeners = new Set<() => void>();
	return {
		get: () => row,
		set: (next: unknown) => {
			row = next;
			for (const l of listeners) l();
		},
		subscribe: (l: () => void) => {
			listeners.add(l);
			return () => listeners.delete(l);
		},
	};
});
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
vi.mock("@tanstack/react-query", async () => {
	const { useSyncExternalStore } = await import("react");
	return {
		useQuery: (q: { args: unknown }) => {
			const row = useSyncExternalStore(store.subscribe, store.get);
			// The picker's seller list is skipped while the sheet is closed.
			return { data: q.args === "skip" ? undefined : row };
		},
	};
});
vi.mock("convex/react", () => ({
	useMutation: () => vi.fn().mockResolvedValue(undefined),
}));
vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

afterEach(cleanup);

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

function row(extra: Partial<AdminShowcase> = {}): AdminShowcase {
	return {
		_id: "sc_1" as Id<"marketplaceShowcases">,
		slug: "qa-weekend-pop-up",
		title: "QA Weekend Pop-up",
		country: "MY",
		theme: "festive",
		endsAt: NOW + 3 * DAY,
		publishedAt: NOW - DAY,
		sortOrder: 1,
		state: "live",
		members: [],
		createdAt: NOW - DAY,
		updatedAt: NOW - DAY,
		...extra,
	};
}

function renderEditor(
	initial: AdminShowcase,
	history: "memory" | "browser" = "memory",
) {
	store.set(initial);
	const rootRoute = createRootRoute({ component: () => <Outlet /> });
	const editor = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => (
			<ShowcaseEditor showcaseId={initial._id as Id<"marketplaceShowcases">} />
		),
	});
	const list = createRoute({
		getParentRoute: () => rootRoute,
		path: "/app/admin/showcases",
		component: () => <p>Showcase list</p>,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([editor, list]),
		history:
			history === "browser"
				? createBrowserHistory()
				: createMemoryHistory({ initialEntries: ["/"] }),
	});
	// biome-ignore lint/suspicious/noExplicitAny: stub tree, not the app's registered one
	render(<RouterProvider router={router as any} />);
	return router;
}

const saveButton = () =>
	screen.getByRole("button", { name: /^Save/ }) as HTMLButtonElement;

describe("ShowcaseEditor — the save bar tells the truth", () => {
	it("a live showcase with nothing changed: Save is off and says it stays live", async () => {
		renderEditor(row());
		await screen.findByDisplayValue("QA Weekend Pop-up");
		expect(saveButton().textContent).toBe("Save · live on /stores now");
		expect(saveButton().disabled).toBe(true);
		expect(screen.getByText("Everything is saved.")).toBeTruthy();
	});

	it("moving the start into the future says the save takes it OFF /stores", async () => {
		renderEditor(row());
		const from = (await screen.findByLabelText(
			"Show from",
		)) as HTMLInputElement;
		const start = new Date(NOW + DAY + 8 * 60 * 60 * 1000);
		const pad = (n: number) => String(n).padStart(2, "0");
		fireEvent.change(from, {
			target: {
				value: `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}-${pad(start.getUTCDate())}T09:00`,
			},
		});
		expect(saveButton().textContent).toMatch(/^Save · off \/stores until /);
		expect(saveButton().disabled).toBe(false);
	});

	it("Discard changes puts the draft back", async () => {
		renderEditor(row());
		await screen.findByDisplayValue("QA Weekend Pop-up");
		// The label carries the "17/60" counter, so find the field by its id.
		const title = document.getElementById("showcase-title") as HTMLInputElement;
		fireEvent.change(title, { target: { value: "Renamed" } });
		expect(screen.getByText(/Unsaved: title/)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
		expect(title.value).toBe("QA Weekend Pop-up");
		expect(screen.getByText("Everything is saved.")).toBeTruthy();
	});
});

describe("ShowcaseEditor — a change saved elsewhere never eats an edit", () => {
	it("an unsaved title survives the row changing underneath (a cover upload)", async () => {
		renderEditor(row());
		await screen.findByDisplayValue("QA Weekend Pop-up");
		// The label carries the "17/60" counter, so find the field by its id.
		const title = document.getElementById("showcase-title") as HTMLInputElement;
		fireEvent.change(title, { target: { value: "Typed, not saved" } });
		act(() => {
			store.set(
				row({ coverImageUrl: "https://img/cover.jpg", updatedAt: NOW }),
			);
		});
		expect(title.value).toBe("Typed, not saved");
		expect(screen.getByText(/Unsaved: title/)).toBeTruthy();
		expect(screen.getByText("Cover uploaded")).toBeTruthy();
	});
});

describe("ShowcaseEditor — the looks", () => {
	it("Custom opens the colour wheel, seeded from the current look", async () => {
		renderEditor(row());
		await screen.findByDisplayValue("QA Weekend Pop-up");
		expect(screen.queryByLabelText("Colour")).toBeNull();
		fireEvent.click(screen.getByLabelText("Custom"));
		const hex = screen.getByLabelText("Colour") as HTMLInputElement;
		// Festive's own colour, so the switch is a nudge, not a jump.
		expect(hex.value).toBe("#a3264d");
		expect(screen.getByText(/Unsaved: theme/)).toBeTruthy();
	});

	it("No tint explains itself — with no cover it is plain charcoal", async () => {
		renderEditor(row());
		await screen.findByDisplayValue("QA Weekend Pop-up");
		fireEvent.click(screen.getByLabelText("No tint"));
		expect(screen.getByText(/with no cover it's plain charcoal/)).toBeTruthy();
		expect(screen.getByText("No cover — a plain charcoal ground")).toBeTruthy();
	});
});

describe("ShowcaseEditor — leaving asks only when something is unsaved", () => {
	/** What a reload / tab close does: the browser asks only if a listener
	 * cancels this event. */
	function unloadIsBlocked() {
		const event = new Event("beforeunload", { cancelable: true });
		window.dispatchEvent(event);
		return event.defaultPrevented;
	}

	it("a clean editor lets the page go; an unsaved edit makes the browser ask", async () => {
		renderEditor(row(), "browser");
		await screen.findByDisplayValue("QA Weekend Pop-up");
		// A prompt with nothing unsaved would stall every reload for nothing.
		expect(unloadIsBlocked()).toBe(false);
		const title = document.getElementById("showcase-title") as HTMLInputElement;
		fireEvent.change(title, { target: { value: "Renamed" } });
		expect(unloadIsBlocked()).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
		expect(unloadIsBlocked()).toBe(false);
	});
});
