// @vitest-environment jsdom
// WHO gets asked to accept the legal documents.
//
// The banner is owner-only, and that is a correctness rule, not a preference:
// `recordConsentAcceptance` resolves the store `by_user` on the CALLER, so
// anyone who is not the owner either cannot answer the ask or — worse —
// answers it against a different store. Both ways of showing it to the wrong
// person were found by driving the app (2 Oct), not by reading it.

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

const viewer = { role: "owner" as "owner" | "member" | "admin" | undefined };
vi.mock("../../hooks/usePermission", () => ({
	useStoreRole: () => viewer.role,
}));

const { ConsentBanner } = await import("./consent-banner");
const { TERMS_VERSION, PRIVACY_VERSION, AUP_VERSION } = await import(
	"../../../convex/lib/legal"
);

/** Versions that are definitely stale, so the banner wants to render. */
const STALE = {
	termsVersion: "1970-01-01",
	privacyVersion: "1970-01-01",
	aupVersion: "1970-01-01",
};

afterEach(() => {
	cleanup();
	viewer.role = "owner";
});

describe("ConsentBanner — only the owner is ever asked", () => {
	test("the owner sees it when their consent is stale", () => {
		viewer.role = "owner";
		render(<ConsentBanner versions={STALE} />);
		expect(screen.getByRole("button", { name: /i accept/i })).toBeTruthy();
	});

	test("a team member never sees it — terms bind the account holder", () => {
		viewer.role = "member";
		const { container } = render(<ConsentBanner versions={STALE} />);
		expect(container.innerHTML).toBe("");
	});

	test("an ADMIN in act-as never sees it — the click would hit their OWN store", () => {
		// Verified live: accepting while acting-as re-stamped the admin's own
		// store, left the acted-on store untouched, and parked the button on
		// "Saving…" forever because the banner's own condition never cleared.
		// This also covers a PRE-BUILT store, which has no consent stamps by
		// design (docs/prebuilt-stores.md) and so would otherwise show the ask on
		// every page — asking an admin to agree on behalf of someone who has not
		// seen the terms.
		viewer.role = "admin";
		const { container } = render(<ConsentBanner versions={STALE} />);
		expect(container.innerHTML).toBe("");
	});

	test("nothing renders while the role is still loading", () => {
		// `useStoreRole` answers undefined until the store payload lands; an
		// optimistic render would flash a legal ask at everyone.
		viewer.role = undefined;
		const { container } = render(<ConsentBanner versions={STALE} />);
		expect(container.innerHTML).toBe("");
	});

	test("an owner whose consent is current sees nothing", () => {
		viewer.role = "owner";
		const { container } = render(
			<ConsentBanner
				versions={{
					termsVersion: TERMS_VERSION,
					privacyVersion: PRIVACY_VERSION,
					aupVersion: AUP_VERSION,
				}}
			/>,
		);
		expect(container.innerHTML).toBe("");
	});
});
