// @vitest-environment jsdom
/**
 * z8r3fdtk82 — a seller who changed only a photo lost it on leaving.
 *
 * Pins the edit form's half of the fix: a photo-only add / remove counts as
 * an unsaved change, an existing product saves its photos by itself, the
 * Save button says when there's nothing left to save, and a failed autosave
 * falls back to the ordinary dirty + Save path. (Navigation blocking is the
 * route's, pinned in unsaved-changes-guard.test.tsx.)
 */
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateUploadUrl = vi.fn();
vi.mock("convex/react", () => ({
	useMutation: () => generateUploadUrl,
}));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: undefined, isPending: true }),
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
		<a href={to}>{children}</a>
	),
}));
vi.mock("../../lib/image-upload", () => ({
	IMAGE_ACCEPT: "image/*",
	prepareImageUpload: async (file: File) => ({
		ok: true,
		blob: file,
		contentType: "image/webp",
	}),
}));
const toastFn = vi.fn();
const toastDismiss = vi.fn();
vi.mock("sonner", () => ({
	toast: Object.assign((...args: unknown[]) => toastFn(...args), {
		success: vi.fn(),
		error: vi.fn(),
		dismiss: (...args: unknown[]) => toastDismiss(...args),
	}),
}));

vi.mock("../../lib/file-input", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../lib/file-input")>();
	return { takePickedFiles: vi.fn(actual.takePickedFiles) };
});

import { takePickedFiles } from "../../lib/file-input";
import type { UnsavedState } from "../../lib/product-form-dirty";
import { ProductForm } from "./product-form";

beforeEach(() => {
	generateUploadUrl.mockReset();
	generateUploadUrl.mockResolvedValue("https://upload.example/u");
	toastFn.mockReset();
	toastDismiss.mockReset();
	vi.mocked(takePickedFiles).mockClear();
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => ({
			ok: true,
			json: async () => ({ storageId: "s-new" }),
		})),
	);
	URL.createObjectURL = vi.fn(() => "blob:preview");
	URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function renderEdit({
	onImagesAutosave,
	saveLock,
	images = ["s1"],
}: {
	onImagesAutosave?: (ids: string[]) => Promise<void>;
	saveLock?: { reason: string; label: string };
	images?: string[];
} = {}) {
	const unsaved: UnsavedState[] = [];
	const view = render(
		<ProductForm
			retailerId={"r1" as never}
			categoriesLocked={false}
			eventsLocked={false}
			promoLocked={false}
			currency="MYR"
			submitLabel="Save changes"
			onSubmit={vi.fn()}
			mode="edit"
			saveLock={saveLock}
			onImagesAutosave={onImagesAutosave}
			onUnsavedChange={(s) => unsaved.push(s)}
			initialValues={{
				name: "Tent wash",
				kind: "physical",
				imageStorageIds: images,
				imageUrls: images.map((id) => `https://cdn/${id}`),
				options: [],
				variants: [{ optionValues: [], price: 3000, onHand: 5 }],
			}}
		/>,
	);
	return {
		unsaved,
		last: () => unsaved[unsaved.length - 1],
		unmount: view.unmount,
	};
}

