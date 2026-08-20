// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	AWB_DEFAULTS,
	AWB_FOOTER_MAX,
	type AwbConfig,
} from "../../../convex/lib/awbConfig";
import { DespatchLabelCard } from "./despatch-label-card";

/**
 * The despatch-label template card (86eyp63mp). Presentational — config in, a
 * patch out — so these pin the patch payloads, the disabled-until-dirty Save,
 * the footer cap, and the discoverability copy that tells a seller this is
 * Kedaipal's label rather than a courier's consignment note.
 */

function renderCard(config: Partial<AwbConfig> = {}) {
	const onSave = vi.fn().mockResolvedValue(undefined);
	render(
		<DespatchLabelCard config={{ ...AWB_DEFAULTS, ...config }} onSave={onSave} />,
	);
	return onSave;
}

describe("DespatchLabelCard", () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("says what the label is — and what it is not", () => {
		renderCard();
		expect(
			screen.getByText(/not a courier's official\s+consignment note/i),
		).toBeTruthy();
	});

	it("offers both paper sizes, with A4 4-up preselected", () => {
		renderCard();
		expect(
			screen.getByRole("button", { name: /A4 sheet, 4 labels/i }),
		).toHaveProperty("ariaPressed", "true");
		expect(
			screen.getByRole("button", { name: /A6 label roll/i }),
		).toHaveProperty("ariaPressed", "false");
	});

	it("Save is disabled until something actually changes", () => {
		renderCard();
		const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
		expect(save.disabled).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: /A6 label roll/i }));
		expect(save.disabled).toBe(false);
	});

	it("saves the whole resolved template, not just the changed field", async () => {
		const onSave = renderCard();
		fireEvent.click(screen.getByRole("button", { name: /A6 label roll/i }));
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() =>
			expect(onSave).toHaveBeenCalledWith({
				paperSize: "a6",
				showLogo: true,
				showItems: false,
				showCod: true,
				showWeight: true,
				showNote: true,
				footerText: undefined,
			}),
		);
	});

	it("toggling contents on rides through to the patch", async () => {
		const onSave = renderCard();
		fireEvent.click(screen.getByLabelText(/What's inside/i));
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() =>
			expect(onSave).toHaveBeenCalledWith(
				expect.objectContaining({ showItems: true }),
			),
		);
	});

	it("warns that contents are visible to whoever handles the parcel", () => {
		renderCard();
		expect(
			screen.getByText(/tells anyone handling the parcel what's in it/i),
		).toBeTruthy();
	});

	it("explains the payment toggle in double-payment terms", () => {
		renderCard();
		expect(screen.getByText(/nobody gets asked to pay twice/i)).toBeTruthy();
	});

	it("blocks an over-long footer with a reason instead of truncating", () => {
		renderCard();
		fireEvent.change(screen.getByLabelText(/Footer line/i), {
			target: { value: "x".repeat(AWB_FOOTER_MAX + 1) },
		});
		expect(
			(screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		expect(
			screen.getByText(
				new RegExp(`${AWB_FOOTER_MAX} characters or fewer`, "i"),
			),
		).toBeTruthy();
	});

	it("discards edits back to the saved template", () => {
		renderCard({ paperSize: "a6" });
		fireEvent.click(screen.getByRole("button", { name: /A4 sheet, 4 labels/i }));
		fireEvent.click(screen.getByRole("button", { name: /Discard changes/i }));
		expect(
			screen.getByRole("button", { name: /A6 label roll/i }),
		).toHaveProperty("ariaPressed", "true");
		expect(
			(screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
	});
});
