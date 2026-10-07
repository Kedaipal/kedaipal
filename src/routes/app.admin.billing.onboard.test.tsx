// @vitest-environment jsdom
// Admin → Billing → "Onboard a client", BUILD mode (docs/prebuilt-stores.md).
//
// The behaviour under test is the 7 Oct change: the handover email is OPTIONAL,
// because a batch pre-built ahead of a vendor list has no addresses yet by
// definition. Each case is written so that re-adding the old gate — or dropping
// the shared email-conflict rule — turns it red.
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { type FunctionReference, getFunctionName } from "convex/server";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	/** What `checkEmailHasStore` answers: null = the address is free. */
	emailConflict: null as unknown,
	created: [] as Record<string, unknown>[],
	navigated: [] as unknown[],
	actAs: [] as unknown[],
}));

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (opts: Record<string, unknown>) => opts,
	Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
	useNavigate: () => (to: unknown) => {
		state.navigated.push(to);
	},
}));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: (opts: { __fn: FunctionReference<"query">; args: unknown }) => {
		const name = getFunctionName(opts.__fn);
		if (name === "retailers:checkSlugAvailability")
			return { data: { status: "available" } };
		if (name === "retailers:checkEmailHasStore")
			// Honour "skip" so the card's own gating stays under test.
			return { data: opts.args === "skip" ? undefined : state.emailConflict };
		if (name === "foundingMembers:getSpotsRemaining") return { data: 5 };
		return { data: undefined };
	},
}));
vi.mock("convex/react", () => ({
	useMutation: (ref: FunctionReference<"mutation">) =>
		getFunctionName(ref) === "retailers:createUnclaimedStore"
			? async (args: Record<string, unknown>) => {
					state.created.push(args);
					return { slug: args.slug, retailerId: `r_${state.created.length}` };
				}
			: async () => undefined,
}));
vi.mock("../hooks/useActAs", () => ({
	useActAs: () => ({
		setActAs: (id: unknown) => {
			state.actAs.push(id);
		},
		actAsRetailerId: undefined,
		pending: false,
	}),
}));
vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

const { OnboardClientCard } = await import("./app.admin.billing");

afterEach(() => {
	cleanup();
	state.emailConflict = null;
	state.created = [];
	state.navigated = [];
	state.actAs = [];
});

/** Render the card already switched to "Build it for them" with a store named. */
function renderBuildMode(storeName = "Mak Cik Kuih") {
	render(<OnboardClientCard />);
	fireEvent.click(screen.getByRole("button", { name: /Build it for them/i }));
	fireEvent.change(screen.getByPlaceholderText("e.g. Mak Cik Kuih"), {
		target: { value: storeName },
	});
}

const createButton = () =>
	screen.getByRole<HTMLButtonElement>("button", {
		name: /Create store & start setting up/i,
	});
const addAnotherButton = () =>
	screen.getByRole<HTMLButtonElement>("button", {
		name: /Create & add another/i,
	});
const emailField = () => screen.getByPlaceholderText("client@email.com");

describe("build mode — the handover email is optional", () => {
	it("creates with NO email, and sends it as undefined", async () => {
		renderBuildMode();
		await waitFor(() => expect(createButton().disabled).toBe(false));
		fireEvent.click(createButton());
		await waitFor(() => expect(state.created).toHaveLength(1));
		expect(state.created[0]).toMatchObject({
			storeName: "Mak Cik Kuih",
			slug: "mak-cik-kuih",
			pendingOwnerEmail: undefined,
		});
	});

	it("says the field is optional and where a nameless store waits", async () => {
		renderBuildMode();
		expect(screen.getByText("(optional)")).toBeTruthy();
		// The constraint is surfaced where the admin is typing, not discovered in
		// the directory later.
		const helper = screen.getByText(/Leave it blank/i);
		expect(helper.closest("span")?.textContent).toMatch(/Unclaimed/);
	});

	it("never blocks the button for a missing email", async () => {
		renderBuildMode();
		await waitFor(() => expect(createButton().disabled).toBe(false));
		// The old copy. Its presence means the gate is back.
		expect(
			screen.queryByText(/nobody can claim the store without it/i),
		).toBeNull();
	});
});

describe("build mode — a clashing email", () => {
	it("prints the SERVER's sentence and disables both buttons", async () => {
		state.emailConflict = {
			kind: "waiting",
			storeName: "First Store",
			slug: "first-store",
			message: "First Store is already waiting for a@b.com. One login…",
		};
		renderBuildMode();
		fireEvent.change(emailField(), { target: { value: "a@b.com" } });
		await waitFor(() =>
			expect(
				screen.getByText(
					"First Store is already waiting for a@b.com. One login…",
				),
			).toBeTruthy(),
		);
		expect(createButton().disabled).toBe(true);
		expect(addAnotherButton().disabled).toBe(true);
		// The clash is stated ONCE — in full under the field — and the button's
		// reason points at it rather than paraphrasing it into a second problem.
		expect(screen.getByText(/Fix the handover email above/i)).toBeTruthy();
		expect(screen.getAllByText(/already waiting for a@b\.com/i)).toHaveLength(
			1,
		);
	});
});

describe('"Create & add another"', () => {
	it("stays on the card, clears the store fields and keeps the country", async () => {
		renderBuildMode();
		fireEvent.click(screen.getByRole("button", { name: /^Singapore$/i }));
		await waitFor(() => expect(addAnotherButton().disabled).toBe(false));
		fireEvent.click(addAnotherButton());
		await waitFor(() => expect(state.created).toHaveLength(1));
		expect(state.created[0]).toMatchObject({ country: "SG" });
		// No act-as, no navigation — that is the whole difference from the primary.
		expect(state.actAs).toHaveLength(0);
		expect(state.navigated).toHaveLength(0);
		// Cleared for the next store…
		await waitFor(() =>
			expect(
				(screen.getByPlaceholderText("e.g. Mak Cik Kuih") as HTMLInputElement)
					.value,
			).toBe(""),
		);
		// …but the country survives, so a batch doesn't re-pick it every time.
		expect(
			screen
				.getByRole("button", { name: /^Singapore$/i })
				.getAttribute("aria-pressed"),
		).toBe("true");
	});

	it("keeps a running receipt that links to the Unclaimed worklist", async () => {
		renderBuildMode("Kuih One");
		await waitFor(() => expect(addAnotherButton().disabled).toBe(false));
		fireEvent.click(addAnotherButton());
		await waitFor(() =>
			expect(screen.getByText(/Created here · 1/)).toBeTruthy(),
		);
		expect(screen.getByText("/kuih-one")).toBeTruthy();
		expect(
			screen.getByRole("link", { name: /Sellers → Unclaimed/i }),
		).toBeTruthy();
	});

	it("is absent in link mode — there is nothing to repeat there", () => {
		render(<OnboardClientCard />);
		expect(
			screen.queryByRole("button", { name: /Create & add another/i }),
		).toBeNull();
	});
});

describe("the primary button still walks into the store", () => {
	it("enters act-as and navigates to the dashboard", async () => {
		renderBuildMode();
		await waitFor(() => expect(createButton().disabled).toBe(false));
		fireEvent.click(createButton());
		await waitFor(() => expect(state.actAs).toEqual(["r_1"]));
		expect(state.navigated).toEqual([{ to: "/app" }]);
	});
});
