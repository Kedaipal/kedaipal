import { Monitor, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { useTheme } from "../../hooks/useTheme";
import type { ThemePreference } from "../../lib/theme";

/**
 * Appearance — the one place the seller picks light / dark / match-device
 * (z8r3fdadub).
 *
 * It sits in its own "App" settings group rather than under Store, because
 * every other settings tab configures the STORE (which buyers see) while this
 * configures the APP on THIS DEVICE. Folding it into Store would imply it
 * travels with the account, which it deliberately does not — see lib/theme.ts.
 */

type Option = {
	id: ThemePreference;
	label: string;
	description: string;
	icon: ReactNode;
	preview: ReactNode;
};

/** A 64×48 caricature of a Kedaipal screen: header strip, two text lines and a
 *  mint action. dark-ok — literal colours on purpose: the swatch has to show the
 *  theme you are NOT in, so it must not follow the current one. */
function Preview({ tone }: { tone: "light" | "dark" | "split" }) {
	const light = (
		// dark-ok: a swatch has to show the theme you are NOT in, so these
		// literals must not follow the current one.
		<div className="flex h-full flex-col bg-white">
			<div className="h-[10px] border-b border-[hsl(214_32%_91%)]" />
			<div className="flex flex-col gap-[3px] px-[5px] py-[4px]">
				<div className="h-[4px] w-[70%] rounded-[2px] bg-[hsl(222_47%_11%)]" />
				<div className="h-[4px] w-[45%] rounded-[2px] bg-[hsl(214_32%_91%)]" />
				<div className="mt-[2px] h-[8px] w-[40%] rounded-[3px] bg-[hsl(160_84%_39%)]" />
			</div>
		</div>
	);
	const dark = (
		<div className="flex h-full flex-col bg-[hsl(222_47%_6%)]">
			<div className="h-[10px] border-b border-[hsl(217_33%_17%)]" />
			<div className="flex flex-col gap-[3px] px-[5px] py-[4px]">
				<div className="h-[4px] w-[70%] rounded-[2px] bg-[hsl(210_40%_98%)]" />
				<div className="h-[4px] w-[45%] rounded-[2px] bg-[hsl(217_33%_17%)]" />
				<div className="mt-[2px] h-[8px] w-[40%] rounded-[3px] bg-[hsl(160_84%_39%)]" />
			</div>
		</div>
	);
	return (
		<span
			aria-hidden="true"
			className="block h-12 w-16 shrink-0 overflow-hidden rounded-lg border border-border"
		>
			{tone === "light" ? light : null}
			{tone === "dark" ? dark : null}
			{tone === "split" ? (
				<span className="grid h-full grid-cols-2">
					<span className="block overflow-hidden">{light}</span>
					<span className="block overflow-hidden">{dark}</span>
				</span>
			) : null}
		</span>
	);
}

const OPTIONS: ReadonlyArray<Option> = [
	{
		id: "light",
		label: "Light",
		description: "The classic Kedaipal look",
		icon: <Sun className="size-4" aria-hidden="true" />,
		preview: <Preview tone="light" />,
	},
	{
		id: "dark",
		label: "Dark",
		description: "Easier on the eyes at night",
		icon: <Moon className="size-4" aria-hidden="true" />,
		preview: <Preview tone="dark" />,
	},
	{
		id: "system",
		label: "Match device",
		description: "Follows your phone's light/dark setting",
		icon: <Monitor className="size-4" aria-hidden="true" />,
		preview: <Preview tone="split" />,
	},
];

export function AppearanceTab() {
	const { preference, setPreference } = useTheme();

	return (
		<div className="flex flex-col gap-4">
			<section className="flex flex-col gap-3 rounded-2xl border border-input bg-background p-5 lg:p-6">
				<div className="flex flex-col gap-1">
					<h3 className="font-heading text-base font-extrabold">Theme</h3>
					<p className="text-sm text-muted-foreground">
						Choose how Kedaipal looks while you work.
					</p>
				</div>

				<fieldset className="flex flex-col gap-2.5">
					<legend className="sr-only">Theme</legend>
					{OPTIONS.map((option) => {
						const selected = preference === option.id;
						return (
							<label
								key={option.id}
								className={`flex min-h-[60px] cursor-pointer items-center gap-3.5 rounded-2xl border p-3.5 transition-colors ${
									selected
										? "border-accent bg-accent/10"
										: "border-border bg-card hover:border-foreground/20"
								}`}
							>
								<input
									type="radio"
									name="kp-theme"
									value={option.id}
									checked={selected}
									onChange={() => setPreference(option.id)}
									className="sr-only"
								/>
								{option.preview}
								<span className="flex min-w-0 flex-1 flex-col gap-0.5">
									<span className="flex items-center gap-1.5 text-sm font-semibold">
										{option.icon}
										{option.label}
									</span>
									<span className="text-xs text-muted-foreground">
										{option.description}
									</span>
								</span>
								<span
									aria-hidden="true"
									className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${
										selected
											? "border-accent bg-accent"
											: "border-muted-foreground/50"
									}`}
								>
									{selected ? (
										<svg
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="3.5"
											strokeLinecap="round"
											strokeLinejoin="round"
											className="size-3 text-accent-foreground"
										>
											<title>Selected</title>
											<path d="M20 6 9 17l-5-5" />
										</svg>
									) : null}
								</span>
							</label>
						);
					})}
				</fieldset>

				{/* Discoverability: the two things a seller would otherwise have to
				    discover by accident — that this is per-device, and that it never
				    reaches their buyers. */}
				<p className="rounded-xl bg-muted/50 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
					Applies to this device only, so your phone and your laptop can differ.
					It never reaches your buyers — they pick their own theme when they
					visit your storefront. Printed posters and QR codes always stay light.
				</p>
			</section>
		</div>
	);
}
