// @vitest-environment jsdom
// Store highlights dialog (z8r3fdkmyp): the three shapes — internal (never
// listed, no controls), comped (featured automatically; one switch keeps it
// off), everyone else (a dated window: start / move-needs-a-change / end).
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { type FunctionReference, getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../convex/_generated/api";
import type { AdminSellerRow } from "../../../convex/admin";

const mutationSpies = new Map<string, ReturnType<typeof vi.fn>>();
vi.mock("convex/react", () => ({
	useMutation: (ref: FunctionReference<"mutation">) => {
		const name = getFunctionName(ref);
		if (!mutationSpies.has(name)) {
			mutationSpies.set(name, vi.fn().mockResolvedValue(null));
		}
		return mutationSpies.get(name);
	},
}));

import { HighlightDialog } from "./highlight-dialog";

const spy = (ref: FunctionReference<"mutation">) =>
	mutationSpies.get(getFunctionName(ref));

beforeEach(() => {
	mutationSpies.clear();
});
afterEach(cleanup);

function seller(overrides: Partial<AdminSellerRow> = {}): AdminSellerRow {
	return {
		_id: "r_hl" as AdminSellerRow["_id"],
		storeName: "Kek Sayang",
		slug: "kek-sayang",
		ownerUserId: "u_owner",
		ownerIsAdmin: false,
		seats: { active: 1, cap: 3, capUnlimited: false, invited: 0 },
		isFoundingMember: false,
		subscriptionStatus: "active",
		plan: "pro",
		comped: false,
		createdAt: 0,
		unclaimed: false,
		purging: false,
		marketplace: { internal: false },
		country: "MY",
		currency: "MYR",
		...overrides,
	};
}

const comped = (kind: "partner" | "sponsor" | "pilot" | "internal") =>
	({
		comped: true,
		comp: { kind, label: "Sponsored by Kedaipal", grantedAt: 0 },
	}) as const;

/** Local YYYY-MM-DD, `days` from today. */
function inputDate(days: number): string {
	const d = new Date();
	d.setDate(d.getDate() + days);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

describe("HighlightDialog — not comped: a dated window", () => {
	it("discloses the buyer label, waits for a date WITH its reason, stores the day after the inclusive end", async () => {
		const onClose = vi.fn();
		render(<HighlightDialog seller={seller()} onClose={onClose} />);
		expect(screen.getByText(/labelled “Sponsored”/)).toBeTruthy();
		const start = screen.getByRole("button", { name: "Start highlight" });
		expect(start.hasAttribute("disabled")).toBe(true);
		expect(
			screen.getByText("Pick the last day the card should show."),
		).toBeTruthy();

		const end = inputDate(7);
		fireEvent.change(screen.getByLabelText(/Highlighted through/), {
			target: { value: end },
		});
		fireEvent.click(start);
		const [y, m, d] = end.split("-").map(Number);
		await waitFor(() =>
			expect(spy(api.admin.setMarketplaceSponsorship)).toHaveBeenCalledWith({
				retailerId: "r_hl",
				until: new Date(y, m - 1, d + 1).getTime(),
			}),
		);
		await waitFor(() => expect(onClose).toHaveBeenCalled());
	});

	it("live window: prefilled, Update waits for a change, End uses its own mutation", async () => {
		const [y, m, d] = inputDate(5).split("-").map(Number);
		const until = new Date(y, m - 1, d + 1).getTime();
		render(
			<HighlightDialog
				seller={seller({
					marketplace: { sponsoredUntil: until, internal: false },
				})}
				onClose={vi.fn()}
			/>,
		);
		expect(
			(screen.getByLabelText(/Highlighted through/) as HTMLInputElement).value,
		).toBe(inputDate(5));
		const update = screen.getByRole("button", { name: "Update window" });
		expect(update.hasAttribute("disabled")).toBe(true);
		expect(screen.getByText(/Pick a new last day/)).toBeTruthy();
		fireEvent.change(screen.getByLabelText(/Highlighted through/), {
			target: { value: inputDate(9) },
		});
		expect(update.hasAttribute("disabled")).toBe(false);

		fireEvent.click(screen.getByRole("button", { name: "End window now" }));
		await waitFor(() =>
			expect(spy(api.admin.endMarketplaceSponsorship)).toHaveBeenCalledWith({
				retailerId: "r_hl",
			}),
		);
		expect(spy(api.admin.setMarketplaceSponsorship)).not.toHaveBeenCalled();
	});

	it("warns when the seller has opted out — a highlight would not show", () => {
		render(
			<HighlightDialog
				seller={seller({
					marketplace: { unlistedAt: Date.now() - 1000, internal: false },
				})}
				onClose={vi.fn()}
			/>,
		);
		expect(screen.getByText(/opted OUT of the marketplace/)).toBeTruthy();
	});

	it("warns when an admin hid the store — and that outranks the seller's opt-out", () => {
		render(
			<HighlightDialog
				seller={seller({
					marketplace: {
						hidden: { at: Date.now() - 1000 },
						unlistedAt: Date.now() - 1000,
						internal: false,
					},
				})}
				onClose={vi.fn()}
			/>,
		);
		expect(
			screen.getByText(/An admin hid this store from \/stores/),
		).toBeTruthy();
		expect(screen.queryByText(/opted OUT of the marketplace/)).toBeNull();
	});
});

describe("HighlightDialog — comped: featured automatically", () => {
	it("a Sponsor comp is ON with no date to pick; the switch turns it off", async () => {
		render(
			<HighlightDialog seller={seller(comped("sponsor"))} onClose={vi.fn()} />,
		);
		expect(
			screen.getByText(
				/Sponsor comps join the "Store highlights" rail automatically/,
			),
		).toBeTruthy();
		expect(screen.queryByLabelText(/Highlighted through/)).toBeNull();
		const toggle = screen.getByRole("switch", { name: /while comped/ });
		expect(toggle.getAttribute("aria-checked")).toBe("true");
		fireEvent.click(toggle);
		await waitFor(() =>
			expect(spy(api.admin.setCompHighlight)).toHaveBeenCalledWith({
				retailerId: "r_hl",
				on: false,
			}),
		);
	});

	it("kept off by an admin: the switch reads off and says since when", () => {
		render(
			<HighlightDialog
				seller={seller({
					...comped("partner"),
					marketplace: {
						compHighlightOffAt: Date.now() - 1000,
						internal: false,
					},
				})}
				onClose={vi.fn()}
			/>,
		);
		expect(
			screen
				.getByRole("switch", { name: /while comped/ })
				.getAttribute("aria-checked"),
		).toBe("false");
		expect(screen.getByText(/stays off the rail/)).toBeTruthy();
	});
});

describe("HighlightDialog — internal store", () => {
	it("says it's never listed and offers no control", () => {
		render(
			<HighlightDialog
				seller={seller({
					...comped("internal"),
					marketplace: { internal: true },
				})}
				onClose={vi.fn()}
			/>,
		);
		expect(
			screen.getByText(/never listed on kedaipal\.com\/stores/),
		).toBeTruthy();
		expect(screen.queryByRole("switch")).toBeNull();
		expect(screen.queryByLabelText(/Highlighted through/)).toBeNull();
		expect(
			screen.queryByRole("button", { name: /Start highlight/ }),
		).toBeNull();
	});
});
