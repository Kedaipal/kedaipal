import { Button } from "kedaipal";

export function Variants() {
	return (
		<div className="flex flex-wrap items-center gap-2">
			<Button variant="default">Default</Button>
			<Button variant="outline">Outline</Button>
			<Button variant="secondary">Secondary</Button>
			<Button variant="ghost">Ghost</Button>
			<Button variant="destructive">Destructive</Button>
			<Button variant="link">Link</Button>
		</div>
	);
}

export function Sizes() {
	return (
		<div className="flex flex-wrap items-center gap-2">
			<Button size="xs">Extra small</Button>
			<Button size="sm">Small</Button>
			<Button size="default">Default</Button>
			<Button size="lg">Large</Button>
			<Button size="icon" aria-label="Add">
				+
			</Button>
		</div>
	);
}

export function States() {
	return (
		<div className="flex flex-wrap items-center gap-2">
			<Button isLoading>Saving</Button>
			<Button disabled>Disabled</Button>
			<Button variant="destructive" disabled>
				Disabled destructive
			</Button>
		</div>
	);
}
