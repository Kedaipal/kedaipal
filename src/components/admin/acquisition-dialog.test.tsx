// @vitest-environment jsdom
// Acquisition channel tagging (86eye3eyp): the dialog pre-selects the
// suggestion and says why, confirms a seller's own answer, sends what the
// admin chose, and shows a server refusal where the admin typed. The drawer
// cell's three states each say what they mean for CAC.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

import { AcquisitionCell } from "./acquisition-cell";
import { AcquisitionDialog } from "./acquisition-dialog";

beforeEach(() => {
	mutationSpies.clear();
});
afterEach(cleanup);

function seller(overrides: Partial<AdminSellerRow> = {}): AdminSellerRow {
	return {
		_id: "r_new" as AdminSellerRow["_id"],
		storeName: "WaDaFish",
		slug: "wadafish",
		ownerUserId: "u_owner",
		ownerIsAdmin: false,
		seats: { active: 1, cap: 3, capUnlimited: false, invited: 0 },
		isFoundingMember: false,
		foundingIntent: false,
		subscriptionStatus: "active",
		plan: "pro",
		comped: false,
		createdAt: 0,
		unclaimed: false,
		referralEditable: false,
		hasPaidInvoice: true,
		acquisition: { suggested: null },
		purging: false,
		marketplace: { internal: false },
		country: "MY",
		currency: "MYR",
		billingCurrency: "MYR",
		availability: { state: "open" },
		...overrides,
	};
}

function primeSet(impl?: () => Promise<unknown>): ReturnType<typeof vi.fn> {
	const spy = vi.fn(impl ?? (() => Promise.resolve(null)));
	mutationSpies.set(getFunctionName(api.metrics.setAcquisitionSource), spy);
	return spy;
}

const radio = (label: string) =>
	screen.getByRole("radio", {
		name: new RegExp(`^${label}`),
	}) as HTMLInputElement;

describe("AcquisitionDialog", () => {
	it("pre-selects the suggestion, says where it came from, and tags with a note", async () => {
		const spy = primeSet();
		const onClose = vi.fn();
		render(
			<AcquisitionDialog
				seller={seller({
					signupSource: "referral-bearcamp",
					acquisition: { suggested: "referral" },
				})}
				onClose={onClose}
			/>,
		);
		expect(
			screen.getByText(/signed up through the referral-bearcamp link/),
		).toBeTruthy();
		expect(radio("Referral").checked).toBe(true);
		fireEvent.change(screen.getByLabelText(/Note/), {
			target: { value: "Intro from Khalil" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Tag as Referral" }));
		await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(spy).toHaveBeenCalledWith({
			retailerId: "r_new",
			source: "referral",
			note: "Intro from Khalil",
		});
	});

	it("with nothing to suggest, nothing is picked and save is disabled-with-label", () => {
		primeSet();
		render(<AcquisitionDialog seller={seller()} onClose={vi.fn()} />);
		const save = screen.getByRole("button", { name: "Pick a channel" });
		expect((save as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(radio("Walk-in"));
		expect(
			(
				screen.getByRole("button", {
					name: "Tag as Walk-in",
				}) as HTMLButtonElement
			).disabled,
		).toBe(false);
	});

	it("confirms the seller's own answer in one tap", async () => {
		const spy = primeSet();
		render(
			<AcquisitionDialog
				seller={seller({
					acquisition: {
						channel: "inbound_social",
						setBy: "seller",
						suggested: null,
					},
				})}
				onClose={vi.fn()}
			/>,
		);
		expect(screen.getByText(/The seller answered/)).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Confirm Social media" }),
		);
		await vi.waitFor(() =>
			expect(spy).toHaveBeenCalledWith({
				retailerId: "r_new",
				source: "inbound_social",
			}),
		);
	});

	it("an unchanged admin tag can't be re-saved", () => {
		primeSet();
		render(
			<AcquisitionDialog
				seller={seller({
					acquisition: {
						channel: "walk_in",
						setBy: "admin",
						note: "Bazaar",
						suggested: null,
					},
				})}
				onClose={vi.fn()}
			/>,
		);
		const save = screen.getByRole("button", { name: "Tag as Walk-in" });
		expect((save as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(radio("Talk or event"));
		expect(
			(
				screen.getByRole("button", {
					name: "Tag as Talk or event",
				}) as HTMLButtonElement
			).disabled,
		).toBe(false);
	});

	it("shows the server's refusal under the note and stays open", async () => {
		primeSet(() =>
			Promise.reject(new Error("Keep the note to 140 characters (it's 141).")),
		);
		const onClose = vi.fn();
		render(
			<AcquisitionDialog
				seller={seller({ acquisition: { suggested: "walk_in" } })}
				onClose={onClose}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Tag as Walk-in" }));
		expect(await screen.findByText(/140 characters/)).toBeTruthy();
		expect(onClose).not.toHaveBeenCalled();
	});
});

describe("AcquisitionCell", () => {
	const now = Date.UTC(2026, 9, 28);

	it("an admin tag shows the channel, the note and Change", () => {
		render(
			<AcquisitionCell
				seller={seller({
					acquisition: {
						channel: "talk_event",
						setBy: "admin",
						note: "Great Day Club talk",
						at: now - 3 * 86_400_000,
						suggested: null,
					},
				})}
				now={now}
			/>,
		);
		expect(screen.getByText("Talk or event")).toBeTruthy();
		expect(screen.getByText("Great Day Club talk")).toBeTruthy();
		expect(screen.getByText(/Tagged by Kedaipal/)).toBeTruthy();
		expect(screen.getByRole("button", { name: "Change" })).toBeTruthy();
	});

	it("a seller's answer says it isn't counted yet", () => {
		render(
			<AcquisitionCell
				seller={seller({
					acquisition: {
						channel: "inbound_social",
						setBy: "seller",
						suggested: null,
					},
				})}
				now={now}
			/>,
		);
		expect(screen.getByText(/Not counted towards CAC/)).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Confirm or change…" }),
		).toBeTruthy();
	});

	it("an untagged payer is warned about, with the suggestion named", () => {
		render(
			<AcquisitionCell
				seller={seller({ acquisition: { suggested: "product_led" } })}
				now={now}
			/>,
		);
		expect(screen.getByText(/missing from CAC/)).toBeTruthy();
		expect(screen.getByText("Product-led")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Tag channel…" }));
		expect(screen.getByRole("dialog")).toBeTruthy();
	});

	it("a store that hasn't paid yet is untagged without the CAC alarm", () => {
		render(
			<AcquisitionCell seller={seller({ hasPaidInvoice: false })} now={now} />,
		);
		expect(screen.getByText("Not tagged yet")).toBeTruthy();
		expect(screen.queryByText(/missing from CAC/)).toBeNull();
	});
});
