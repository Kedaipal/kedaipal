// @vitest-environment jsdom
// Marketplace sponsorship dialog (z8r3fdkmyp): off → start a window, on →
// update or end early, the inclusive end date, and the warning when the
// seller has opted out (a sponsorship that can't show must say so).
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

import { SponsorDialog } from "./sponsor-dialog";

const setSponsorshipSpy = () =>
	mutationSpies.get(getFunctionName(api.admin.setMarketplaceSponsorship));
const endSponsorshipSpy = () =>
	mutationSpies.get(getFunctionName(api.admin.endMarketplaceSponsorship));

beforeEach(() => {
	mutationSpies.clear();
});
afterEach(cleanup);

function seller(overrides: Partial<AdminSellerRow> = {}): AdminSellerRow {
	return {
		_id: "r_spon" as AdminSellerRow["_id"],
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
		purging: false,
		marketplace: {},
		country: "MY",
		currency: "MYR",
		...overrides,
	};
}

/** Local YYYY-MM-DD, `days` from today. */
function inputDate(days: number): string {
	const d = new Date();
	d.setDate(d.getDate() + days);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

describe("SponsorDialog — not sponsored", () => {
	it("discloses the label, needs a date, and stores the day AFTER the inclusive end", async () => {
		const onClose = vi.fn();
		render(<SponsorDialog seller={seller()} onClose={onClose} />);
		expect(screen.getByText(/visible “Sponsored” label/)).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "End sponsorship now" }),
		).toBeNull();
		const start = screen.getByRole("button", { name: "Start sponsorship" });
		expect(start.hasAttribute("disabled")).toBe(true);
		// Disabled WITH its reason.
		expect(
			screen.getByText("Pick the last day the card should show."),
		).toBeTruthy();

		const end = inputDate(7);
		fireEvent.change(screen.getByLabelText(/Sponsored through/), {
			target: { value: end },
		});
		fireEvent.click(start);

		const [y, m, d] = end.split("-").map(Number);
		await waitFor(() =>
			expect(setSponsorshipSpy()).toHaveBeenCalledWith({
				retailerId: "r_spon",
				until: new Date(y, m - 1, d + 1).getTime(),
			}),
		);
		await waitFor(() => expect(onClose).toHaveBeenCalled());
	});

	it("warns when the seller has opted out — the window would not show", () => {
		render(
			<SponsorDialog
				seller={seller({ marketplace: { unlistedAt: Date.now() - 1000 } })}
				onClose={vi.fn()}
			/>,
		);
		expect(screen.getByText(/opted OUT of the marketplace/)).toBeTruthy();
	});
});

describe("SponsorDialog — live window", () => {
	it("prefills the inclusive end date; Update waits for a change; End uses its own mutation", async () => {
		const [y, m, d] = inputDate(5).split("-").map(Number);
		const until = new Date(y, m - 1, d + 1).getTime();
		const onClose = vi.fn();
		render(
			<SponsorDialog
				seller={seller({ marketplace: { sponsoredUntil: until } })}
				onClose={onClose}
			/>,
		);
		expect(
			(screen.getByLabelText(/Sponsored through/) as HTMLInputElement).value,
		).toBe(inputDate(5));
		// Unchanged → nothing to save (no no-op write, no empty audit row).
		const update = screen.getByRole("button", { name: "Update window" });
		expect(update.hasAttribute("disabled")).toBe(true);
		expect(screen.getByText(/Pick a new last day/)).toBeTruthy();
		fireEvent.change(screen.getByLabelText(/Sponsored through/), {
			target: { value: inputDate(9) },
		});
		expect(update.hasAttribute("disabled")).toBe(false);

		fireEvent.click(
			screen.getByRole("button", { name: "End sponsorship now" }),
		);
		await waitFor(() =>
			expect(endSponsorshipSpy()).toHaveBeenCalledWith({
				retailerId: "r_spon",
			}),
		);
		expect(setSponsorshipSpy()).not.toHaveBeenCalled();
		await waitFor(() => expect(onClose).toHaveBeenCalled());
	});

	it("an expired window reads as not sponsored", () => {
		render(
			<SponsorDialog
				seller={seller({ marketplace: { sponsoredUntil: Date.now() - 1 } })}
				onClose={vi.fn()}
			/>,
		);
		expect(
			screen.getByRole("button", { name: "Start sponsorship" }),
		).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "End sponsorship now" }),
		).toBeNull();
	});
});
