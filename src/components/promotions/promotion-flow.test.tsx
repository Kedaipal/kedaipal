// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PickerCatalog } from "./product-picker";

/**
 * The bulk promotion flow end to end on the client (`z8r3fducfd`): what the
 * seller ticks and types is exactly what reaches the server — the products
 * with something on sale, the moves they named, the prices they saw.
 */

const createMock = vi.fn(async (_args: unknown) => "promo1");
const updateMock = vi.fn(async (_args: unknown) => undefined);
vi.mock("convex/react", () => ({
	useMutation: (ref: unknown) =>
		String(ref).includes("update") ? updateMock : createMock,
}));
vi.mock("../../../convex/_generated/api", () => ({
	api: {
		promotions: {
			create: "promotions:create",
			update: "promotions:update",
			addProducts: "promotions:addProducts",
		},
	},
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
	useNavigate: () => () => {},
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { PromotionFlow } = await import("./promotion-flow");

beforeEach(() => {
	createMock.mockClear();
	updateMock.mockClear();
	window.scrollTo = () => {};
});
afterEach(cleanup);

const line = (id: string, price: number, promoPrice?: number) => ({
	_id: id,
	label: "",
	price,
	promoPrice,
	active: true,
});

const catalog = {
	categories: [],
	products: [
		{
			_id: "a",
			name: "Kuih lapis",
			isBooking: false,
			isEvent: false,
			categoryIds: [],
			variants: [line("va", 2000)],
			inThisPromotion: false,
			elsewhere: null,
			ownSale: null,
		},
		{
			_id: "q",
			name: "Custom cake",
			isBooking: false,
			isEvent: false,
			categoryIds: [],
			variants: [line("vq", 0)],
			inThisPromotion: false,
			elsewhere: null,
			ownSale: null,
		},
		{
			_id: "d",
			name: "Pandan cake",
			isBooking: false,
			isEvent: false,
			categoryIds: [],
			variants: [line("vd", 5000)],
			inThisPromotion: false,
			elsewhere: { promotionId: "x", label: "Raya Sale", endsAt: undefined },
			ownSale: null,
		},
	],
} as unknown as PickerCatalog;

const base = {
	retailerId: "r1" as never,
	currency: "MYR",
	catalog,
	blockedReason: null,
};

describe("create", () => {
	it("the next step is off with its reason until something is picked", () => {
		render(<PromotionFlow {...base} mode="create" />);
		const next = screen.getByRole("button", { name: "Next: set the discount" });
		expect((next as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByText("Pick at least one product.")).toBeTruthy();
	});

	it("sends the priced products and the named move — and leaves out one with nothing on sale", async () => {
		render(<PromotionFlow {...base} mode="create" />);
		fireEvent.click(screen.getByLabelText(/^All products/));
		fireEvent.click(screen.getByRole("button", { name: "Move here" }));
		fireEvent.click(
			screen.getByRole("button", { name: "Next: set the discount" }),
		);
		fireEvent.click(screen.getByRole("button", { name: "30% off" }));
		fireEvent.click(screen.getByRole("button", { name: /Next: review/ }));

		expect(
			screen.getByText(/Left out — nothing on it can go on sale/),
		).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: /^Start .* on 2 products$/ }),
		);
		await vi.waitFor(() => expect(createMock).toHaveBeenCalled());

		const args = createMock.mock.calls[0][0] as {
			percentOff: number;
			members: Array<{ productId: string; prices: unknown[] }>;
			move: string[];
		};
		expect(args.percentOff).toBe(30);
		expect(args.members).toEqual([
			{ productId: "a", prices: [{ variantId: "va", promoPrice: 1400 }] },
			{ productId: "d", prices: [{ variantId: "vd", promoPrice: 3500 }] },
		]);
		expect(args.move).toEqual(["d"]);
	});
});

describe("edit", () => {
	const promotion = {
		_id: "promo1",
		_creationTime: 0,
		retailerId: "r1",
		label: "Happy Hour",
		percentOff: 20,
		startsAt: Date.now() - 60_000,
		endsAt: Date.now() + 3_600_000,
		createdAt: 0,
		updatedAt: 0,
	} as never;
	const members = [
		{
			_id: "a",
			name: "Kuih lapis",
			isBooking: false,
			isEvent: false,
			variants: [line("va", 2000, 1500)],
		},
	];

	it("starts from the live prices, and a new percent re-prices every line and says so", async () => {
		render(
			<PromotionFlow
				{...base}
				mode="edit"
				promotion={promotion}
				members={members}
				seedPrices={{ va: "15.00" }}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "50% off" }));
		fireEvent.click(screen.getByRole("button", { name: /Next: review/ }));
		expect(screen.getByText(/Prices recalculated at 50% off/)).toBeTruthy();
		expect(
			(screen.getByLabelText("Sale price for Kuih lapis") as HTMLInputElement)
				.value,
		).toBe("10.00");

		fireEvent.click(screen.getByRole("button", { name: /^Update Happy Hour/ }));
		await vi.waitFor(() => expect(updateMock).toHaveBeenCalled());
		const args = updateMock.mock.calls[0][0] as {
			members: Array<{ prices: Array<{ promoPrice: number }> }>;
		};
		expect(args.members[0].prices[0].promoPrice).toBe(1000);
	});

	it("keeps the live price when the percent is left alone", async () => {
		render(
			<PromotionFlow
				{...base}
				mode="edit"
				promotion={promotion}
				members={members}
				seedPrices={{ va: "15.00" }}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: /Next: review/ }));
		expect(
			(screen.getByLabelText("Sale price for Kuih lapis") as HTMLInputElement)
				.value,
		).toBe("15.00");
	});
});
