// @vitest-environment jsdom
/**
 * z8r3fdtk85 (/test-code finding) — the wizard's Continue stayed enabled with
 * a photo sitting in "Didn't upload", so a seller could walk on and create the
 * product without it, silently. Continue is now held with the reason until
 * the photo is retried or removed, in the same words the edit form's Save
 * bar uses.
 */
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UploadResult } from "../../lib/storage-upload";

vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: undefined, isPending: true }),
}));
const uploadImage = vi.fn<(file: File) => Promise<UploadResult>>();
vi.mock("../../lib/storage-upload", () => ({
	uploadImage: (file: File) => uploadImage(file),
}));

import {
	emptyWizardState,
	ProductWizard,
	type WizardState,
} from "./product-wizard";
import { emptyRow } from "./variant-editor";

/** An unnamed physical-goods draft: the wizard resumes on "Name it", the
 * step that holds the photo grid. */
function atNameStep(): WizardState {
	return {
		...emptyWizardState(),
		name: "",
		description: "",
		images: [],
		kindCard: "physical",
		shape: null,
		editor: { options: [], rows: [emptyRow([])], customLine: null },
		fulfilmentAnswered: false,
		hidden: false,
		categoryIds: [],
		minQuantity: "",
		minNoticeDays: "",
	};
}

function continueButton() {
	return screen.getByRole("button", {
		name: /^(continue|\d+ photos? didn't upload|uploading…)$/i,
	}) as HTMLButtonElement;
}

beforeEach(() => {
	uploadImage.mockReset();
	URL.createObjectURL = vi.fn(() => "blob:preview");
	URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

describe("wizard — Continue is held while a photo sits failed", () => {
	it("reads '1 photo didn't upload' and is disabled, then frees once the tile is removed", async () => {
		uploadImage.mockResolvedValueOnce({
			ok: false,
			retryable: true,
			reason: { kind: "timeout", step: "mint" },
			message: "Couldn't reach Kedaipal to start the upload.",
		});
		render(
			<ProductWizard
				retailerId={"r1" as never}
				categoriesLocked={false}
				eventsLocked={false}
				promoLocked={false}
				currency="MYR"
				onSubmit={vi.fn()}
				onSkipToFullForm={vi.fn()}
				onOpenFullForm={vi.fn()}
				onExit={vi.fn()}
				initialState={atNameStep()}
			/>,
		);
		fireEvent.change(screen.getByPlaceholderText(/chocolate fudge/i), {
			target: { value: "Tent wash" },
		});
		expect(continueButton().disabled).toBe(false);

		const input = document.querySelector(
			'input[type="file"]',
		) as HTMLInputElement;
		fireEvent.change(input, {
			target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] },
		});
		await screen.findByText("Didn't upload");

		// The tile re-renders a tick before the parent's effect reaches the
		// button, so wait on the button itself rather than the tile.
		await waitFor(() =>
			expect(continueButton().textContent).toMatch(/1 photo didn't upload/),
		);
		expect(continueButton().disabled).toBe(true);

		fireEvent.click(
			screen.getByRole("button", { name: "Remove photo that didn't upload" }),
		);
		await waitFor(() => expect(continueButton().textContent).toBe("Continue"));
		expect(continueButton().disabled).toBe(false);
	});
});
