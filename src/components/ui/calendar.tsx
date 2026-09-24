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
				// `relative` is LOAD-BEARING, not decoration. The nav (chevrons) is
				// `position: absolute; inset-x-0`, and react-day-picker's own
				// stylesheet — which we deliberately don't import, theming from
				// scratch instead — is the only thing that would otherwise make the
				// root a containing block. Without it the chevrons resolve against
				// whatever ancestor happens to be positioned (the BODY, on the
				// booking checkout) and render in the page margins, so the month is
				// unnavigable. Measured before the fix: nav x=0 w=1280 against a
				// 510px-wide calendar.
				root: cn(defaults.root, "relative select-none"),
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
			// The range band lives HERE, on the modifier classes, and nowhere else.
			// It used to be `[&.rdp-range_middle]:bg-accent/12` on the day, which
			// never rendered: Tailwind reads `_` in an arbitrary variant as a space,
			// so the selector compiled to `&.rdp-range middle` and matched nothing
			// — and a `modifiersClassNames` entry REPLACES react-day-picker's own
			// `rdp-range_start/end` class, so the rounded-end rules had nothing to
			// hook onto either. The picked middle days showed as plain dates
			// (z8r3fdhpm7, found rendering the closed-dates sheet; the Insights
			// custom range had the same flat look).
			modifiersClassNames={{
				// The endpoints get the filled mint pill (overrides the hover
				// state), rounded on their outer side so the band reads as one
				// shape; a one-day range is both, so it is a full circle.
				range_start:
					"rounded-l-full !bg-accent !text-primary-foreground hover:!bg-accent font-semibold",
				range_end:
					"rounded-r-full !bg-accent !text-primary-foreground hover:!bg-accent font-semibold",
				// A soft mint fill behind the days in between.
				range_middle: "rounded-none bg-accent/12",
				selected: "font-semibold",
			}}
			components={{ Chevron: CalendarChevron }}
			{...props}
		/>
	);
}
