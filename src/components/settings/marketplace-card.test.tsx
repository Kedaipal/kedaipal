// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MarketplaceCard } from "./marketplace-card";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../hooks/useSupportWaNumber", () => ({
	useSupportWaNumber: () => "60123456789",
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
		<a href={to} {...rest}>
			{children}
		</a>
	),
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function renderCard(
	props: Partial<React.ComponentProps<typeof MarketplaceCard>> = {},
) {
	const onSave = vi.fn().mockResolvedValue(undefined);
	render(
		<MarketplaceCard
			storeName="Kedai Mak Su"
			unlisted={false}
			area=""
			readiness={{ hasVisibleProduct: true, internal: false, hidden: null }}
			onSave={onSave}
			{...props}
		/>,
	);
	return onSave;
}

describe("MarketplaceCard — the switch line tells the truth", () => {
	test("listed with a visible product: shown, and the switch flips it off", () => {
		const onSave = renderCard();
		expect(screen.getByText(/Shown in the directory/)).toBeTruthy();
		const toggle = screen.getByRole("switch", {
			name: /List my store on the Kedaipal marketplace/,
		});
		expect(toggle.getAttribute("aria-checked")).toBe("true");
		fireEvent.click(toggle);
		expect(onSave).toHaveBeenCalledWith({ marketplaceListed: false });
	});

	test("ON but no visible product: never claims to be shown, and points at the fix", () => {
		renderCard({
			readiness: { hasVisibleProduct: false, internal: false, hidden: null },
		});
		expect(screen.queryByText(/Shown in the directory/)).toBeNull();
		expect(screen.getByText(/not shown yet/)).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Add a product" }).getAttribute("href"),
		).toBe("/app/products/new");
	});

	test("still loading: says it's checking — undefined is not 'no'", () => {
		renderCard({ readiness: undefined });
		expect(screen.getByText(/Checking your listing/)).toBeTruthy();
		expect(screen.queryByText(/Shown in the directory/)).toBeNull();
		expect(screen.queryByText(/not shown yet/)).toBeNull();
	});

	test("opted out: hidden, with the direct-link reassurance, whatever the products", () => {
		renderCard({
			unlisted: true,
			readiness: { hasVisibleProduct: true, internal: false, hidden: null },
		});
		expect(
			screen.getByText(/buyers can still reach your direct link/i),
		).toBeTruthy();
		expect(
			screen
				.getByRole("switch", { name: /List my store/ })
				.getAttribute("aria-checked"),
		).toBe("false");
	});
});

describe("MarketplaceCard — internal stores", () => {
	test("a Kedaipal/test store is told it's never listed, even with the switch on and products live", () => {
		renderCard({
			readiness: { hasVisibleProduct: true, internal: true, hidden: null },
		});
		expect(screen.getByText(/never listed on the marketplace/)).toBeTruthy();
		expect(screen.queryByText(/Shown in the directory/)).toBeNull();
	});
});

describe("MarketplaceCard — hidden by Kedaipal", () => {
	test("says so, shows the admin's note, and links to us — never 'Shown in the directory'", () => {
		renderCard({
			readiness: {
				hasVisibleProduct: true,
				internal: false,
				hidden: { note: "Add real product photos and we'll relist you." },
			},
		});
		expect(screen.getByText(/Kedaipal has hidden your store/)).toBeTruthy();
		expect(
			screen.getByText(
				"Note from Kedaipal: Add real product photos and we'll relist you.",
			),
		).toBeTruthy();
		expect(screen.queryByText(/Shown in the directory/)).toBeNull();
		const ask = screen
			.getByRole("link", { name: /Ask us about it on WhatsApp/ })
			.getAttribute("href");
		expect(ask).toMatch(/^https:\/\/wa\.me\/60123456789\?text=/);
		expect(decodeURIComponent(ask ?? "")).toContain("Kedai Mak Su");
	});

	test("outranks the seller's own opt-out — flipping the switch would not list it", () => {
		renderCard({
			unlisted: true,
			readiness: { hasVisibleProduct: true, internal: false, hidden: {} },
		});
		expect(screen.getByText(/Kedaipal has hidden your store/)).toBeTruthy();
		expect(
			screen.queryByText(/buyers can still reach your direct link/i),
		).toBeNull();
		expect(screen.queryByText(/Note from Kedaipal/)).toBeNull();
	});

	test("the switch's toast says what the switch did, never that the store is shown", async () => {
		const onSave = renderCard({
			unlisted: true,
			readiness: { hasVisibleProduct: true, internal: false, hidden: {} },
		});
		fireEvent.click(screen.getByRole("switch", { name: /List my store/ }));
		expect(onSave).toHaveBeenCalledWith({ marketplaceListed: true });
		await waitFor(() =>
			expect(toast.success).toHaveBeenCalledWith(
				"Marketplace listing turned on.",
			),
		);
	});
});

describe("MarketplaceCard — area form", () => {
	test("saves the collapsed value and stops reading as unsaved afterwards", async () => {
		const onSave = renderCard();
		const field = screen.getByLabelText(
			"Area shown on your card",
		) as HTMLInputElement;
		const save = screen.getByRole("button", { name: "Save area" });
		expect(save.hasAttribute("disabled")).toBe(true);
		fireEvent.change(field, { target: { value: "  Ampang,   KL " } });
		expect(save.hasAttribute("disabled")).toBe(false);
		fireEvent.click(save);
		expect(onSave).toHaveBeenCalledWith({ storeArea: "Ampang, KL" });
		// The field now shows what the server stored.
		await waitFor(() => expect(field.value).toBe("Ampang, KL"));
	});

	test("whitespace-only edits of the saved value are not a change", () => {
		renderCard({ area: "Ampang, KL" });
		fireEvent.change(screen.getByLabelText("Area shown on your card"), {
			target: { value: "Ampang,    KL  " },
		});
		expect(
			screen
				.getByRole("button", { name: "Save area" })
				.hasAttribute("disabled"),
		).toBe(true);
	});

	test("the card links to the live marketplace page", () => {
		renderCard();
		const link = screen.getByRole("link", { name: /kedaipal\.com\/stores/ });
		expect(link.getAttribute("href")).toBe("/stores");
	});
});