function saveButton() {
	return screen.getByRole("button", {
		name: /^(all changes saved|save changes|\d+ photos? didn't upload)$/i,
	}) as HTMLButtonElement;
}

async function addPhoto() {
	const input = document.querySelector(
		'input[type="file"]',
	) as HTMLInputElement;
	const file = new File(["x"], "tent.jpg", { type: "image/jpeg" });
	await act(async () => {
		fireEvent.change(input, { target: { files: [file] } });
	});
}

describe("ProductForm edit — photo-only changes (z8r3fdtk82)", () => {
	it("opens clean: Save reads 'All changes saved' and is disabled", () => {
		const { last } = renderEdit();
		expect(saveButton().textContent).toMatch(/all changes saved/i);
		expect(saveButton().disabled).toBe(true);
		// A solid resting state, not the half-transparent disabled look: the
		// bar is sticky on a phone and the form showed through it.
		expect(saveButton().className).toContain("disabled:opacity-100");
		expect(last()).toBe("none");
	});

	it("reads the pick through takePickedFiles, which clears the picker so the same file can be picked again", async () => {
		// jsdom never holds a value on a file input, so the reset itself is
		// pinned in file-input.test.ts; this pins that the grid goes through it.
		renderEdit();
		await addPhoto();
		expect(takePickedFiles).toHaveBeenCalledTimes(1);
	});

	it("without autosave, adding ONLY a photo enables Save and reports unsaved changes", async () => {
		const { last } = renderEdit();
		await addPhoto();
		await waitFor(() =>
			expect(saveButton().textContent).toMatch(/save changes/i),
		);
		expect(saveButton().disabled).toBe(false);
		expect(last()).toBe("changes");
	});

	it("without autosave, removing ONLY a photo enables Save", () => {
		const { last } = renderEdit();
		fireEvent.click(screen.getByRole("button", { name: "Remove image" }));
		expect(saveButton().disabled).toBe(false);
		expect(last()).toBe("changes");
	});

	it("with autosave, an added photo saves by itself and leaves nothing unsaved", async () => {
		const autosave = vi.fn().mockResolvedValue(undefined);
		const { last } = renderEdit({ onImagesAutosave: autosave });
		// The card tells the seller photos save themselves.
		expect(screen.getByText(/no need to tap save/i)).toBeTruthy();
		await addPhoto();
		await waitFor(() => expect(autosave).toHaveBeenCalledWith(["s1", "s-new"]));
		await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());
		expect(saveButton().textContent).toMatch(/all changes saved/i);
		expect(last()).toBe("none");
	});

	it("with autosave, a removal saves and offers Undo, which restores and saves again", async () => {
		const autosave = vi.fn().mockResolvedValue(undefined);
		renderEdit({ onImagesAutosave: autosave });
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Remove image" }));
		});
		expect(autosave).toHaveBeenCalledWith([]);
		expect(toastFn).toHaveBeenCalledWith(
			"Photo removed.",
			expect.objectContaining({
				// Undo is the only way back from a removal that already saved,
				// so it stays up longer than the 4s default.
				duration: 10_000,
				action: expect.objectContaining({ label: "Undo" }),
			}),
		);
		const undo = toastFn.mock.calls[0][1].action.onClick as () => void;
		await act(async () => {
			undo();
		});
		expect(autosave).toHaveBeenLastCalledWith(["s1"]);
		expect(
			screen.getAllByRole("button", { name: "Remove image" }),
		).toHaveLength(1);
	});

	it("two removals keep two Undos, and each puts back only its own photo, where it was (PR #371 review)", async () => {
		const autosave = vi.fn().mockResolvedValue(undefined);
		renderEdit({
			onImagesAutosave: autosave,
			images: ["s1", "s2", "s3"],
		});
		// Remove the FIRST photo, then the (new) first again — s1 then s2.
		await act(async () => {
			fireEvent.click(
				screen.getAllByRole("button", { name: "Remove image" })[0],
			);
		});
		await act(async () => {
			fireEvent.click(
				screen.getAllByRole("button", { name: "Remove image" })[0],
			);
		});
		const removals = toastFn.mock.calls.filter(
			(c) => c[0] === "Photo removed.",
		);
		expect(removals).toHaveLength(2);
		// Distinct ids: the second toast no longer replaces the first's Undo.
		expect(removals[0][1].id).not.toBe(removals[1][1].id);
		// Undo the FIRST removal: s1 comes back at the front, s2 stays removed.
		await act(async () => {
			removals[0][1].action.onClick();
		});
		expect(autosave).toHaveBeenLastCalledWith(["s1", "s3"]);
	});

	it("leaving the page takes the Undo toasts with it", async () => {
		const autosave = vi.fn().mockResolvedValue(undefined);
		const { unmount } = renderEdit({ onImagesAutosave: autosave });
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Remove image" }));
		});
		const id = toastFn.mock.calls[0][1].id;
		unmount();
		// An Undo from another page would write a list this form no longer shows.
		expect(toastDismiss).toHaveBeenCalledWith(id);
	});

	it("a photo that didn't upload holds Save with its reason — never 'All changes saved' beside a failed tile (z8r3fdtk85)", async () => {
		// Storage unreachable: the tile fails, retryable.
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("Failed to fetch");
			}),
		);
		const { last } = renderEdit();
		await addPhoto();
		await screen.findByText("Didn't upload");

		// The tile re-renders a tick before the parent's effect reaches the
		// bar, so wait on the bar itself rather than the tile.
		await waitFor(() =>
			expect(saveButton().textContent).toMatch(/1 photo didn't upload/),
		);
		expect(saveButton().disabled).toBe(true);
		// And it is unsaved work for the leave guard.
		expect(last()).toBe("changes");

		// Remove the failed tile: nothing left to say, bar rests again.
		fireEvent.click(
			screen.getByRole("button", { name: "Remove photo that didn't upload" }),
		);
		await waitFor(() =>
			expect(saveButton().textContent).toMatch(/All changes saved/),
		);
		expect(last()).toBe("none");
	});

	it("a failed autosave keeps the photo as an unsaved change Save can still send", async () => {
		const autosave = vi.fn().mockRejectedValue(new Error("Too many requests"));
		const { last } = renderEdit({ onImagesAutosave: autosave });
		await addPhoto();
		await waitFor(() =>
			expect(screen.getByRole("alert").textContent).toMatch(
				/couldn't save your photos/i,
			),
		);
		expect(saveButton().disabled).toBe(false);
		expect(last()).toBe("changes");
	});

	it("while saving is locked, photos wait in the draft instead of autosaving", () => {
		const autosave = vi.fn().mockResolvedValue(undefined);
		const { last } = renderEdit({
			onImagesAutosave: autosave,
			saveLock: { reason: "View-only", label: "view-only" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Remove image" }));
		expect(autosave).not.toHaveBeenCalled();
		expect(last()).toBe("changes");
	});

	it("a text edit still dirties the form after photos autosaved", async () => {
		const autosave = vi.fn().mockResolvedValue(undefined);
		const { last } = renderEdit({ onImagesAutosave: autosave });
		await addPhoto();
		await waitFor(() => expect(last()).toBe("none"));
		const name = screen.getByDisplayValue("Tent wash");
		fireEvent.change(name, { target: { value: "Tent wash + dry" } });
		await waitFor(() => expect(last()).toBe("changes"));
		expect(saveButton().disabled).toBe(false);
	});
});
