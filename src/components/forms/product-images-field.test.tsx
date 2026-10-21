// @vitest-environment jsdom
/**
 * z8r3fdtk85 — a product photo tile sat on "Uploading…" forever. Pins the
 * grid's half of the fix: every picked photo gets its own tile, a failed
 * upload turns that tile into "Didn't upload" with a Retry and a Remove (and a
 * line saying why), a file Retry can't fix is refused with its reason instead,
 * and the parent hears `uploading` → `failed` → `idle` so it can hold Save and
 * guard the leave. The deadlines themselves are pinned in
 * `lib/storage-upload.test.ts`.
 */
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UploadResult } from "../../lib/storage-upload";

vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
const uploadImage = vi.fn<(file: File) => Promise<UploadResult>>();
vi.mock("../../lib/storage-upload", () => ({
	uploadImage: (file: File) => uploadImage(file),
}));

import {
	type PhotoUploadState,
	type ProductImage,
	ProductImagesField,
} from "./product-images-field";

const blob = new Blob(["y"], { type: "image/webp" });
const ok = (storageId: string): UploadResult => ({
	ok: true,
	storageId,
	blob,
});
const timedOut: UploadResult = {
	ok: false,
	retryable: true,
	reason: { kind: "timeout", step: "mint" },
	message:
		"Couldn't reach Kedaipal to start the upload. Check your connection and try again.",
};

const states: PhotoUploadState[] = [];
let latest: ProductImage[] = [];

function Harness({ initial = [] }: { initial?: ProductImage[] }) {
	const [images, setImages] = useState(initial);
	latest = images;
	return (
		<ProductImagesField
			images={images}
			onChange={setImages}
			onUploadStateChange={(s) => states.push(s)}
		/>
	);
}

function pick(...names: string[]) {
	const input = document.querySelector<HTMLInputElement>('input[type="file"]');
	if (!input) throw new Error("no file input — the Add tile is hidden");
	const files = names.map((n) => new File(["x"], n, { type: "image/jpeg" }));
	fireEvent.change(input, { target: { files } });
}

