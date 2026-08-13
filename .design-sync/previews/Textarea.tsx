import { Textarea } from "kedaipal";

export function Default() {
	return (
		<Textarea
			className="w-72"
			placeholder="Add a note for the kitchen…"
			defaultValue="Please pack the frosting flowers separately."
		/>
	);
}

export function Disabled() {
	return (
		<Textarea className="w-72" placeholder="Add a note…" disabled />
	);
}
