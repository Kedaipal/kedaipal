import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders seller-authored product descriptions as a safe markdown subset.
 *
 * Security: this is the one place untrusted (seller-authored) content reaches a
 * public page (docs/product-variants.md §6/§7). react-markdown does NOT render
 * raw HTML unless `rehype-raw` is added — which it deliberately is not here — so
 * embedded `<script>`/`<img onerror>` render as inert text. URLs are sanitized
 * by react-markdown's default transform (blocks `javascript:` etc.). We further
 * narrow the surface: markdown images are dropped (sellers use the product image
 * gallery, not inline images) and links open in a new tab with noopener.
 */
const components = {
	img: () => null,
	a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
		<a
			href={href}
			target="_blank"
			rel="noopener noreferrer nofollow"
			className="text-accent underline underline-offset-2"
		>
			{children}
		</a>
	),
	ul: ({ children }: { children?: React.ReactNode }) => (
		<ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>
	),
	ol: ({ children }: { children?: React.ReactNode }) => (
		<ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>
	),
	h1: ({ children }: { children?: React.ReactNode }) => (
		<h3 className="mt-3 mb-1 text-base font-semibold">{children}</h3>
	),
	h2: ({ children }: { children?: React.ReactNode }) => (
		<h3 className="mt-3 mb-1 text-base font-semibold">{children}</h3>
	),
	h3: ({ children }: { children?: React.ReactNode }) => (
		<h4 className="mt-3 mb-1 text-sm font-semibold">{children}</h4>
	),
	p: ({ children }: { children?: React.ReactNode }) => (
		<p className="my-2 leading-relaxed">{children}</p>
	),
};

export function Markdown({ children }: { children: string }) {
	return (
		<div className="text-sm text-muted-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
				{children}
			</ReactMarkdown>
		</div>
	);
}
