import {
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldLabel,
	Input,
} from "kedaipal";

export function Valid() {
	return (
		<Field className="w-72">
			<FieldLabel htmlFor="store-name">Store name</FieldLabel>
			<FieldContent>
				<Input id="store-name" variant="field" defaultValue="Sue Chef Kitchen" />
				<FieldDescription>Shown to buyers on your storefront.</FieldDescription>
			</FieldContent>
		</Field>
	);
}

export function Errored() {
	return (
		<Field className="w-72">
			<FieldLabel htmlFor="wa-phone">WhatsApp number</FieldLabel>
			<FieldContent>
				<Input id="wa-phone" variant="field" isError placeholder="12-345 6789" />
				<FieldError errors={[{ message: "Enter a valid Malaysian mobile number." }]} />
			</FieldContent>
		</Field>
	);
}

export function Horizontal() {
	return (
		<Field orientation="horizontal" className="w-80 items-center">
			<FieldLabel htmlFor="min-order" className="w-32 shrink-0">
				Min. order (RM)
			</FieldLabel>
			<FieldContent>
				<Input id="min-order" variant="field" defaultValue="50" />
			</FieldContent>
		</Field>
	);
}
