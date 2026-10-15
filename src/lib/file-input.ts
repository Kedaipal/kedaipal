/**
 * Reads what a file picker just handed over and clears it (z8r3fdtk82).
 *
 * A file input fires `change` only when its value CHANGES. Without the
 * reset, a seller who removes a photo and picks the same file again gets
 * nothing: no upload, no error, the tap just does nothing. Removing and
 * re-adding a photo is an everyday move now that photos save themselves.
 *
 * The files are copied out first: clearing the input empties its live
 * `FileList`.
 */
export function takePickedFiles(input: HTMLInputElement): File[] {
	const files = Array.from(input.files ?? []);
	input.value = "";
	return files;
}
