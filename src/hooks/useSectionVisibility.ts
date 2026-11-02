import { useEffect, useState } from "react";

/**
 * Whether the page section with this id intersects the viewport, for the
 * landing's WhatsApp dock (`wa-dock.tsx`): the dock shows once the hero has
 * scrolled out and hides while the final CTA or the footer is on screen.
 *
 * `null` before the first report and on the server — a dock must never
 * render on SSR or on first paint, which would put it over the hero. The
 * element is looked up by id at mount; a missing id just stays `null`.
 */
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