/** A promise the test settles by hand — an upload still in flight. */
function deferred() {
	let resolve!: (r: UploadResult) => void;
	const promise = new Promise<UploadResult>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

/**
 * The grid reports its state from a passive `useEffect`, which runs AFTER the
 * tile's text is on screen. So "Didn't upload" being visible does not mean the
 * parent has heard `failed` yet: asserting `states` straight after a
 * `findByText` raced the effect and flaked under CI load (PR #404). Wait for
 * the report itself. The two post-`unmount()` assertions stay synchronous on
 * purpose, because unmount cleanup runs inside RTL's act and must have
 * reported by the time it returns.
 */
const reported = (state: PhotoUploadState) =>
	waitFor(() => expect(states.at(-1)).toEqual(state));

beforeEach(() => {
	uploadImage.mockReset();
	states.length = 0;
	latest = [];
	URL.createObjectURL = vi.fn(() => "blob:preview");
	URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

describe("ProductImagesField — upload tiles", () => {
	it("a picked photo shows its own Uploading tile, then joins the grid", async () => {
		const upload = deferred();
		uploadImage.mockReturnValue(upload.promise);
		render(<Harness />);
		pick("a.jpg");

		expect(await screen.findByText("Uploading…")).toBeTruthy();
		await reported({ kind: "uploading" });

		await act(async () => upload.resolve(ok("s-a")));
		await waitFor(() => expect(latest.map((i) => i.id)).toEqual(["s-a"]));
		expect(screen.queryByText("Uploading…")).toBeNull();
		await reported({ kind: "idle" });
	});

	it("a failed upload becomes 'Didn't upload' with Retry, says why, and Retry lands it", async () => {
		uploadImage.mockResolvedValueOnce(timedOut);
		render(<Harness />);
		pick("a.jpg");

		expect(await screen.findByText("Didn't upload")).toBeTruthy();
		expect(screen.getByRole("alert").textContent).toMatch(
			/1 photo didn't upload: Couldn't reach Kedaipal/,
		);
		// Unsaved work the parent must guard — not idle, not uploading — and
		// COUNTED, so its Save bar can say how many instead of "all saved".
		await reported({ kind: "failed", count: 1 });
		expect(latest).toEqual([]);

		uploadImage.mockResolvedValueOnce(ok("s-a"));
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await waitFor(() => expect(latest.map((i) => i.id)).toEqual(["s-a"]));
		expect(screen.queryByText("Didn't upload")).toBeNull();
		expect(screen.queryByRole("alert")).toBeNull();
		await reported({ kind: "idle" });
		expect(uploadImage).toHaveBeenCalledTimes(2);
	});

	it("Remove drops a failed photo without adding it", async () => {
		uploadImage.mockResolvedValueOnce(timedOut);
		render(<Harness />);
		pick("a.jpg");
		await screen.findByText("Didn't upload");

		fireEvent.click(
			screen.getByRole("button", { name: "Remove photo that didn't upload" }),
		);
		await waitFor(() => expect(screen.queryByText("Didn't upload")).toBeNull());
		expect(latest).toEqual([]);
		await reported({ kind: "idle" });
	});

	it("a file Retry can't fix is refused with its reason UNDER THE GRID — no dead Retry tile", async () => {
		uploadImage.mockResolvedValueOnce({
			ok: false,
			retryable: false,
			reason: { kind: "rejected", reject: "undecodable" },
			message: '"a.heic" is in a format browsers can\'t show.',
		});
		render(<Harness />);
		pick("a.heic");

		// Said beside the photos, where the seller is looking — not handed to
		// the form to show two screens down (z8r3fdtk85 /test-code).
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toBe(
			'"a.heic" is in a format browsers can\'t show.',
		);
		expect(screen.queryByText("Didn't upload")).toBeNull();
		expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
		await reported({ kind: "idle" });

		// The next pick clears it — a stale refusal beside a photo that then
		// landed would read as if THAT photo were refused.
		uploadImage.mockResolvedValueOnce(ok("s-b"));
		pick("b.jpg");
		await waitFor(() => expect(latest.map((i) => i.id)).toEqual(["s-b"]));
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("each photo in a pick lands or fails on its own — no all-or-nothing", async () => {
		uploadImage
			.mockResolvedValueOnce(ok("s-a"))
			.mockResolvedValueOnce(timedOut)
			.mockResolvedValueOnce(ok("s-c"));
		render(<Harness />);
		pick("a.jpg", "b.jpg", "c.jpg");

		await waitFor(() =>
			expect(latest.map((i) => i.id)).toEqual(["s-a", "s-c"]),
		);
		expect(screen.getAllByText("Didn't upload")).toHaveLength(1);
		await reported({ kind: "failed", count: 1 });
	});

	it("unmounting with a failed tile tells the parent 'idle' and frees the preview — no parent left holding 'failed' for a grid that's gone (PR #392 review)", async () => {
		uploadImage.mockResolvedValueOnce(timedOut);
		const { unmount } = render(<Harness />);
		pick("a.jpg");
		await screen.findByText("Didn't upload");
		await reported({ kind: "failed", count: 1 });

		unmount();
		expect(states.at(-1)).toEqual({ kind: "idle" });
		expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
	});

	it("unmounting mid-upload tells the parent 'idle' too", async () => {
		uploadImage.mockReturnValue(deferred().promise);
		const { unmount } = render(<Harness />);
		pick("a.jpg");
		await screen.findByText("Uploading…");
		await reported({ kind: "uploading" });

		unmount();
		expect(states.at(-1)).toEqual({ kind: "idle" });
	});

	it("a parent that throws inside onChange fails THAT tile and keeps the queue alive", async () => {
		uploadImage
			.mockResolvedValueOnce(ok("s-a"))
			.mockResolvedValueOnce(ok("s-b"));
		let calls = 0;
		function Throwing() {
			const [images, setImages] = useState<ProductImage[]>([]);
			latest = images;
			return (
				<ProductImagesField
					images={images}
					onChange={(next) => {
						// First landing blows up in the parent; the second must still land.
						if (++calls === 1) throw new Error("parent boom");
						setImages(next);
					}}
					onUploadStateChange={(s) => states.push(s)}
				/>
			);
		}
		render(<Throwing />);
		pick("a.jpg", "b.jpg");

		await screen.findByText("Didn't upload");
		await waitFor(() => expect(latest.map((i) => i.id)).toEqual(["s-b"]));
		expect(screen.getByRole("alert").textContent).toMatch(
			/Something went wrong adding this photo/,
		);
	});

	it("photos still uploading count toward the 5-photo limit", async () => {
		uploadImage.mockReturnValue(deferred().promise);
		render(
			<Harness
				initial={[
					{ id: "1", url: "u1" },
					{ id: "2", url: "u2" },
					{ id: "3", url: "u3" },
				]}
			/>,
		);
		pick("a.jpg");
		await screen.findByText("Uploading…");
		// The count says what the cap counts: a photo on its way up holds a slot.
		expect(screen.getByText("(4/5)")).toBeTruthy();
		pick("b.jpg", "c.jpg");
		expect(screen.getByRole("alert").textContent).toBe(
			"Maximum 5 images per product",
		);

		// 3 stored + 1 in flight + 1 more = full: the Add tile goes.
		pick("d.jpg");
		await waitFor(() =>
			expect(document.querySelector('input[type="file"]')).toBeNull(),
		);
	});
});
