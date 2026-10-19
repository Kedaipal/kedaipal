import { useEffect, useState } from "react";

/**
 * Two small readers of where a page section is relative to the viewport,
 * for the landing's WhatsApp dock (`wa-dock.tsx`): the dock shows once the
 * hero has scrolled out, hides while the final CTA is on screen, and asks a
 * question that fits the section under the reader.
 *
 * Both are `null` before the first report and on the server — a dock must
 * never render on SSR or on first paint, which would put it over the hero.
 * Elements are looked up by id at mount; a missing id just stays `null`.
 */

/** Whether the section with this id intersects the viewport (`null` = unknown). */
export function useSectionVisibility(id: string): boolean | null {
	const [visible, setVisible] = useState<boolean | null>(null);
	useEffect(() => {
		const el = document.getElementById(id);
		if (!el || typeof IntersectionObserver === "undefined") return;
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) setVisible(entry.isIntersecting);
			},
			{ threshold: 0 },
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, [id]);
	return visible;
}

/**
 * The id of the section most recently seen on screen. A section that leaves
 * does not clear the answer — between two sections the reader is still "in"
 * the last one, and the dock's question should not blink to nothing.
 */
export function useActiveSection(ids: readonly string[]): string | null {
	const [active, setActive] = useState<string | null>(null);
	// A stable key for the effect: the ids are a static list per call site.
	const key = ids.join("|");
	useEffect(() => {
		if (typeof IntersectionObserver === "undefined") return;
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) setActive(entry.target.id);
				}
			},
			{ threshold: 0.25 },
		);
		for (const id of key.split("|")) {
			const el = document.getElementById(id);
			if (el) observer.observe(el);
		}
		return () => observer.disconnect();
	}, [key]);
	return active;
}
