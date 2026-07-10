import { ChevronLeft, ChevronRight } from "lucide-react";
import {
	type ChevronProps,
	DayPicker,
	getDefaultClassNames,
} from "react-day-picker";
import { cn } from "#/lib/utils";

// Calendar — thin themed wrapper over react-day-picker (brought in for the
// Insights custom date range). Themed to the Midnight Mint tokens; the app only
// uses range mode today but the component stays mode-agnostic so any future date
// picker reuses it. See docs/design-system.md.

function CalendarChevron({ orientation, className, ...props }: ChevronProps) {
	const Icon = orientation === "left" ? ChevronLeft : ChevronRight;
	return <Icon className={cn("size-4", className)} {...props} />;
}

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

export function Calendar({
	className,
	classNames,
	showOutsideDays = true,
	...props
}: CalendarProps) {
	const defaults = getDefaultClassNames();
	return (
		<DayPicker
			showOutsideDays={showOutsideDays}
			className={cn("w-fit", className)}
			classNames={{
				root: cn(defaults.root, "select-none"),
				months: cn(defaults.months, "flex flex-col gap-4"),
				month: cn(defaults.month, "flex flex-col gap-3"),
				month_caption: cn(
					defaults.month_caption,
					"flex h-9 items-center justify-center px-9",
				),
				caption_label: cn(
					defaults.caption_label,
					"font-heading text-sm font-semibold",
				),
				nav: cn(
					defaults.nav,
					"absolute inset-x-0 flex items-center justify-between px-1",
				),
				button_previous: cn(
					defaults.button_previous,
					"inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/10 hover:text-foreground disabled:opacity-40",
				),
				button_next: cn(
					defaults.button_next,
					"inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/10 hover:text-foreground disabled:opacity-40",
				),
				month_grid: cn(defaults.month_grid, "w-full border-collapse"),
				weekdays: cn(defaults.weekdays, "flex"),
				weekday: cn(
					defaults.weekday,
					"w-9 text-[11px] font-medium text-muted-foreground",
				),
				week: cn(defaults.week, "mt-1 flex w-full"),
				day: cn(
					defaults.day,
					"relative size-9 p-0 text-center text-sm [&:has(button)]:hover:bg-transparent",
					// Range band — a soft mint fill behind the middle days.
					"[&.rdp-range_middle]:bg-accent/12 [&.rdp-range_start]:rounded-l-full [&.rdp-range_end]:rounded-r-full [&.rdp-range_middle]:rounded-none",
				),
				day_button: cn(
					defaults.day_button,
					"inline-flex size-9 items-center justify-center rounded-full text-sm transition-colors hover:bg-accent/15 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
				),
				today: cn(defaults.today, "font-semibold text-accent-emphasis"),
				selected: cn(defaults.selected),
				range_start: cn(defaults.range_start),
				range_end: cn(defaults.range_end),
				range_middle: cn(defaults.range_middle),
				outside: cn(defaults.outside, "text-muted-foreground/40"),
				disabled: cn(defaults.disabled, "text-muted-foreground/30"),
				hidden: cn(defaults.hidden, "invisible"),
				...classNames,
			}}
			modifiersClassNames={{
				// The endpoints get the filled mint pill (overrides the hover state).
				range_start:
					"!bg-accent !text-primary-foreground hover:!bg-accent font-semibold",
				range_end:
					"!bg-accent !text-primary-foreground hover:!bg-accent font-semibold",
				selected: "font-semibold",
			}}
			components={{ Chevron: CalendarChevron }}
			{...props}
		/>
	);
}
