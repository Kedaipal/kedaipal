import {
	motion,
	useMotionValue,
	useReducedMotion,
	useSpring,
} from "framer-motion";
import type { PointerEvent as ReactPointerEvent } from "react";
import { m } from "../../paraglide/messages";
import { PhoneScreenMockup } from "./phone-screen-mockup";

/** Pointer-tilt range, degrees — enough to feel physical, small enough that
 * the storefront stays perfectly readable. */
const TILT_X = 5;
const TILT_Y = 7;

/**
 * The hero's iPhone mockup — pure CSS, no 3D. Modelled on the single
 * centered upright device from the Aave onboarding reference Arif supplied
 * (recent.design `zq0kule`): titanium-black body, thin bezel, dynamic
 * island, side buttons, soft floor shadow. Replaces a three.js scene that
 * was reverted (29 Aug, owner call — "i hate the 3d") along with its ~1 MB
 * lazy chunk and the three/@react-three/* dependencies; being plain DOM,
 * this needs no WebGL gate, no reduced-motion fallback and no SSR guard.
 *
 * One `role="img"`: the storefront inside is decorative
 * (`phone-screen-mockup.tsx`), the label tells the story.
 */
export function HeroDevice() {
	const shouldReduceMotion = useReducedMotion();
	const rotateX = useSpring(useMotionValue(0), { stiffness: 160, damping: 18 });
	const rotateY = useSpring(useMotionValue(0), { stiffness: 160, damping: 18 });

	// Mouse-only tilt parallax (the Mobbin single-device hero trick): touch
	// gets no tilt — a thumb dragging the page shouldn't wobble the phone —
	// and reduced motion gets none at all.
	function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
		if (shouldReduceMotion || e.pointerType !== "mouse") return;
		const rect = e.currentTarget.getBoundingClientRect();
		const px = (e.clientX - rect.left) / rect.width - 0.5;
		const py = (e.clientY - rect.top) / rect.height - 0.5;
		rotateX.set(-py * TILT_X * 2);
		rotateY.set(px * TILT_Y * 2);
	}
	function onPointerLeave() {
		rotateX.set(0);
		rotateY.set(0);
	}

	return (
		<motion.div
			role="img"
			aria-label={m.hero_phone_alt()}
			className="relative"
			style={{ rotateX, rotateY, transformPerspective: 900 }}
			onPointerMove={onPointerMove}
			onPointerLeave={onPointerLeave}
		>
			{/* Side buttons — behind the body so only their outer slivers show. */}
			<span
				aria-hidden
				className="absolute -left-[2.5px] top-[104px] h-7 w-[3px] rounded-l-md bg-slate-700"
			/>
			<span
				aria-hidden
				className="absolute -left-[2.5px] top-[148px] h-12 w-[3px] rounded-l-md bg-slate-700"
			/>
			<span
				aria-hidden
				className="absolute -left-[2.5px] top-[210px] h-12 w-[3px] rounded-l-md bg-slate-700"
			/>
			<span
				aria-hidden
				className="absolute -right-[2.5px] top-[168px] h-[74px] w-[3px] rounded-r-md bg-slate-700"
			/>

			{/* Body */}
			<div className="relative w-[272px] rounded-[3.1rem] bg-slate-950 p-[9px] shadow-[0_44px_80px_-24px_hsl(222_47%_11%_/_0.42)] ring-1 ring-slate-950/60 sm:w-[292px]">
				{/* Titanium edge highlight */}
				<div
					aria-hidden
					className="pointer-events-none absolute inset-0 rounded-[3.1rem] ring-1 ring-inset ring-white/15"
				/>
				{/* Screen */}
				<div className="h-[560px] overflow-hidden rounded-[2.6rem] sm:h-[600px]">
					<PhoneScreenMockup />
				</div>
			</div>
		</motion.div>
	);
}
