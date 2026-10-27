// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DelyvaLogo } from "./delyva-logo";

afterEach(cleanup);

const SRC = join(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			return entry.name === "paraglide" ? [] : sourceFiles(path);
		}
		return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
			? [path]
			: [];
	});
}

describe("DelyvaLogo", () => {
	it("puts a white plate behind the black-ink wordmark in dark mode only", () => {
		render(<DelyvaLogo heightClass="h-3.5" />);
		const plate = screen.getByTestId("delyva-logo");
		expect(plate.className).toContain("dark:bg-white");
		// Light mode renders the mark bare, as it always did.
		expect(plate.className).not.toMatch(/(^|\s)bg-white/);
	});

	it("sizes the wordmark by height so it keeps its own ratio", () => {
		const { container } = render(<DelyvaLogo heightClass="h-5" alt="Delyva" />);
		const img = container.querySelector("img");
		expect(img?.getAttribute("src")).toBe("/img/delyva-logo.png");
		expect(img?.getAttribute("alt")).toBe("Delyva");
		expect(img?.className).toContain("h-5");
		expect(img?.className).toContain("w-auto");
	});

	// The wordmark vanished on dark cards because each surface rendered the PNG
	// itself; any new raw use would bring that back, so the asset has one author.
	it("is the only place in src/ that renders the Delyva wordmark", () => {
		const raw = sourceFiles(SRC)
			.filter((file) => readFileSync(file, "utf8").includes("delyva-logo.png"))
			.map((file) => relative(SRC, file).split(sep).join("/"));
		expect(raw).toEqual(["components/ui/delyva-logo.tsx"]);
	});
});
