// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EasyparcelLogo } from "./easyparcel-logo";

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

describe("EasyparcelLogo", () => {
	it("sizes the wordmark by height so it keeps its own ratio", () => {
		const { container } = render(
			<EasyparcelLogo heightClass="h-5" alt="EasyParcel" />,
		);
		const img = container.querySelector("img");
		expect(img?.getAttribute("src")).toBe("/img/easyparcel-logo.svg");
		expect(img?.getAttribute("alt")).toBe("EasyParcel");
		expect(img?.className).toContain("h-5");
		expect(img?.className).toContain("w-auto");
	});

	it("is decorative by default, for a surface whose label already names it", () => {
		const { container } = render(<EasyparcelLogo heightClass="h-3.5" />);
		expect(container.querySelector("img")?.getAttribute("alt")).toBe("");
	});

	// Same rule as DelyvaLogo: a surface rendering the asset itself is how the
	// Delyva mark ended up invisible on dark cards, so the asset has one author.
	it("is the only place in src/ that renders the EasyParcel wordmark", () => {
		const raw = sourceFiles(SRC)
			.filter((file) =>
				readFileSync(file, "utf8").includes("easyparcel-logo.svg"),
			)
			.map((file) => relative(SRC, file).split(sep).join("/"));
		expect(raw).toEqual(["components/ui/easyparcel-logo.tsx"]);
	});
});
