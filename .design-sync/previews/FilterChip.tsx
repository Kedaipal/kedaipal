import { FilterChip, FilterChipRow } from "kedaipal";

export function Buckets() {
	return (
		<FilterChipRow>
			<FilterChip selected>All</FilterChip>
			<FilterChip count={4} countTone="attention">
				New
			</FilterChip>
			<FilterChip count={12}>Confirmed</FilterChip>
			<FilterChip>Packed</FilterChip>
		</FilterChipRow>
	);
}

export function AppliedFilters() {
	return (
		<FilterChipRow>
			<FilterChip tone="accent" selected>
				Unpaid
			</FilterChip>
			<FilterChip tone="accent">Due today</FilterChip>
			<FilterChip tone="accent">Delivery</FilterChip>
		</FilterChipRow>
	);
}
