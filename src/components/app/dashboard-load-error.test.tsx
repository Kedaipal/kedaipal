// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardLoadError } from "./dashboard-load-error";

const { signOutSpy, reloadSpy } = vi.hoisted(() => ({
	signOutSpy: vi.fn(),
	reloadSpy: vi.fn(),
}));
vi.mock("@clerk/tanstack-react-start", () => ({
	useClerk: () => ({ signOut: signOutSpy }),
}));
vi.mock("../../hooks/useSupportWaNumber", () => ({
	useSupportWaNumber: () => "60123456789",
}));
vi.mock("../../lib/reload", () => ({ reloadPage: reloadSpy }));

afterEach(() => {
	cleanup();
	signOutSpy.mockReset();
	reloadSpy.mockReset();
});

const failure = new Error("[CONVEX Q(retailers:getMyRetailer)] Server Error");

describe("DashboardLoadError — the store didn't load, and here is the way out", () => {
	it("tells a seller in a sentence, with Reload first", () => {
		render(
			<DashboardLoadError
				error={failure}
				actingAs={false}
				onExitActAs={vi.fn()}
			/>,
		);
		expect(
			screen.getByRole("heading", { name: "Your dashboard didn't load" }),
		).toBeTruthy();
		expect(screen.getByText(/couldn't load your store just now/i)).toBeTruthy();
		const [first] = screen.getAllByRole("button");
		expect(first.textContent).toBe("Reload");
		fireEvent.click(first);
		expect(reloadSpy).toHaveBeenCalledOnce();
	});

	it("lets a seller sign out — an account that can't reach its store isn't stuck", () => {
		render(
			<DashboardLoadError
				error={failure}
				actingAs={false}
				onExitActAs={vi.fn()}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
		expect(signOutSpy).toHaveBeenCalledWith({ redirectUrl: "/" });
	});

	it("gives a seller our WhatsApp when neither works", () => {
		render(
			<DashboardLoadError
				error={failure}
				actingAs={false}
				onExitActAs={vi.fn()}
			/>,
		);
		const link = screen.getByRole("link", { name: /message us on whatsapp/i });
		expect(link.getAttribute("href")).toMatch(
			/^https:\/\/wa\.me\/60123456789\?text=/,
		);
		expect(link.getAttribute("target")).toBe("_blank");
	});

	it("an admin acting as a store gets Exit act-as first, and no seller-only exits", () => {
		const exit = vi.fn();
		render(<DashboardLoadError error={failure} actingAs onExitActAs={exit} />);
		expect(
			screen.getByRole("heading", { name: "Couldn't open this store" }),
		).toBeTruthy();
		const [first] = screen.getAllByRole("button");
		expect(first.textContent).toBe("Exit act-as");
		fireEvent.click(first);
		expect(exit).toHaveBeenCalledOnce();
		expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
		expect(screen.queryByRole("link")).toBeNull();
	});
});
