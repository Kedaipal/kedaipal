// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { takePickedFiles } from "./file-input";

function pickerWith(files: File[]): HTMLInputElement {
	const input = document.createElement("input");
	input.type = "file";
	Object.defineProperty(input, "files", {
		configurable: true,
		get: () => (input.value === "" && cleared ? [] : files),
	});
	let cleared = false;
	const desc = Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		"value",
	);
	Object.defineProperty(input, "value", {
		configurable: true,
		get: () => (cleared ? "" : "C:\\fakepath\\x.png"),
		set: (v: string) => {
			cleared = v === "";
			desc?.set?.call(input, v);
		},
	});
	return input;
}

describe("takePickedFiles", () => {
	it("returns the picked files and clears the picker", () => {
		const file = new File(["x"], "tent.jpg", { type: "image/jpeg" });
		const input = pickerWith([file]);
		const taken = takePickedFiles(input);
		// Copied BEFORE the reset, so clearing doesn't empty what was taken.
		expect(taken).toEqual([file]);
		expect(input.value).toBe("");
	});

	it("an empty pick is an empty list, not null", () => {
		expect(takePickedFiles(pickerWith([]))).toEqual([]);
	});
});
