import { ChevronDown, Clock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	formatFulfilmentTime,
	hhmmFromMinutes,
	MINUTES_PER_DAY,
	timeMinutesFromHhmm,
} from "../../../convex/lib/fulfilmentDate";
import { cn } from "../../lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

/**
 * Themed time picker (86eyp5rav follow-up) — a field-styled trigger opening a
 * single scrollable list of times ("9:00 AM, 9:30 AM, …", the Google-Calendar
 * pattern), replacing the browser's unstyled native `<input type="time">`
 * dropdown on DASHBOARD surfaces. One column beats hour/minute/AM-PM wheels
 * here: store hours land on the half-hour, so picking is one scroll + one tap.
 *
 * Deliberately NOT used on the buyer checkout: there the native input opens
 * the OS time wheel on phones, which no custom popover beats — the ugliness
 * this fixes is a desktop-dashboard problem (see TimeField).
 *
 * Value contract matches the native input it replaces: an "HH:MM" string
 * (convex/lib/fulfilmentDate's hhmm space). An off-grid value (e.g. a legacy
 * 9:15 save) is injected into the list in order, so it stays visible and
 * selected rather than silently vanishing.
 */
export function TimePicker({
	value,
	onChange,
	stepMinutes = 30,
	includeEndOfDay = true,
	showIcon = true,
	disabled = false,
	isError = false,
	"aria-label": ariaLabel,
	className,
}: {
	/** "HH:MM" (24h) — the same value a native time input holds. */
	value: string;
	onChange: (next: string) => void;
	/** List granularity. 30 covers store hours; pass 15/5 where finer matters. */
	stepMinutes?: number;
	/** Append 23:59 as the terminal option ("11:59 PM") — the "until midnight"
	 * choice and the open-all-day sentinel's second half. */
	includeEndOfDay?: boolean;
	/** Clock glyph in the trigger. Turn it OFF in dense repeated layouts (the
	 * per-weekday hours grid renders 14 of these): there the surrounding rows
	 * already say "times", so the icon is pure noise AND it eats ~32px of a
	 * narrow phone column — enough to truncate "12:00 AM" to "12…". */
	showIcon?: boolean;
	disabled?: boolean;
	isError?: boolean;
	"aria-label"?: string;
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	const selectedRef = useRef<HTMLButtonElement | null>(null);

	const selectedMinutes = timeMinutesFromHhmm(value);
	const options: number[] = [];
	for (let m = 0; m < MINUTES_PER_DAY; m += stepMinutes) options.push(m);
	if (includeEndOfDay) options.push(MINUTES_PER_DAY - 1);
	if (!Number.isNaN(selectedMinutes) && !options.includes(selectedMinutes)) {
		options.push(selectedMinutes);
		options.sort((a, b) => a - b);
	}

	// Center the current value when the list opens — a 49-option list is only
	// usable if it opens where the seller already is.
	useEffect(() => {
		if (!open) return;
		// After the portal paints. scrollIntoView is absent in jsdom — optional.
		const id = requestAnimationFrame(() => {
			selectedRef.current?.scrollIntoView?.({ block: "center" });
		});
		return () => cancelAnimationFrame(id);
	}, [open]);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					disabled={disabled}
					aria-label={ariaLabel}
					aria-invalid={isError || undefined}
					className={cn(
						// The Input "field" recipe, as a button: same border,
						// radius, focus ring and invalid state so the trigger is
						// indistinguishable from its sibling form fields.
						"flex min-h-11 w-full min-w-0 items-center gap-2 rounded-xl border border-input bg-transparent px-3.5 text-left text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30",
						className,
					)}
				>
					{showIcon ? (
						<Clock
							className="size-4 shrink-0 text-muted-foreground"
							aria-hidden="true"
						/>
					) : null}
					<span className="flex-1 truncate tabular-nums">
						{Number.isNaN(selectedMinutes)
							? "Pick a time"
							: formatFulfilmentTime(selectedMinutes)}
					</span>
					<ChevronDown
						className="size-4 shrink-0 text-muted-foreground"
						aria-hidden="true"
					/>
				</button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="max-h-64 w-36 overflow-y-auto p-1"
			>
				<ul className="flex flex-col">
					{options.map((minutes) => {
						const selected = minutes === selectedMinutes;
						return (
							<li key={minutes}>
								<button
									type="button"
									ref={selected ? selectedRef : undefined}
									aria-pressed={selected}
									onClick={() => {
										onChange(hhmmFromMinutes(minutes));
										setOpen(false);
									}}
									className={cn(
										"w-full rounded-lg px-3 py-2 text-left text-sm tabular-nums transition-colors hover:bg-accent/10",
										selected
											? "bg-accent/10 font-semibold text-accent-emphasis"
											: "text-foreground",
									)}
								>
									{formatFulfilmentTime(minutes)}
								</button>
							</li>
						);
					})}
				</ul>
			</PopoverContent>
		</Popover>
	);
}
