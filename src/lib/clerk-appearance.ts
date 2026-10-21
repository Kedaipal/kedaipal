import type { ClerkProvider } from "@clerk/tanstack-react-start";
import type { ComponentProps } from "react";
import type { ResolvedTheme } from "./theme";

type Appearance = NonNullable<
	ComponentProps<typeof ClerkProvider>["appearance"]
>;

/**
 * Clerk's widgets (sign-in, sign-up, the UserButton menu) draw their own
 * surfaces from their own palette, so our `.dark` tokens never reach them: in
 * dark mode a sign-in card would float as a white plate. This hands Clerk the
 * same values `.dark` gives everything else (z8r3fdadub), on the ONE
 * `<ClerkProvider>` so every Clerk surface in the app agrees.
 *
 * Light mode passes nothing and keeps Clerk's defaults — the brief was a dark
 * theme, not a restyle of the sign-in page sellers already know. `@clerk/themes`
 * (its `dark` base theme) is not a dependency; these `variables` are the public
 * knobs and need no package.
 *
 * Literal hsl strings on purpose: Clerk reads these at its own render, outside
 * our stylesheet, so `var(--card)` is not an option. They mirror `.dark` in
 * `styles.css`; `theme.dom.test.ts` pins the two together.
 */
export const DARK_CLERK_VARIABLES = {
	colorBackground: "hsl(222 47% 9%)",
	colorText: "hsl(210 40% 98%)",
	colorTextSecondary: "hsl(215 20% 65%)",
	colorPrimary: "hsl(160 84% 39%)",
	colorInputBackground: "hsl(217 33% 17%)",
	colorInputText: "hsl(210 40% 98%)",
	colorNeutral: "hsl(210 40% 98%)",
	colorDanger: "hsl(0 63% 45%)",
} as const;

export function clerkAppearance(
	resolved: ResolvedTheme,
): Appearance | undefined {
	if (resolved !== "dark") return undefined;
	return {
		variables: DARK_CLERK_VARIABLES,
		// The card's logo is the dashboard-configured NAVY lockup, which vanishes
		// on the dark card exactly as it did in the storefront header. This Clerk
		// version exposes no appearance-level logo URL (that is a dashboard
		// setting), so in dark the logo box is hidden rather than shown wrong —
		// the card's own title names Kedaipal. A light-ink upload in the Clerk
		// dashboard, or a Clerk version with `layout.logoImageUrl`, restores it.
		// A CSS object, not a Tailwind class: Clerk injects its element styles
		// after our stylesheet, so `dark:hidden` loses the cascade; its own emotion
		// rule wins. Only passed in dark, so no `dark:` is needed anyway.
		elements: { logoBox: { display: "none" } },
	};
}
