// The house on/off switch. Lived privately inside `fulfilment-tab.tsx` until
// the booking form needed the same control (S7 "Instant book") — extracted
// rather than copied, so the two can't drift into different-looking toggles.
//
// A real `role="switch"` button, not a styled checkbox: it carries its own
// accessible name (`label`), so the surrounding row is free to be a plain
// heading + helper line.

export function ToggleSwitch({
	on,
	onChange,
	disabled = false,
	label,
}: {
	on: boolean;
	onChange: (next: boolean) => void;
	disabled?: boolean;
	/** Accessible name — what this switch turns on, in the user's words. */
	label: string;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={on}
			aria-label={label}
			disabled={disabled}
			onClick={() => onChange(!on)}
			className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 transition-colors ${
				on ? "border-accent bg-accent" : "border-input bg-muted"
			} ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
		>
			<span
				className={`inline-block size-5 rounded-full bg-background shadow-sm transition-transform ${
					on ? "translate-x-5" : "translate-x-0.5"
				}`}
			/>
		</button>
	);
}
