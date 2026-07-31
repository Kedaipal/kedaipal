import { useEffect, useRef } from "react";

/**
 * Measure an element and publish its height as a CSS custom property on
 * `<html>`, keeping it current via ResizeObserver. Returns the ref to attach.
 *
 * The storefront's bottom CTA bars are `position: fixed` — out of document
 * flow — so the page underneath has to reserve its own bottom clearance or the
 * bar covers the trailing content (the powered-by footer). Hardcoding that
 * clearance is a guess that rots: these bars grow and shrink with their own
 * content (a blocked-CTA reason line, a min-quantity shortfall hint, a
 * delivery-fee-pending note, two- vs one-line reassurance copy at 320px) and
 * the safe-area inset varies per device. Publishing the measured height lets
 * the page reserve exactly the bar and no more, so the gap under the footer
 * badge stays the same on every screen.
 *
 * Mirrors `--app-bottomnav-h` in `dashboard/bottom-nav.tsx` and
 * `--app-header-h` in `dashboard/mobile-header.tsx`.
 *
 * Note a `display: none` element measures 0, so a bar hidden at a breakpoint
 * publishes `0px` — and `var(--x, fallback)` only falls back when the property
 * is UNSET, not when it's zero. Any consumer must therefore set its own value
 * at those breakpoints (both storefront routes pair the var with `lg:pb-10`).
 */
export function usePublishedHeight<T extends HTMLElement>(cssVar: string) {
	const ref = useRef<T>(null);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const root = document.documentElement;
		const publish = () =>
			root.style.setProperty(cssVar, `${el.offsetHeight}px`);

		publish();
		const observer = new ResizeObserver(publish);
		observer.observe(el);
		return () => {
			observer.disconnect();
			// Clear on unmount so a route that has no bar can't inherit a stale
			// reservation from the page the buyer just left.
			root.style.removeProperty(cssVar);
		};
	}, [cssVar]);

	return ref;
}
