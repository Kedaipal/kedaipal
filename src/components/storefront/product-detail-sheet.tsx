import { Link as LinkIcon, X } from "lucide-react";
import { Dialog } from "radix-ui";
import type { Id } from "../../../convex/_generated/dataModel";
import { Markdown } from "../ui/markdown";
import { ZoomableImage } from "../ui/zoomable-image";
import type { StorefrontProduct } from "./product-card";
import {
	AddToCartButton,
	CustomOrderCard,
	EmptyGallery,
	GoToCheckoutBar,
	type OnAddVariant,
	OptionPills,
	PurchaseHints,
	PurchaseStepper,
	type StorefrontVariant,
	shareProductLink,
	TotalPreviewRow,
	useProductPurchase,
} from "./product-purchase";

export type { StorefrontVariant };

interface ProductDetailSheetProps {
	product: StorefrontProduct | null;
	retailerId: Id<"retailers">;
	/** Units of this product already in the cart (custom lines excluded) — the
	 * stepper defaults to the REMAINING amount toward the product's minimum
	 * order quantity, so the happy path never trips the checkout block. */
	cartQuantity: number;
	/** Whole-cart item count (all products) — drives the "Go to checkout" CTA in
	 * the footer: it only appears once the cart holds ≥1 item. Optional so the
	 * sheet renders standalone (e.g. in tests) with the CTA hidden. */
	cartItemCount?: number;
	/** Whole-cart money total (minor units) — shown on the checkout CTA. 0 (or a
	 * quote-only cart) hides the amount, keeping the count + arrow. */
	cartTotal?: number;
	/** Shareable path/URL of this product's page (/$slug/p/<productSlug>) —
	 * shows a copy-link button in the header. Absent (slug-less legacy row, or
	 * a standalone render) → no share affordance. See 86eybrhrt PR2. */
	shareUrl?: string;
	onClose: () => void;
	onAdd: OnAddVariant;
	/** Jump straight from the product view to the checkout page without
	 * closing the modal by hand first. Provided by the grid, which closes this
	 * sheet then navigates. Absent → the CTA is hidden. See docs. */
	onCheckout?: () => void;
}

/**
 * The in-store product view — a bottom sheet on mobile (fast cart-building
 * while browsing), a centered dialog at `sm:`. The URL-addressable sibling is
 * the product PAGE (product-page.tsx); both compose the same purchase pieces
 * from product-purchase.tsx, so the buy box can't drift between them.
 */
export function ProductDetailSheet({
	product,
	retailerId,
	cartQuantity,
	cartItemCount = 0,
	cartTotal = 0,
	shareUrl,
	onClose,
	onAdd,
	onCheckout,
}: ProductDetailSheetProps) {
	const pp = useProductPurchase({ product, retailerId, cartQuantity });

	const open = product !== null;
	if (!product) {
		// Keep the dialog mounted (radix needs a stable root) but render nothing.
		return <Dialog.Root open={false} onOpenChange={(o) => !o && onClose()} />;
	}

	return (
		<Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in" />
				<Dialog.Content
					className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col rounded-t-3xl border-t border-border bg-background shadow-xl data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-1/2 sm:w-[min(92vw,760px)] sm:max-h-[86dvh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border"
					aria-describedby={undefined}
				>
					<div className="flex items-center justify-between border-b border-border px-5 py-3">
						<Dialog.Title className="text-base font-semibold">
							Product details
						</Dialog.Title>
						<div className="flex items-center gap-1">
							{shareUrl ? (
								<button
									type="button"
									onClick={() => void shareProductLink(shareUrl)}
									className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
									aria-label="Copy product link"
								>
									<LinkIcon className="size-4" />
								</button>
							) : null}
							<Dialog.Close asChild>
								<button
									type="button"
									className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
									aria-label="Close"
								>
									<X className="size-5" />
								</button>
							</Dialog.Close>
						</div>
					</div>

					<div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6">
						{pp.images.length > 0 ? (
							<div className="-mx-5 mb-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-5 sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-3 sm:overflow-visible sm:px-0">
								{pp.images.map((url) => (
									<ZoomableImage
										key={url}
										src={url}
										alt={product.name}
										caption={product.name}
										wrapperClassName="w-64 shrink-0 snap-start sm:w-full"
										className="aspect-square w-full rounded-2xl object-cover"
									/>
								))}
							</div>
						) : (
							<EmptyGallery
								name={product.name}
								className="mb-4 aspect-[16/10] w-full sm:aspect-[2.4/1]"
							/>
						)}

						<div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
							<h2 className="text-xl font-bold leading-tight">
								{product.name}
							</h2>
							<p className="shrink-0 text-2xl font-bold tabular-nums">
								{pp.priceLabel}
							</p>
						</div>

						<OptionPills pp={pp} />
						<PurchaseHints pp={pp} />
						<CustomOrderCard pp={pp} onAdd={onAdd} />

						{product.description ? (
							<div className="mt-4">
								<Markdown>{product.description}</Markdown>
							</div>
						) : null}
					</div>

					<div className="border-t border-border bg-background px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
						<TotalPreviewRow pp={pp} />
						<div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-center">
							<PurchaseStepper pp={pp} />
							<AddToCartButton pp={pp} onAdd={onAdd} />
						</div>
						<GoToCheckoutBar
							cartItemCount={cartItemCount}
							cartTotal={cartTotal}
							currency={product.currency}
							onCheckout={onCheckout}
						/>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
