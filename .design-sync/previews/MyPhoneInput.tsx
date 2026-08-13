import { useState } from "react";
import { MyPhoneInput } from "kedaipal";

export function Default() {
	const [value, setValue] = useState("11-593 9791");
	return (
		<div className="w-72">
			<MyPhoneInput value={value} onChange={setValue} />
		</div>
	);
}

export function Empty() {
	const [value, setValue] = useState("");
	return (
		<div className="w-72">
			<MyPhoneInput value={value} onChange={setValue} />
		</div>
	);
}

export function Error() {
	const [value, setValue] = useState("123");
	return (
		<div className="w-72">
			<MyPhoneInput value={value} onChange={setValue} isError />
		</div>
	);
}
