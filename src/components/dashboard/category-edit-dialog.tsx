import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { EyeOff, ImagePlus, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { type FormEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { convexErrorMessage } from "../../lib/format";
import { reorderByIds } from "../../lib/reorder";
import { categorySlugSchema, slugify } from "../../lib/slug";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SortableList } from "../ui/sortable-list";
import { Textarea } from "../ui/textarea";

type CategoryRow = FunctionReturnType<
	typeof api.categories.listForRetailer
>[number];

interface CategoryEditDialogProps {
	open: boolean;
	onClose: () => void;
	/** When set, the dialog edits this category; when undefined it creates a
	 * new one against `retailerId`. */
	category: CategoryRow | undefined;
	retailerId: Id<"retailers">;
	storeSlug: string;
}

/**
 * Create/edit one category — name, an auto-derived (but editable) slug,
 * optional description + tile image, and, when editing, an "Arrange products"
 * drag list that reorders the category's own product order (independent of the
 * global product sort). Modeled on PickupLocationEditDialog: bottom sheet,
 * local state, server errors surfaced inline.
 */
export function CategoryEditDialog({
	open,
	onClose,
	category,
	retailerId,
	storeSlug,
}: CategoryEditDialogProps) {
	const createCategory = useMutation(api.categories.create);
	const updateCategory = useMutation(api.categories.update);
	const generateUploadUrl = useMutation(api.products.generateUploadUrl);

	const isEditing = category !== undefined;
	const [name, setName] = useState(category?.name ?? "");
	const [slug, setSlug] = useState(category?.slug ?? "");
	// Auto-fill the slug from the name until the seller edits it by hand —
	// after that their spelling wins (same convention as store signup).
	const [slugTouched, setSlugTouched] = useState(isEditing);
	const [description, setDescription] = useState(category?.description ?? "");
	// Image: `undefined` = untouched, `null` = staged removal, string = staged
	// replacement — mapped straight onto the mutation's null-clear convention.
	const [stagedImage, setStagedImage] = useState<
		{ id: string; previewUrl: string } | null | undefined
	>(undefined);
	const [uploading, setUploading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [serverError, setServerError] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const shownImageUrl =
		stagedImage === undefined
			? (category?.imageUrl ?? null)
			: (stagedImage?.previewUrl ?? null);

	async function handleFile(file: File | undefined) {
		if (!file) return;
		setUploading(true);
		setServerError(null);
		try {
			const url = await generateUploadUrl();
			const res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": file.type },
				body: file,
			});
			if (!res.ok) throw new Error("Upload failed");
			const { storageId } = (await res.json()) as { storageId: string };
			setStagedImage({ id: storageId, previewUrl: URL.createObjectURL(file) });
		} catch (err) {
			setServerError(convexErrorMessage(err));
		} finally {
			setUploading(false);
		}
	}

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setServerError(null);
		const cleanName = name.trim();
		if (cleanName.length === 0) {
			setServerError("Category name is required.");
			return;
		}
		const parsedSlug = categorySlugSchema.safeParse(slug);
		if (!parsedSlug.success) {
			setServerError(parsedSlug.error.issues[0]?.message ?? "Invalid link");
			return;
		}
		setSaving(true);
		try {
			if (isEditing && category) {
				await updateCategory({
					categoryId: category._id,
					name: cleanName,
					slug: parsedSlug.data,
					// Empty string clears server-side.
					description: description.trim(),
					imageStorageId:
						stagedImage === undefined ? undefined : (stagedImage?.id ?? null),
				});
			} else {
				await createCategory({
					retailerId,
					name: cleanName,
					slug: parsedSlug.data,
					description: description.trim() || undefined,
					imageStorageId: stagedImage?.id,
				});
			}
			onClose();
		} catch (err) {
			setServerError(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	return (
		<Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in" />
				<Dialog.Content
					className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col rounded-t-3xl border-t border-border bg-background shadow-xl data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom lg:inset-x-auto lg:left-1/2 lg:top-1/2 lg:bottom-auto lg:w-full lg:max-w-lg lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-3xl lg:border"
					aria-describedby={undefined}
				>
					<div className="flex items-center justify-between border-b border-border px-5 py-3">
						<Dialog.Title className="text-base font-semibold">
							{isEditing ? "Edit category" : "New category"}
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

					<form
						onSubmit={handleSubmit}
						className="flex min-h-0 flex-1 flex-col"
					>
						<div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
							<div className="flex flex-col gap-1.5">
								<label htmlFor="category-name" className="text-sm font-medium">
									Name
								</label>
								<Input
									id="category-name"
									value={name}
									onChange={(e) => {
										setName(e.target.value);
										if (!slugTouched) setSlug(slugify(e.target.value));
									}}
									placeholder="Daily Meals, Event Packages…"
									autoComplete="off"
									required
									className="h-11"
								/>
							</div>

							<div className="flex flex-col gap-1.5">
								<label htmlFor="category-slug" className="text-sm font-medium">
									Link
								</label>
								<Input
									id="category-slug"
									value={slug}
									onChange={(e) => {
										setSlugTouched(true);
										setSlug(e.target.value);
									}}
									placeholder="daily-meals"
									autoComplete="off"
									required
									className="h-11 font-mono text-[13px]"
								/>
								<p className="text-xs text-muted-foreground">
									Buyers open this category at{" "}
									<span className="font-mono text-foreground">
										kedaipal.com/{storeSlug}/c/{slug || "…"}
									</span>{" "}
									— share it straight into WhatsApp.
								</p>
							</div>

							<div className="flex flex-col gap-1.5">
								<label
									htmlFor="category-description"
									className="text-sm font-medium"
								>
									Description (optional)
								</label>
								<Textarea
									id="category-description"
									value={description}
									onChange={(e) => setDescription(e.target.value)}
									placeholder="Shown under the category name on your storefront."
									rows={2}
									maxLength={280}
								/>
							</div>

							<div className="flex flex-col gap-1.5">
								<span className="text-sm font-medium">Image (optional)</span>
								<div className="flex items-center gap-3">
									<button
										type="button"
										onClick={() => fileInputRef.current?.click()}
										disabled={uploading}
										className="flex h-20 w-32 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-muted/40 transition-colors hover:border-ring disabled:opacity-50"
										aria-label={
											shownImageUrl
												? "Replace category image"
												: "Add category image"
										}
									>
										{shownImageUrl ? (
											<img
												src={shownImageUrl}
												alt=""
												className="size-full object-cover"
											/>
										) : (
											<ImagePlus
												className="size-5 text-muted-foreground"
												aria-hidden
											/>
										)}
									</button>
									<div className="flex flex-col items-start gap-1">
										<p className="text-xs text-muted-foreground">
											{uploading
												? "Uploading…"
												: "Shown on the category tile. Landscape works best."}
										</p>
										{shownImageUrl ? (
											<button
												type="button"
												onClick={() => setStagedImage(null)}
												className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
											>
												Remove image
											</button>
										) : null}
									</div>
								</div>
								<input
									ref={fileInputRef}
									type="file"
									accept="image/*"
									className="hidden"
									onChange={(e) => {
										handleFile(e.target.files?.[0]);
										e.target.value = "";
									}}
								/>
							</div>

							{isEditing && category ? (
								<ArrangeProducts categoryId={category._id} />
							) : null}

							{serverError ? (
								<p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
									{serverError}
								</p>
							) : null}
						</div>

						<div className="border-t border-border bg-background px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
							<Button
								type="submit"
								disabled={saving || uploading}
								className="h-12 w-full text-base"
							>
								{saving
									? "Saving…"
									: isEditing
										? "Save changes"
										: "Create category"}
							</Button>
						</div>
					</form>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

/**
 * Drag list of the category's products in THEIR within-category order.
 * Saves on drop (independent of the form's Save — arrangement is its own
 * action, not a staged edit). Archived/hidden products stay listed and
 * flagged so their position is never silently lost.
 */
function ArrangeProducts({ categoryId }: { categoryId: Id<"categories"> }) {
	const products = useQuery(api.categories.listProductsForCategory, {
		categoryId,
	});
	const reorderProducts = useMutation(api.categories.reorderProducts);
	const [localOrder, setLocalOrder] = useState<Id<"products">[] | null>(null);

	if (products === undefined) return null;
	if (products.length === 0) {
		return (
			<div className="flex flex-col gap-1 rounded-xl border border-dashed border-border p-4">
				<p className="text-sm font-medium">No products in this category yet</p>
				<p className="text-xs text-muted-foreground">
					Assign products from each product's edit page — look for the
					Categories section.
				</p>
			</div>
		);
	}

	const ordered = localOrder
		? reorderByIds(products, localOrder, (p) => p.productId)
		: products;

	async function handleReorder(orderedIds: string[]) {
		const prev = localOrder;
		setLocalOrder(orderedIds as Id<"products">[]); // optimistic
		try {
			await reorderProducts({
				categoryId,
				orderedProductIds: orderedIds as Id<"products">[],
			});
		} catch (err) {
			setLocalOrder(prev);
			toast.error(convexErrorMessage(err));
		}
	}

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-col">
				<span className="text-sm font-medium">Arrange products</span>
				<p className="text-xs text-muted-foreground">
					Drag to set the order buyers see on this category's page.
				</p>
			</div>
			<SortableList
				items={ordered}
				getId={(p) => p.productId}
				onReorder={handleReorder}
				className="flex flex-col gap-2"
				renderItem={(p, handle) => (
					<div
						className={`flex items-center gap-2 rounded-xl border border-border bg-card p-2 ${p.active ? "" : "opacity-55"}`}
					>
						{handle}
						<div className="size-10 shrink-0 overflow-hidden rounded-lg bg-muted">
							{p.imageUrl ? (
								<img
									src={p.imageUrl}
									alt=""
									className="size-full object-cover"
								/>
							) : null}
						</div>
						<span className="min-w-0 flex-1 truncate text-sm font-medium">
							{p.name}
						</span>
						{!p.active ? (
							<span className="shrink-0 text-xs text-muted-foreground">
								Archived
							</span>
						) : p.hidden ? (
							<span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
								<EyeOff className="size-3" aria-hidden />
								Hidden
							</span>
						) : null}
					</div>
				)}
			/>
		</div>
	);
}
