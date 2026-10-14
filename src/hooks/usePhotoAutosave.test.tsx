// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProductImage } from "../components/forms/product-images-field";
import { usePhotoAutosave } from "./usePhotoAutosave";

const img = (id: string): ProductImage => ({ id, url: `blob:${id}` });

function deferred() {
	let resolve!: () => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe("usePhotoAutosave", () => {
	it("saves the ids and reports the saved list back", async () => {
		const save = vi.fn().mockResolvedValue(undefined);
		const onSaved = vi.fn();
		const { result } = renderHook(() => usePhotoAutosave({ save, onSaved }));
		await act(async () => {
			result.current.autosave([img("a"), img("b")]);
		});
		expect(save).toHaveBeenCalledWith(["a", "b"]);
		expect(onSaved).toHaveBeenCalledWith([img("a"), img("b")]);
		expect(result.current.status).toEqual({ kind: "saved" });
	});

	it("is single-flight and latest-wins: a burst of changes is two writes, in order", async () => {
		const first = deferred();
		const save = vi
			.fn()
			.mockReturnValueOnce(first.promise)
			.mockResolvedValue(undefined);
		const onSaved = vi.fn();
		const { result } = renderHook(() => usePhotoAutosave({ save, onSaved }));
		act(() => {
			result.current.autosave([img("a")]);
			// Two more changes while the first is still in the air.
			result.current.autosave([img("a"), img("b")]);
			result.current.autosave([img("b"), img("a")]);
		});
		expect(save).toHaveBeenCalledTimes(1);
		expect(result.current.status).toEqual({ kind: "saving" });
		await act(async () => {
			first.resolve();
		});
		// The middle list is skipped: only the newest one follows.
		expect(save).toHaveBeenCalledTimes(2);
		expect(save).toHaveBeenLastCalledWith(["b", "a"]);
		expect(onSaved).toHaveBeenLastCalledWith([img("b"), img("a")]);
		expect(result.current.status).toEqual({ kind: "saved" });
	});

	it("a failed save keeps the photos unsaved and says why", async () => {
		const save = vi.fn().mockRejectedValue(new Error("Rate limited"));
		const onSaved = vi.fn();
		const { result } = renderHook(() => usePhotoAutosave({ save, onSaved }));
		await act(async () => {
			result.current.autosave([img("a")]);
		});
		expect(onSaved).not.toHaveBeenCalled();
		expect(result.current.status.kind).toBe("error");
	});
});
