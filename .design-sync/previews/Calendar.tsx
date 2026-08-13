import { useState } from "react";
import { Calendar } from "kedaipal";
import type { DateRange } from "react-day-picker";

export function Range() {
	const [range, setRange] = useState<DateRange | undefined>({
		from: new Date(2026, 7, 10),
		to: new Date(2026, 7, 14),
	});
	return <Calendar mode="range" selected={range} onSelect={setRange} defaultMonth={new Date(2026, 7, 1)} />;
}

export function Single() {
	const [date, setDate] = useState<Date | undefined>(new Date(2026, 7, 13));
	return <Calendar mode="single" selected={date} onSelect={setDate} defaultMonth={new Date(2026, 7, 1)} />;
}
