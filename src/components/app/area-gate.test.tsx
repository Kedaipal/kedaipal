// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AreaGate } from "./area-gate";

// `usePermission` is the seam the whole gate turns on — stub it rather than
// standing up an ActAsProvider and a retailer payload.
const viewer = {
	role: "member" as "owner" | "member" | "admin",
	canRead: true,
	canWrite: false,
};
vi.mock("../../hooks/usePermission", () => ({
	useStoreRole: () => viewer.role,
	useIsStoreOwner: () => viewer.role !== "member",
	usePermission: () => ({
		canRead: viewer.canRead,
		canWrite: viewer.canWrite,
		role: viewer.role,
	}),
}));

afterEach(() => {
	viewer.role = "member";
	viewer.canRead = true;
	viewer.canWrite = false;
	cleanup();
});

const BODY = "the tab body";

describe("AreaGate", () => {
	it("hands the body straight through for an owner", () => {
		viewer.role = "owner";
		viewer.canWrite = true;
		render(
			<AreaGate area="payments_settings">
				<p>{BODY}</p>
			</AreaGate>,
		);
		expect(screen.getByText(BODY)).toBeTruthy();
		expect(screen.queryByText(/ask the owner/i)).toBeNull();
	});

	it("a member with VIEW gets the body, disabled, under the reason", () => {
		render(
			<AreaGate area="payments_settings">
				<p>{BODY}</p>
			</AreaGate>,
		);
		expect(screen.getByText(BODY)).toBeTruthy();
		expect(
			(document.querySelector("fieldset") as HTMLFieldSetElement).disabled,
		).toBe(true);
		expect(screen.getByText(/but not change it/i)).toBeTruthy();
	});

	// The body's own queries are gated on the same grant the gate is, so
	// mounting it would print "you don't have access" above a panel of
	// skeletons that never resolve.
	it("a member with NO read gets the note alone — the body never mounts", () => {
		viewer.canRead = false;
		render(
			<AreaGate area="payments_settings">
				<p>{BODY}</p>
			</AreaGate>,
		);
		expect(screen.queryByText(BODY)).toBeNull();
		expect(document.querySelector("fieldset")).toBeNull();
		expect(
			screen.getByText(/don't have access to payment details/i),
		).toBeTruthy();
	});

	// Billing is capped at VIEW by the registry, so "ask the owner for edit
	// access" would send a teammate after a grant the Team page cannot give —
	// and would contradict the tab's own note once they were inside it.
	it("names a read-capped area as view-only instead of asking for the impossible", () => {
		render(
			<AreaGate area="billing">
				<p>{BODY}</p>
			</AreaGate>,
		);
		expect(screen.getByText(/view-only for teammates/i)).toBeTruthy();
		expect(screen.queryByText(/ask the owner for edit access/i)).toBeNull();
	});

	// The WhatsApp tab: the reader HAS the data, it just isn't theirs to
	// change, so the body still renders (disabled) whatever their grants.
	it("an owner-only tab still shows its body to a member", () => {
		viewer.canRead = false;
		render(
			<AreaGate area="store_settings" ownerOnly>
				<p>{BODY}</p>
			</AreaGate>,
		);
		expect(screen.getByText(BODY)).toBeTruthy();
		expect(
			screen.getByText(/Only the store owner can change this/i),
		).toBeTruthy();
	});
});
