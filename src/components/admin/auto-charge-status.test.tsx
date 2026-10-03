// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AutoChargeDescription } from "../../lib/auto-charge-status";
import { AutoChargeDetail, AutoChargePill } from "./auto-charge-status";

afterEach(cleanup);

const stopped: AutoChargeDescription = {
	tone: "stopped",
	pill: "Auto-charge stopped",
	lead: "HitPay took RM 149.00 for voided INV-OLD — never recorded here.",
	detail: "Decide with the seller: refund it in HitPay, or apply it…",
	reference: "reconciled:rb_1:3",
};
const healthy: AutoChargeDescription = {
	tone: "healthy",
	pill: "Auto-renew",
	detail: null,
};

describe("AutoChargePill / AutoChargeDetail — one control for both admin lists", () => {
	it("stopped wears its alert icon; the fact leads in red, then the way out, then a copyable ref", () => {
		const { container } = render(
			<>
				<AutoChargePill description={stopped} />
				<AutoChargeDetail description={stopped} />
			</>,
		);
		expect(screen.getByText("Auto-charge stopped")).toBeTruthy();
		// The icon is decorative (the words carry the meaning) and hidden from AT.
		expect(container.querySelector("svg[aria-hidden]")).toBeTruthy();
		expect(screen.getByText(/voided INV-OLD/).className).toContain(
			"text-red-600",
		);
		expect(screen.getByText(/Decide with the seller/).className).toContain(
			"text-muted-foreground",
		);
		expect(screen.getByText("reconciled:rb_1:3").tagName).toBe("CODE");
		expect(
			screen.getByRole("button", { name: "Copy the HitPay reference" }),
		).toBeTruthy();
	});

	it("healthy shows the Auto-renew pill — unless the list is ALL auto-renew", () => {
		const { rerender } = render(<AutoChargePill description={healthy} />);
		expect(screen.getByText("Auto-renew")).toBeTruthy();
		rerender(<AutoChargePill description={healthy} showHealthy={false} />);
		expect(screen.queryByText("Auto-renew")).toBeNull();
	});

	it("no detail, no line — and no ref row for a state that has none", () => {
		const { container } = render(<AutoChargeDetail description={healthy} />);
		expect(container.textContent).toBe("");
		cleanup();
		render(
			<AutoChargeDetail
				description={{
					tone: "failed",
					pill: "Auto-charge failed ×1",
					detail: "Last error: x. Next retry 3 Oct 2026.",
				}}
			/>,
		);
		expect(screen.queryByText("HitPay ref")).toBeNull();
	});
});
