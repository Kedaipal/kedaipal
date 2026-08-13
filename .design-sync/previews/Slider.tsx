import { useState } from "react";
import { Slider } from "kedaipal";

export function Default() {
	const [value, setValue] = useState(40);
	return (
		<div className="w-64">
			<Slider value={value} onValueChange={setValue} aria-label="Delivery radius" />
		</div>
	);
}

export function CustomRange() {
	const [value, setValue] = useState(3);
	return (
		<div className="w-64">
			<Slider
				value={value}
				onValueChange={setValue}
				min={1}
				max={10}
				step={1}
				aria-label="Minimum order quantity"
			/>
		</div>
	);
}
