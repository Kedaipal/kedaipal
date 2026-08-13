import { Markdown } from "kedaipal";

const sample = `**Chocolate fudge cake** — rich Belgian chocolate sponge with a dark ganache finish.

- Serves 8–10
- Contains eggs, dairy, gluten
- [Allergen info](https://example.com)

Ask about *custom message plaques* at checkout.`;

export function Default() {
	return (
		<div className="w-72">
			<Markdown>{sample}</Markdown>
		</div>
	);
}
