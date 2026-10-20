import { Fragment } from "react";
import { linkify } from "../../lib/linkify";

/**
 * An external link opened from seller-authored content — a new tab, no opener,
 * no SEO endorsement. Shared with `Markdown` so a link in a product description
 * and one in a pickup note look and behave the same. `accent-emphasis`, not
 * raw `accent`: the raw mint fails contrast as text, worst on the mint-tinted
 * pickup card.
 */
export function ExternalLink({
	href,
	children,
}: {
	href?: string;
	children?: React.ReactNode;
}) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noopener noreferrer nofollow"
			className="font-medium text-accent-emphasis underline underline-offset-2"
		>
			{children}
		</a>
	);
}

/**
 * Plain seller text with its bare URLs made tappable (see `linkify`). Everything
 * else stays text — React escapes it — and a long URL may break anywhere so it
 * can't push a narrow card wider than the screen.
 */
export function LinkifiedText({ text }: { text: string }) {
	// Text segments stay bare text nodes, so a note without a URL renders
	// exactly as it did before links were recognised.
	return linkify(text).map((segment, i) =>
		segment.kind === "link" ? (
			// biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and derived from immutable text
			<span key={i} className="break-all">
				<ExternalLink href={segment.href}>{segment.text}</ExternalLink>
			</span>
		) : (
			// biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and derived from immutable text
			<Fragment key={i}>{segment.text}</Fragment>
		),
	);
}
