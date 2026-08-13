import { InputGroup, InputGroupAddon, InputGroupText, InputGroupTextarea } from "kedaipal";

export function WithCharacterCount() {
	return (
		<InputGroup className="w-72">
			<InputGroupTextarea
				placeholder="Add a note for this order…"
				defaultValue="Please pack the frosting flowers separately."
			/>
			<InputGroupAddon align="block-end">
				<InputGroupText>46 / 280</InputGroupText>
			</InputGroupAddon>
		</InputGroup>
	);
}
