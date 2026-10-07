// @vitest-environment jsdom
// Setting a pre-built store's handover email (docs/prebuilt-stores.md).
//
// The behaviour under test is the pre-flight hint this dialog gained on 7 Oct:
// it used to offer an enabled Save for an address the server was about to
// refuse, so the refusal only arrived as an error toast AFTER the click, while
// the build form warned inline BEFORE it. One rule, two behaviours.
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { type FunctionReference, getFunctionName } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	conflict: null as unknown,
	lastArgs: undefined as unknown,
	saved: [] as unknown[],
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: (opts: { __fn: FunctionReference<"query">; args: unknown }) => {
		if (getFunctionName(opts.__fn) === "retailers:checkEmailHasStore") {
			if (opts.args === "skip") return { data: undefined };
			state.lastArgs = opts.args;
			return { data: state.conflict };
		}
		return { data: undefined };
	},
}));
vi.mock("convex/react", () => ({
	useMutation: () => async (args: unknown) => {
		state.saved.push(args);
	},
	useAction: () => async () => ({ email: "x@y.com" }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { HandoverDialog } = await import("./handover-dialog");

afterEach(() => {
	cleanup();
	state.conflict = null;
	state.lastArgs = undefined;
	state.saved = [];
});

const seller = (over: Record<string, unknown> = {}) =>
	({
		_id: "r_self",
		storeName: "Mak Cik Kuih",
		slug: "mak-cik-kuih",
		unclaimed: true,
		...over,
		// biome-ignore lint/suspicious/noExplicitAny: test double for AdminSellerRow
	}) as any;

const field = () => screen.getByPlaceholderText("vendor@example.com");
const saveButton = () =>
	screen.getByRole<HTMLButtonElement>("button", {
		name: /Save handover email|Clear handover email/i,
	});

describe("the handover dialog warns BEFORE the click", () => {
	it("prints the server's sentence and disables Save on a clash", async () => {
		state.conflict = {
			kind: "waiting",
			storeName: "Other Store",
			slug: "other-store",
			message: "Other Store is already waiting for a@b.com. One login…",
		};
		render(<HandoverDialog seller={seller()} onClose={() => {}} />);
		fireEvent.change(field(), { target: { value: "a@b.com" } });
		await waitFor(() =>
			expect(
				screen.getByText(
					"Other Store is already waiting for a@b.com. One login…",
				),
			).toBeTruthy(),
		);
		expect(saveButton().disabled).toBe(true);
		// Nothing was sent — the refusal is pre-flight, not a round trip.
		expect(state.saved).toHaveLength(0);
	});

	it("asks on behalf of THIS store, so its own address is not a self-clash", async () => {
		render(<HandoverDialog seller={seller()} onClose={() => {}} />);
		fireEvent.change(field(), { target: { value: "a@b.com" } });
		await waitFor(() => expect(state.lastArgs).toBeDefined());
		// Passing null here is the bug the server test pins: the store would
		// collide with itself and Save would never enable again.
		expect(state.lastArgs).toMatchObject({
			email: "a@b.com",
			forRetailerId: "r_self",
		});
	});

	it("leaves Save live for a free address", async () => {
		render(<HandoverDialog seller={seller()} onClose={() => {}} />);
		fireEvent.change(field(), { target: { value: "free@example.com" } });
		await waitFor(() => expect(saveButton().disabled).toBe(false));
	});

	it("still refuses a value that isn't an address, without asking", () => {
		render(<HandoverDialog seller={seller()} onClose={() => {}} />);
		fireEvent.change(field(), { target: { value: "not-an-email" } });
		expect(
			screen.getByText(/doesn't look like an email address/i),
		).toBeTruthy();
		expect(saveButton().disabled).toBe(true);
	});
});
