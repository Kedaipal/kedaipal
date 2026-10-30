// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	type AppliedVoucher,
	previewDiscount,
	usePerBuyerRecheck,
	VoucherField,
	VoucherNotes,
	voucherCodeForOrder,
} from "./voucher-field";

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
		// Too short to be a single-use code OR a shared word (`z8r3fducfm`) —
		// "hello" would be a plausible shared code and must reach the server.
		fireEvent.change(screen.getByLabelText("Voucher code"), {
			target: { value: "hi" },
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

	it("a shared WORD is a code too — it reaches the server and comes back canonical", async () => {
		// `z8r3fducfm`: the field is ONE control for both spellings.
		checkCode.mockResolvedValue({
			ok: true,
			code: "SALE345",
			terms: { kind: "percent", value: 20 },
		});
		const { onApply } = renderField();
		fireEvent.click(screen.getByRole("button", { name: /have a voucher/i }));
		fireEvent.change(screen.getByLabelText("Voucher code"), {
			target: { value: "sale 345" },
		});
		expect(screen.getByRole("button", { name: "Apply" })).toHaveProperty(
			"disabled",
			false,
		);
		fireEvent.click(screen.getByRole("button", { name: "Apply" }));
		await waitFor(() =>
			expect(onApply).toHaveBeenCalledWith({
				code: "SALE345",
				kind: "percent",
				value: 20,
			}),
		);
		expect(checkCode).toHaveBeenCalledWith({
			retailerId: RETAILER,
			code: "sale 345",
		});
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

/**
 * The RECEIPT skin (`z8r3fdr617`, Zaki 12 Oct). Same control, same states,
 * same refusal copy — different house. What must be true of it is that it
 * stops introducing form chrome into a printed ticket, and that the applied
 * state no longer repeats what the receipt's own voucher line already says.
 */
describe("the receipt skin", () => {
	it("closes to a ticket-caption action, not a chrome link", () => {
		renderField({ variant: "receipt" });
		const open = screen.getByRole("button", { name: /voucher code/i });
		expect(open.className).toContain("font-mono");
		expect(open.className).toContain("uppercase");
	});

	it("opens to a mono field with a stamped Apply — no Input chrome", () => {
		renderField({ variant: "receipt" });
		fireEvent.click(screen.getByRole("button", { name: /voucher code/i }));
		const input = screen.getByLabelText("Voucher code");
		expect(input.className).toContain("font-mono");
		// The ticket's rows are dotted leaders; a bordered box is the thing
		// that read as "a form dropped on a receipt".
		expect(input.className).toContain("border-dotted");
		expect(input.className).not.toContain("rounded-xl");
		expect(screen.getByRole("button", { name: "Apply" }).className).toContain(
			"tracking-[0.14em]",
		);
	});

	it("applied shows ONLY the way out — the receipt line states the rest", () => {
		renderField({
			variant: "receipt",
			applied: { code: "KP-7F3K-Q2WM", kind: "fixed", value: 1000 },
		});
		// The green panel and its "RM10.00 off applied" headline are gone; the
		// caller renders the discount as a receipt line instead.
		expect(screen.queryByText(/off applied/)).toBeNull();
		expect(
			screen.getByRole("button", { name: /remove voucher KP-7F3K-Q2WM/i }),
		).toBeTruthy();
	});

	it("still refuses with the shared sentence, under the field", async () => {
		checkCode.mockResolvedValue({ ok: false, refusal: "voided" });
		renderField({ variant: "receipt" });
		fireEvent.click(screen.getByRole("button", { name: /voucher code/i }));
		fireEvent.change(screen.getByLabelText("Voucher code"), {
			target: { value: "KP-7F3K-Q2WM" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Apply" }));
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toMatch(/no longer valid/i);
		expect(alert.className).toContain("font-mono");
	});

	it("the PANEL skin keeps its own chrome", () => {
		// The counter is a dashboard surface; the receipt grammar would be as
		// wrong there as the chrome was on the ticket.
		renderField({
			applied: { code: "KP-7F3K-Q2WM", kind: "fixed", value: 1000 },
		});
		expect(screen.getByText(/off applied/)).toBeTruthy();
	});
});

/**
 * A refusal from the ORDER DOOR, not the field (`z8r3fdr617`, PR #357
 * review). The door re-validates, so it can refuse a code the field checked
 * happily a minute earlier — someone else spent it, the seller voided it.
 *
 * It used to land as a page-level banner while the applied line and its
 * discount stayed drawn on the ticket, so the buyer read a total nobody was
 * going to charge them. The parent now removes the voucher (which corrects
 * the total on the spot) and hands the sentence here, where they applied it.
 */
describe("a refusal handed back by the order door", () => {
	it("opens the field and states the reason", () => {
		renderField({ serverRefusal: "This voucher has already been used." });
		expect(
			screen.getByText("This voucher has already been used."),
		).toBeDefined();
		// Open, not collapsed — the sentence has nowhere else to sit.
		expect(screen.getByLabelText("Voucher code")).toBeDefined();
	});

	it("is not shown when the door said nothing", () => {
		renderField();
		expect(screen.queryByLabelText("Voucher code")).toBeNull();
	});

	it("yields to the field's own answer once the buyer types again", async () => {
		// The buyer has acted since the server spoke, so the newer sentence is
		// the true one — a stale refusal must not sit under a fresh attempt.
		checkCode.mockResolvedValue({ ok: false, refusal: "expired" });
		renderField({ serverRefusal: "This voucher has already been used." });
		fireEvent.change(screen.getByLabelText("Voucher code"), {
			target: { value: "KP-7F3K-Q2WM" },
		});
		fireEvent.click(screen.getByRole("button", { name: /apply/i }));
		await waitFor(() =>
			expect(screen.getByText("This voucher has expired.")).toBeDefined(),
		);
		expect(
			screen.queryByText("This voucher has already been used."),
		).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Shared codes v2 (`z8r3fdz0pw`)
// ---------------------------------------------------------------------------

const PER_BUYER: AppliedVoucher = {
	code: "SALE345",
	kind: "percent",
	value: 20,
	conditions: { perBuyerLimit: 1 },
};
const ALI = {
	waPhone: "012-345 6789",
	waDialCountry: "MY",
	digits: "60123456789",
	label: "012-345 6789",
};

describe("the minimum spend, judged against the live basket", () => {
	const MIN: AppliedVoucher = {
		code: "SALE345",
		kind: "fixed",
		value: 1000,
		conditions: { minSpend: 6000 },
	};

	it("stays applied but takes nothing off, and isn't sent, until it qualifies", () => {
		expect(previewDiscount(MIN, 5000)).toBe(0);
		expect(voucherCodeForOrder(MIN, 5000)).toBeUndefined();
		expect(previewDiscount(MIN, 6000)).toBe(1000);
		expect(voucherCodeForOrder(MIN, 6000)).toBe("SALE345");
		expect(voucherCodeForOrder(null, 9000)).toBeUndefined();
	});

	it("says how much more, with the number, under the voucher line", () => {
		render(<VoucherNotes applied={MIN} itemSubtotal={4800} currency="MYR" />);
		expect(
			screen.getByText(
				/Add RM\s12\.00 more to use SALE345 — it needs RM\s60\.00 of items\./,
			),
		).toBeTruthy();
	});
});

describe("the per-order cap", () => {
	it("clamps the preview exactly as the server does", () => {
		expect(
			previewDiscount(
				{ code: "BIG50", kind: "percent", value: 50, maxDiscount: 2000 },
				10_000,
			),
		).toBe(2000);
	});

	it("is printed as fine print on the applied code", () => {
		render(
			<VoucherNotes
				applied={{
					code: "BIG50",
					kind: "percent",
					value: 50,
					maxDiscount: 2000,
				}}
				itemSubtotal={10_000}
				currency="MYR"
			/>,
		);
		expect(screen.getByText(/up to RM\s20\.00 off/)).toBeTruthy();
	});
});

describe("the per-buyer limit — flow A (Zaki, 30 Oct 2026)", () => {
	it("applies before the number, and the ticket note says it will be checked", () => {
		render(
			<VoucherNotes applied={PER_BUYER} itemSubtotal={5000} currency="MYR" />,
		);
		expect(
			screen.getByText("1 per buyer · checked against your WhatsApp number"),
		).toBeTruthy();
		expect(checkCode).not.toHaveBeenCalled();
	});

	it("says which number it was checked for — and only for the number on the page", () => {
		render(
			<VoucherNotes
				applied={{ ...PER_BUYER, checkedFor: ALI.digits }}
				itemSubtotal={5000}
				currency="MYR"
				buyer={ALI}
			/>,
		);
		expect(
			screen.getByText("✓ 1 per buyer · checked for 012-345 6789"),
		).toBeTruthy();
		cleanup();
		render(
			<VoucherNotes
				applied={{ ...PER_BUYER, checkedFor: ALI.digits }}
				itemSubtotal={5000}
				currency="MYR"
				buyer={{ ...ALI, digits: "60198765432", label: "019-876 5432" }}
			/>,
		);
		expect(
			screen.getByText("1 per buyer · checked against your WhatsApp number"),
		).toBeTruthy();
	});

	/** A page that owns the voucher, as the storefront does. */
	function Page({ buyer }: { buyer?: typeof ALI }) {
		const [applied, setApplied] = useState<AppliedVoucher | null>(PER_BUYER);
		const [refusal, setRefusal] = useState<string | undefined>();
		usePerBuyerRecheck({
			retailerId: RETAILER,
			applied,
			buyer,
			onApply: setApplied,
			onRefused: (message) => {
				setApplied(null);
				setRefusal(message);
			},
		});
		return (
			<>
				<p data-testid="applied">{applied ? applied.code : "none"}</p>
				<p data-testid="checked">{applied?.checkedFor ?? ""}</p>
				<p data-testid="refusal">{refusal ?? ""}</p>
			</>
		);
	}

	it("the re-check runs with no field mounted — the page owns it", async () => {
		checkCode.mockResolvedValue({
			ok: true,
			code: "SALE345",
			terms: { kind: "percent", value: 20 },
			conditions: { perBuyerLimit: 1 },
			checkedFor: ALI.digits,
		});
		render(<Page buyer={ALI} />);
		await waitFor(() =>
			expect(screen.getByTestId("checked").textContent).toBe(ALI.digits),
		);
		expect(checkCode).toHaveBeenCalledTimes(1);
		expect(checkCode.mock.calls[0][0]).toMatchObject({
			code: "SALE345",
			waPhone: ALI.waPhone,
			waDialCountry: "MY",
		});
	});

	it("waits for a number — nothing is spent on a buyer who hasn't typed one", () => {
		render(<Page />);
		expect(checkCode).not.toHaveBeenCalled();
	});

	it("a number that has used it takes the code OFF, with the reason", async () => {
		checkCode.mockResolvedValue({
			ok: false,
			refusal: "buyer_limit",
			detail: { perBuyerLimit: 1 },
		});
		render(<Page buyer={ALI} />);
		await waitFor(() =>
			expect(screen.getByTestId("applied").textContent).toBe("none"),
		);
		expect(screen.getByTestId("refusal").textContent).toBe(
			"This WhatsApp number has already used this code — it's 1 per buyer.",
		);
	});

	it("the field puts a refused code back in the box, so the sentence is about it", () => {
		renderField({
			variant: "receipt",
			serverRefusal:
				"This WhatsApp number has already used this code — it's 1 per buyer.",
			refusedCode: "SALE345",
		});
		expect(screen.getByLabelText("Voucher code")).toHaveProperty(
			"value",
			"SALE345",
		);
	});

	it("a code with no per-buyer limit is never re-checked", () => {
		function Open() {
			usePerBuyerRecheck({
				retailerId: RETAILER,
				applied: { code: "OPEN20", kind: "percent", value: 20 },
				buyer: ALI,
				onApply: () => {},
				onRefused: () => {},
			});
			return null;
		}
		render(<Open />);
		expect(checkCode).not.toHaveBeenCalled();
	});

	it("the counter's anonymous sale is told the use counts toward the total only", () => {
		renderField({ applied: PER_BUYER, anonymousBuyer: true });
		expect(
			screen.getByText(
				/no buyer number, so it counts toward the code's total only/,
			),
		).toBeTruthy();
	});

	it("passes a known buyer's number with the first check", async () => {
		checkCode.mockResolvedValue({
			ok: true,
			code: "SALE345",
			terms: { kind: "percent", value: 20 },
			conditions: { perBuyerLimit: 1 },
			checkedFor: ALI.digits,
		});
		renderField({ buyer: ALI });
		fireEvent.click(screen.getByRole("button", { name: /have a voucher/i }));
		fireEvent.change(screen.getByLabelText("Voucher code"), {
			target: { value: "sale345" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Apply" }));
		await waitFor(() => expect(checkCode).toHaveBeenCalled());
		expect(checkCode.mock.calls[0][0]).toMatchObject({ waPhone: ALI.waPhone });
	});
});
