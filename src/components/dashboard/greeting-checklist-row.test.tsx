// @vitest-environment jsdom
// The greeting step cannot be finished by an admin acting-as, and the row has
// to SAY so rather than offer controls that quietly do nothing.
//
// Both of its controls ("Mark as done" and "Skip for now") call the same
// `complete()`, which sets `saving` and deliberately never clears it on
// success — it expects the stamp to flip `item.done` and unmount the row. The
// stamp is inert in act-as, so that flip never comes and the button sits on
// "Saving…" for ever. This PR had already diagnosed and fixed exactly that in
// the consent banner, then reintroduced it by making the no-op invisible
// (PR review, 2 Oct).

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MessageCircle } from "lucide-react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ChecklistItem } from "../../routes/app.index";

const stamp = vi.fn(async () => undefined);
const hook = { active: true };
vi.mock("../../hooks/useChecklistStamp", () => ({
	useChecklistStamp: () => ({ stamp, active: hook.active }),
}));

const { GreetingChecklistRow } = await import("./greeting-checklist-row");

const item: ChecklistItem = {
	key: "greeting",
	step: 0,
	done: false,
	icon: MessageCircle,
	title: "Set your WhatsApp greeting",
	why: "New chats get your store link automatically.",
	time: "~2 min",
	cta: "Set it up",
	to: "/app/settings",
};

function open() {
	render(
		<GreetingChecklistRow
			item={item}
			expanded
			storeName="Warung Nasi Lemak"
			slug="warung-nasi-lemak"
			locale="en"
		/>,
	);
	return {
		markDone: screen.getByRole("button", { name: /mark as done/i }),
		skip: screen.getByRole("button", { name: /skip for now/i }),
	};
}

afterEach(() => {
	cleanup();
	stamp.mockClear();
	hook.active = true;
});

describe("GreetingChecklistRow", () => {
	test("the seller can finish the step", () => {
		const { markDone, skip } = open();
		expect((markDone as HTMLButtonElement).disabled).toBe(false);
		expect((skip as HTMLButtonElement).disabled).toBe(false);
		fireEvent.click(markDone);
		expect(stamp).toHaveBeenCalled();
	});

	test("an admin acting-as gets BOTH controls disabled, with the reason", () => {
		hook.active = false;
		const { markDone, skip } = open();
		expect((markDone as HTMLButtonElement).disabled).toBe(true);
		// "Skip for now" finishes the step too — disabling only the primary
		// would leave the identical hang one tap to the right.
		expect((skip as HTMLButtonElement).disabled).toBe(true);
		expect(
			screen.getByText(/only the seller can finish this step/i),
		).toBeTruthy();
	});

	test("and clicking through anyway never strands the row on 'Saving…'", () => {
		// The actual regression: `complete()` sets `saving` and only clears it in
		// the catch, so an inert stamp used to leave a permanently disabled
		// "Saving…" button. Nothing fires, and the label is untouched.
		hook.active = false;
		const { markDone, skip } = open();
		fireEvent.click(markDone);
		fireEvent.click(skip);
		expect(stamp).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: /mark as done/i })).toBeTruthy();
		expect(screen.queryByText(/saving/i)).toBeNull();
	});
});
