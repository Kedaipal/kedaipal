import { Input } from "kedaipal";

export function Variants() {
	return (
		<div className="flex w-64 flex-col gap-3">
			<Input variant="default" placeholder="Compact toolbar search" />
			<Input variant="field" placeholder="Mobile form field (≥44px)" />
		</div>
	);
}

export function States() {
	return (
		<div className="flex w-64 flex-col gap-3">
			<Input variant="field" defaultValue="cake@example.com" />
			<Input variant="field" placeholder="Required" isError />
			<Input variant="field" placeholder="Disabled" disabled />
		</div>
	);
}
