import { Input, InputPrefixFrame } from "kedaipal";

export function Money() {
	return (
		<div className="w-56">
			<InputPrefixFrame prefix={<span className="text-base font-medium">RM</span>}>
				<Input variant="bare" defaultValue="50.00" className="min-h-11 px-3 text-base" />
			</InputPrefixFrame>
		</div>
	);
}

export function Slug() {
	return (
		<div className="w-72">
			<InputPrefixFrame
				prefix={<span className="text-sm">kedaipal.com/</span>}
			>
				<Input variant="bare" defaultValue="suechef-kitchen" className="min-h-11 px-3 text-base" />
			</InputPrefixFrame>
		</div>
	);
}

export function Invalid() {
	return (
		<div className="w-56">
			<InputPrefixFrame invalid prefix={<span className="text-base font-medium">RM</span>}>
				<Input variant="bare" placeholder="0.00" className="min-h-11 px-3 text-base" />
			</InputPrefixFrame>
		</div>
	);
}
