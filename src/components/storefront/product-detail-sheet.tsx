import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import type { Id } from "../../../convex/_generated/dataModel";
import { Markdown } from "../ui/markdown";
import { ZoomableImage } from "../ui/zoomable-image";
import type { StorefrontProduct } from "./product-card";
import {
	CustomOrderCard,
	EmptyGallery,
	type OnAddVariant,
	OptionPills,
	PriceLabel,
	PurchaseActions,
	PurchaseHints,
	type StorefrontVariant,
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
	onClose: () => void;
	onAdd: OnAddVariant;
}

/**
 * The SELLER's buyer-eye preview of a product, used by the product editor
 * (`app.products.$productId.tsx`) — a bottom sheet on mobile, a centered
 * dialog at `sm:`.
 *
 * Buyers never see this: the storefront routes every product tap to the
 * URL-addressable PAGE (`product-page.tsx`) on every breakpoint. A sheet is
 * still right HERE — a draft the seller is editing has no public URL to
 * navigate to, and the preview shouldn't leave the editor. Both surfaces
 * compose the same pieces from `product-purchase.tsx`, so what the seller
 * previews is what the buyer gets.
 */
export function ProductDetailSheet({
	product,
	retailerId,
	cartQuantity,
	onClose,
	onAdd,
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
							<PriceLabel
								value={pp.priceLabel}
								className="shrink-0 text-2xl"
							/>
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
						<PurchaseActions pp={pp} onAdd={onAdd} />
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
