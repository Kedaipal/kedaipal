// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { previewDiscount, VoucherField } from "./voucher-field";

// `checkCode` is a mutation (it spends rate-limiter budget — see
// convex/vouchers.ts), so the field reaches Convex through useMutation only.
const checkCode = vi.fn();
vi.mock("convex/react", () => ({ useMutation: () => checkCode }));

const RETAILER = "r1" as Id<"retailers">;

afterEach(cleanup);
// BRACED body on purpose: `() => checkCode.mockReset()` RETURNS the mock,
// which vitest takes as the hook's result and then reports the next rejected
// mock as the test's own error (cost an hour here — the behaviour was right,
// the hook's return value was not).
beforeEach(() => {
	checkCode.mockReset();
});

function renderField(props: Partial<Parameters<typeof VoucherField>[0]> = {}) {
	const onApply = vi.fn();
	const onRemove = vi.fn();
	const view = render(
		<VoucherField
			retailerId={RETAILER}
			currency="MYR"
			itemSubtotal={5000}
			applied={null}
			onApply={onApply}
			onRemove={onRemove}
			{...props}
		/>,
	);
	return { ...view, onApply, onRemove };
}

describe("collapsed by default", () => {
	it("is one quiet line, not an open field on every checkout", () => {
		renderField();
		expect(
			screen.getByRole("button", { name: /have a voucher/i }),
		).toBeTruthy();
		expect(screen.queryByLabelText("Voucher code")).toBeNull();
	});

	it("opens on tap", () => {
		renderField();
		fireEvent.click(screen.getByRole("button", { name: /have a voucher/i }));
		expect(screen.getByLabelText("Voucher code")).toBeTruthy();
	});

	it("opens ALREADY OPEN when a code arrived on the link", () => {
		checkCode.mockResolvedValue({ ok: false, refusal: "not_found" });
		renderField({ initialCode: "KP-7F3K-Q2WM" });
		// A link-borne code must be visible and removable, never a mystery
		// discount (or a mystery non-discount) on the total.
		expect(screen.getByLabelText("Voucher code")).toBeTruthy();
	});
});

describe("applying a code", () => {
	it("refuses to call the server on something that can't be a code", () => {
		renderField();
		fireEvent.click(screen.getByRole("button", { name: /have a voucher/i }));
		fireEvent.change(screen.getByLabelText("Voucher code"), {
			target: { value: "hello" },
		});
		expect(screen.getByRole("button", { name: "Apply" })).toHaveProperty(
			"disabled",
			true,
		);
		expect(checkCode).not.toHaveBeenCalled();
	});

	it("hands back the CANONICAL code and terms on success", async () => {
		checkCode.mockResolvedValue({
			ok: true,
			code: "KP-7F3K-Q2WM",
			terms: { kind: "fixed", value: 1000 },
		});
		const { onApply } = renderField();
		fireEvent.click(screen.getByRole("button", { name: /have a voucher/i }));
		// Typed carelessly — the field corrects it in place.
		fireEvent.change(screen.getByLabelText("Voucher code"), {
			target: { value: "kp7f3kq2wm" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Apply" }));
		await waitFor(() =>
			expect(onApply).toHaveBeenCalledWith({
				code: "KP-7F3K-Q2WM",
				kind: "fixed",
				value: 1000,
			}),
		);
	});

	it("shows a refusal UNDER THE FIELD, never as a page error", async () => {
		checkCode.mockResolvedValue({
			ok: false,
			refusal: "redeemed",
			usedOnOrder: "ORD-7F3K",
		});
		const { onApply } = renderField();
		fireEvent.click(screen.getByRole("button", { name: /have a voucher/i }));
		fireEvent.change(screen.getByLabelText("Voucher code"), {
			target: { value: "KP-7F3K-Q2WM" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Apply" }));
		// Named, and it names the order — the refusal a buyer most often argues
		// with.
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain("ORD-7F3K");
		expect(onApply).not.toHaveBeenCalled();
	});

	it("a failed check never blocks the checkout", async () => {
		// An explicit rejected promise, not `async () => { throw }` — vitest
		// reports a throw inside an async mock body as its own test failure.
		checkCode.mockImplementation(() =>
			Promise.reject(new Error("rate limited")),
		);
		renderField();
		fireEvent.click(screen.getByRole("button", { name: /have a voucher/i }));
		fireEvent.change(screen.getByLabelText("Voucher code"), {
			target: { value: "KP-7F3K-Q2WM" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Apply" }));
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toMatch(/try again/i);
	});

	it("Enter applies, so the code can be keyed without reaching for the button", async () => {
		checkCode.mockResolvedValue({
			ok: true,
			code: "KP-7F3K-Q2WM",
			terms: { kind: "percent", value: 10 },
		});
		const { onApply } = renderField();
		fireEvent.click(screen.getByRole("button", { name: /have a voucher/i }));
		const input = screen.getByLabelText("Voucher code");
		fireEvent.change(input, { target: { value: "KP-7F3K-Q2WM" } });
		fireEvent.keyDown(input, { key: "Enter" });
		await waitFor(() => expect(onApply).toHaveBeenCalled());
	});
});

describe("the applied state", () => {
	const applied = { code: "KP-7F3K-Q2WM", kind: "fixed" as const, value: 1000 };

	it("states what is on, and is removable in place", () => {
		const { onRemove } = renderField({ applied });
		expect(screen.getByText(/RM.?10\.00 off applied/)).toBeTruthy();
		expect(screen.getByText("KP-7F3K-Q2WM")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: /remove voucher KP-7F3K-Q2WM/i }),
		);
		expect(onRemove).toHaveBeenCalled();
	});

	it("a percentage reads as a percentage, not a currency amount", () => {
		renderField({
			applied: { code: "KP-AAAA-BBBB", kind: "percent", value: 15 },
		});
		expect(screen.getByText(/15% off applied/)).toBeTruthy();
	});

	it("disabled hides the way out of nothing — Remove stays visible but inert", () => {
		renderField({ applied, disabled: true });
		expect(
			screen.getByRole("button", { name: /remove voucher/i }),
		).toHaveProperty("disabled", true);
	});
});

describe("previewDiscount — the shared preview", () => {
	it("is the server's maths, so the two totals can't drift", () => {
		expect(
			previewDiscount({ code: "c", kind: "fixed", value: 1000 }, 5000),
		).toBe(1000);
		expect(
			previewDiscount({ code: "c", kind: "percent", value: 10 }, 5000),
		).toBe(500);
		// Clamped to the item subtotal — the fees are never eaten.
		expect(
			previewDiscount({ code: "c", kind: "fixed", value: 9999 }, 3000),
		).toBe(3000);
		expect(previewDiscount(null, 5000)).toBe(0);
	});
});
