// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultTemplate } from "../../../convex/lib/whatsappCopy";

/**
 * The order-number reply editor (86eye9xd4, 11A + test round): it opens on
 * what goes out today, so a one-word change is an edit, and the default saved
 * back unchanged stays the default.
 */

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { MessageTemplatesForm } from "./message-templates-form";

afterEach(cleanup);

function renderForm(
	current?: Parameters<typeof MessageTemplatesForm>[0]["current"],
) {
	const onSave = vi.fn().mockResolvedValue({ ok: true });
	render(<MessageTemplatesForm current={current} onSave={onSave} />);
	return onSave;
}

const box = () =>
	screen.getByRole("textbox", { name: "English reply" }) as HTMLTextAreaElement;
const save = () =>
	screen.getByRole("button", { name: "Save reply" }) as HTMLButtonElement;

describe("MessageTemplatesForm", () => {
	it("opens prefilled with the default, so editing is a tweak, not a retype", () => {
		renderForm();
		fireEvent.click(screen.getByRole("button", { name: /^English/ }));
		expect(box().value).toBe(defaultTemplate("en", "confirm"));
		// Nothing changed yet — nothing to save.
		expect(save().disabled).toBe(true);
	});

	it("saves the seller's own words", async () => {
		const onSave = renderForm();
		fireEvent.click(screen.getByRole("button", { name: /^English/ }));
		fireEvent.change(box(), {
			target: { value: "Thanks! Order {shortId} is in — {storeName}" },
		});
		fireEvent.click(save());
		await waitFor(() =>
			expect(onSave).toHaveBeenCalledWith({
				en: { confirm: "Thanks! Order {shortId} is in — {storeName}" },
			}),
		);
	});

	it("an emptied box can't be saved — Reset to default is the way back", () => {
		renderForm({ en: { confirm: "Mine {shortId}" } });
		fireEvent.click(screen.getByRole("button", { name: /^English/ }));
		expect(box().value).toBe("Mine {shortId}");
		fireEvent.change(box(), { target: { value: "  " } });
		expect(save().disabled).toBe(true);
		expect(
			screen.getByRole("button", { name: "Reset to default" }),
		).toBeTruthy();
	});

	it("the default typed back in is stored as the default, not a copy of it", async () => {
		const onSave = renderForm({ en: { confirm: "Mine {shortId}" } });
		fireEvent.click(screen.getByRole("button", { name: /^English/ }));
		fireEvent.change(box(), {
			target: { value: defaultTemplate("en", "confirm") },
		});
		fireEvent.click(save());
		await waitFor(() => expect(onSave).toHaveBeenCalled());
		expect(onSave.mock.calls[0][0].en?.confirm).toBeUndefined();
	});
});
