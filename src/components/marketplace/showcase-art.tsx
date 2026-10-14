import { useId } from "react";
import type { ShowcaseTheme } from "../../../convex/lib/showcase";

/**
 * The banner art behind a showcase title when the admin uploaded no cover
 * (z8r3fdr6mv). Drawn in the theme's own variables, so one drawing wears
 * every palette (a custom colour included); two scenes, picked by the theme's mood: an outdoors scene (hills,
 * a tent, a fire) for the earthy themes, and a night-sky scene (stars, a
 * moon, a glow) for the rest. Purely decorative — `aria-hidden`, and it never
 * carries information the title doesn't.
 */
export function ShowcaseArt({
	theme,
	className,
}: {
	theme: ShowcaseTheme;
	className?: string;
}) {
	const outdoors = theme === "campfire" || theme === "sunset";
	// Per-instance: the gradient's colour resolves where it is DEFINED, so a
	// shared id let the first showcase on the page paint every other one's
	// glow — two custom colours side by side made that visible.
	const glowId = `sc-glow-${useId().replace(/:/g, "")}`;
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 400 240"
			preserveAspectRatio="xMidYMax slice"
			className={className}
		>
			<defs>
				<radialGradient id={glowId} cx="50%" cy="50%" r="50%">
					<stop offset="0" stopColor="var(--sc-accent)" stopOpacity="0.5" />
					<stop offset="1" stopColor="var(--sc-accent)" stopOpacity="0" />
				</radialGradient>
			</defs>
			<g fill="white" opacity="0.7">
				<circle cx="40" cy="30" r="1.2" />
				<circle cx="96" cy="18" r="1" />
				<circle cx="150" cy="42" r="1.4" />
				<circle cx="210" cy="16" r="1" />
				<circle cx="250" cy="52" r="1.1" />
				<circle cx="20" cy="74" r="1" />
				<circle cx="180" cy="80" r="0.9" />
				<circle cx="320" cy="40" r="1.2" />
				<circle cx="370" cy="90" r="1" />
			</g>
			<circle cx="330" cy="54" r="20" fill="var(--sc-accent)" opacity="0.9" />
			<circle cx="338" cy="48" r="17" fill="var(--sc-a)" />
			{outdoors ? (
				<>
					<path
						d="M0 180 L60 122 L104 160 L168 96 L232 160 L282 126 L400 186 L400 240 L0 240Z"
						fill="white"
						opacity="0.12"
					/>
					<path
						d="M0 210 L48 170 L96 202 L150 156 L210 206 L262 168 L320 206 L400 182 L400 240 L0 240Z"
						fill="var(--sc-a)"
					/>
					<circle cx="340" cy="206" r="46" fill={`url(#${glowId})`} />
					<path d="M312 216 L340 170 L368 216Z" fill="var(--sc-accent)" />
					<path d="M334 216 L340 200 L346 216Z" fill="var(--sc-a)" />
				</>
			) : (
				<>
					<circle cx="300" cy="200" r="70" fill={`url(#${glowId})`} />
					<path
						d="M0 200 Q100 150 200 200 T400 200 L400 240 L0 240Z"
						fill="white"
						opacity="0.08"
					/>
					<path
						d="M0 222 Q100 190 200 222 T400 222 L400 240 L0 240Z"
						fill="var(--sc-a)"
					/>
				</>
			)}
		</svg>
	);
}
