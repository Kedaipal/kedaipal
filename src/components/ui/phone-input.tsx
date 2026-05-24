import { ChevronsUpDown } from "lucide-react";
import * as React from "react";
import * as RPNInput from "react-phone-number-input";
import flags from "react-phone-number-input/flags";

import { Button } from "#/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "#/components/ui/command";
import { Input } from "#/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/ui/popover";
import { cn } from "#/lib/utils";

/**
 * shadcn phone input — ports https://shadcn-phone-input.vercel.app/ onto this
 * repo's primitives (Button, Input, Popover, Command). Wraps
 * `react-phone-number-input`, so values are E.164 (e.g. `+60123456789`). The
 * country selector is a searchable Popover + Command list with flags.
 */

type PhoneInputProps = Omit<
	React.ComponentProps<"input">,
	"onChange" | "value" | "ref"
> &
	Omit<RPNInput.Props<typeof RPNInput.default>, "onChange"> & {
		onChange?: (value: RPNInput.Value) => void;
	};

const PhoneInput: React.ForwardRefExoticComponent<PhoneInputProps> =
	React.forwardRef<
		React.ComponentRef<typeof RPNInput.default>,
		PhoneInputProps
	>(({ className, onChange, value, ...props }, ref) => {
		return (
			<RPNInput.default
				ref={ref}
				className={cn("flex", className)}
				flagComponent={FlagComponent}
				countrySelectComponent={CountrySelect}
				inputComponent={InputComponent}
				smartCaret={false}
				value={value || undefined}
				// react-phone-number-input emits `undefined` when cleared; coerce
				// to an empty string so the controlled form field stays a string.
				onChange={(v) => onChange?.(v || ("" as RPNInput.Value))}
				{...props}
			/>
		);
	});
PhoneInput.displayName = "PhoneInput";

const InputComponent = React.forwardRef<
	HTMLInputElement,
	React.ComponentProps<"input">
>(({ className, ...props }, ref) => (
	<Input
		ref={ref}
		className={cn("h-11 rounded-s-none rounded-e-xl text-base", className)}
		{...props}
	/>
));
InputComponent.displayName = "InputComponent";

interface CountryEntry {
	label: string;
	value: RPNInput.Country | undefined;
}

interface CountrySelectProps {
	disabled?: boolean;
	value: RPNInput.Country;
	options: CountryEntry[];
	onChange: (country: RPNInput.Country) => void;
}

function CountrySelect({
	disabled,
	value: selectedCountry,
	options: countryList,
	onChange,
}: CountrySelectProps) {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="outline"
					size="default"
					className="h-11 gap-1 rounded-s-xl rounded-e-none border-r-0 px-3 focus:z-10"
					disabled={disabled}
				>
					<FlagComponent
						country={selectedCountry}
						countryName={selectedCountry}
					/>
					<ChevronsUpDown
						className={cn("-mr-2 size-4 opacity-50", disabled && "hidden")}
					/>
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-[300px] p-0">
				<Command>
					<CommandInput placeholder="Search country..." />
					<CommandList>
						<CommandEmpty>No country found.</CommandEmpty>
						<CommandGroup>
							{countryList.map(({ value, label }) =>
								value ? (
									<CountrySelectOption
										key={value}
										country={value}
										countryName={label}
										selectedCountry={selectedCountry}
										onChange={onChange}
									/>
								) : null,
							)}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

interface CountrySelectOptionProps {
	country: RPNInput.Country;
	countryName: string;
	selectedCountry: RPNInput.Country;
	onChange: (country: RPNInput.Country) => void;
}

function CountrySelectOption({
	country,
	countryName,
	selectedCountry,
	onChange,
}: CountrySelectOptionProps) {
	return (
		// `data-checked` drives the trailing check icon baked into CommandItem.
		<CommandItem
			className="gap-2"
			data-checked={country === selectedCountry}
			onSelect={() => onChange(country)}
		>
			<FlagComponent country={country} countryName={countryName} />
			<span className="flex-1 text-sm">{countryName}</span>
			<span className="text-sm text-foreground/50">
				{`+${RPNInput.getCountryCallingCode(country)}`}
			</span>
		</CommandItem>
	);
}

function FlagComponent({ country, countryName }: RPNInput.FlagProps) {
	const Flag = flags[country];
	return (
		<span className="flex h-4 w-6 overflow-hidden rounded-sm bg-foreground/20 [&_svg:not([class*='size-'])]:size-full">
			{Flag && <Flag title={countryName} />}
		</span>
	);
}

export { PhoneInput };
