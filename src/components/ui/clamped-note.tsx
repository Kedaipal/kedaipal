import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { LinkifiedText } from "./linkified-text";

const CLAMP = {
	2: "line-clamp-2",
	3: "line-clamp-3",
} as const;

/**
 * A seller note in a tight spot — a product card, a pickup option — clamped so
 * it can't take over the card, with its links tappable (`LinkifiedText`) and a
 * "Show more" that appears ONLY when the clamp actually cut something off
 * (z8r3fdn2uj). Before this, a link past the third line was simply invisible:
 * the buyer couldn't see it, let alone tap it.
 *
 * Overflow is measured, not guessed from the character count — the same 150
 * characters wrap to two lines on a tablet and five on a small phone.
 */
interface ClampedNoteProps {
	text: string;
	lines?: keyof typeof CLAMP;
	className?: string;
}

export function ClampedNote(props: ClampedNoteProps) {
	// Keyed on what decides the overflow: under a clamp the box height is
	// fixed, so new text wouldn't resize it and the ResizeObserver would never
	// re-measure — a remount starts collapsed and measures afresh.
	return (
		<ClampedNoteBody key={`${props.lines ?? 3}:${props.text}`} {...props} />
	);
}

function ClampedNoteBody({ text, lines = 3, className }: ClampedNoteProps) {
	const ref = useRef<HTMLSpanElement>(null);
	const [expanded, setExpanded] = useState(false);
	const [overflows, setOverflows] = useState(false);

	useEffect(() => {
		const el = ref.current;
		if (!el || expanded) return;
		const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
		measure();
		// Re-measure when the card's width changes (rotation, resize). New text
		// remounts this body instead (see the key in ClampedNote).
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, [expanded]);

	return (
		<span className={cn("flex flex-col items-start gap-1", className)}>
			<span
				ref={ref}
				className={cn("wrap-break-word", expanded ? undefined : CLAMP[lines])}
			>
				<LinkifiedText text={text} />
			</span>
			{overflows || expanded ? (
				<button
					type="button"
					onClick={(e) => {
						// Inside a pickup option's <label>: expanding the note must
						// not also pick the option.
						e.stopPropagation();
						setExpanded((v) => !v);
					}}
					aria-expanded={expanded}
					// The pseudo-element widens the hit area to 44px without
					// adding a 44px row under every note.
					className="relative font-medium text-foreground underline underline-offset-2 after:absolute after:-inset-x-2 after:-inset-y-3.5 after:content-['']"
				>
					{expanded ? "Show less" : "Show more"}
				</button>
			) : null}
		</span>
	);
}
