/**
 * The storefront's section heading row (z8r3fdegb5) — a real heading with an
 * optional right-aligned context fact ("Most ordered, last 7 days",
 * "23 items"). Replaces the old 11px all-caps eyebrows, which gave "Browse by
 * category", "Popular this week" and "All products" one identical whisper so
 * nothing ranked. One component so the three rows can't drift apart.
 *
 * An `<h2>`: these are the store home's real sections under the store-name
 * `<h1>`, so the document outline finally says so.
 */
export function SectionHeading({
	title,
	context,
}: {
	title: string;
	context?: string;
}) {
	return (
		<div className="flex items-baseline justify-between gap-3">
			<h2 className="font-heading text-[15px] font-extrabold tracking-tight">
				{title}
			</h2>
			{context ? (
				<span className="shrink-0 text-xs text-muted-foreground">
					{context}
				</span>
			) : null}
		</div>
	);
}
