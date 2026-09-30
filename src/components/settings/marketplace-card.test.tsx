// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MarketplaceCard } from "./marketplace-card";

afterEach(cleanup);

describe("MarketplaceCard", () => {
	test("the switch flips the listing and says what each state means", async () => {
		const onSave = vi.fn().mockResolvedValue(undefined);
		render(<MarketplaceCard unlisted={false} area="" onSave={onSave} />);
		expect(screen.getByText(/Shown in the directory/)).toBeTruthy();
		const toggle = screen.getByRole("switch", {
			name: /List my store on the Kedaipal marketplace/,
		});
		expect(toggle.getAttribute("aria-checked")).toBe("true");
		fireEvent.click(toggle);
		expect(onSave).toHaveBeenCalledWith({ marketplaceListed: false });
	});

	test("an unlisted store reads as hidden, with the direct-link reassurance", () => {
		render(<MarketplaceCard unlisted={true} area="" onSave={vi.fn()} />);
		expect(
			screen.getByText(/buyers can still reach your direct link/i),
		).toBeTruthy();
		expect(
			screen
				.getByRole("switch", { name: /List my store/ })
				.getAttribute("aria-checked"),
		).toBe("false");
	});

	test("the area form saves the typed value and disables until dirty", () => {
		const onSave = vi.fn().mockResolvedValue(undefined);
		render(<MarketplaceCard unlisted={false} area="" onSave={onSave} />);
		const save = screen.getByRole("button", { name: "Save area" });
		expect(save.hasAttribute("disabled")).toBe(true);
		fireEvent.change(screen.getByLabelText("Area shown on your card"), {
			target: { value: "Ampang, KL" },
		});
		expect(save.hasAttribute("disabled")).toBe(false);
		fireEvent.click(save);
		expect(onSave).toHaveBeenCalledWith({ storeArea: "Ampang, KL" });
	});

	test("the card links to the live marketplace page", () => {
		render(<MarketplaceCard unlisted={false} area="" onSave={vi.fn()} />);
		const link = screen.getByRole("link", { name: /kedaipal\.com\/stores/ });
		expect(link.getAttribute("href")).toBe("/stores");
	});
});
