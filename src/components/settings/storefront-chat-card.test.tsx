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
import { StorefrontChatCard } from "./storefront-chat-card";

const viewer = { role: "owner" as "owner" | "member" | "admin" };

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../hooks/usePermission", () => ({
	useStoreRole: () => viewer.role,
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
	viewer.role = "owner";
});

const SWITCH = /Let buyers message you from your store page/;

function renderCard(
	props: Partial<React.ComponentProps<typeof StorefrontChatCard>> = {},
) {
	const onChange = vi.fn().mockResolvedValue(undefined);
	render(
		<StorefrontChatCard enabled hasWaPhone onChange={onChange} {...props} />,
	);
	return onChange;
}

describe("StorefrontChatCard (z8r3fdvwcy)", () => {
	test("on by default: the switch reads on, the line says it is shown, and flipping saves off", async () => {
		const onChange = renderCard();
		const toggle = screen.getByRole("switch", { name: SWITCH });
		expect(toggle.getAttribute("aria-checked")).toBe("true");
		expect(screen.getByText(/Shown on your store page/)).toBeTruthy();
		expect(screen.getByText("On")).toBeTruthy();
		fireEvent.click(toggle);
		expect(onChange).toHaveBeenCalledWith(false);
		await waitFor(() =>
			expect(toast.success).toHaveBeenCalledWith(
				"Ask on WhatsApp is off — orders still arrive the same way.",
			),
		);
	});

	test("off: the line says it is hidden and that Share stays; flipping saves on", async () => {
		const onChange = renderCard({ enabled: false });
		expect(
			screen.getByText(
				/Hidden from your store page. Buyers can still use Share/,
			),
		).toBeTruthy();
		expect(screen.getByText("Off")).toBeTruthy();
		fireEvent.click(screen.getByRole("switch", { name: SWITCH }));
		expect(onChange).toHaveBeenCalledWith(true);
		await waitFor(() => expect(toast.success).toHaveBeenCalled());
	});

	test("on but no WhatsApp number: never claims to be shown, and points at the WhatsApp tab", () => {
		renderCard({ hasWaPhone: false });
		expect(screen.getByText(/On, but not shown yet/)).toBeTruthy();
		expect(screen.getByText("No number")).toBeTruthy();
		const link = screen.getByRole("link", { name: "Add your number" });
		expect(link.getAttribute("href")).toBe("/app/settings");
	});

	test("the helper line says what the button is and that orders are unaffected", () => {
		renderCard();
		expect(
			screen.getByText(
				/Shows an Ask on WhatsApp button on your store. Orders still arrive the same way with it off./,
			),
		).toBeTruthy();
	});

	test("a teammate sees the switch disabled with the owner-only reason", () => {
		viewer.role = "member";
		const onChange = renderCard();
		const toggle = screen.getByRole("switch", { name: SWITCH });
		expect((toggle as HTMLButtonElement).disabled).toBe(true);
		expect(
			screen.getByText(/Only the store owner can change this/),
		).toBeTruthy();
		fireEvent.click(toggle);
		expect(onChange).not.toHaveBeenCalled();
	});

	test("an acting admin sees it view-only, with the reason", () => {
		viewer.role = "admin";
		renderCard();
		expect(
			(screen.getByRole("switch", { name: SWITCH }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		expect(
			screen.getByText(/View-only while you're acting as this store/),
		).toBeTruthy();
	});

	test("a refused save reads as a sentence, and the switch is live again", async () => {
		const onChange = vi
			.fn()
			.mockRejectedValue(new Error("Only the store owner can do this"));
		render(<StorefrontChatCard enabled hasWaPhone onChange={onChange} />);
		fireEvent.click(screen.getByRole("switch", { name: SWITCH }));
		await waitFor(() => expect(toast.error).toHaveBeenCalled());
		expect(
			(screen.getByRole("switch", { name: SWITCH }) as HTMLButtonElement)
				.disabled,
		).toBe(false);
	});
});
