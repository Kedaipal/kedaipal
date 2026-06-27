import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import {
	ChevronRight,
	MessageCircle,
	NotebookPen,
	Pencil,
	ShoppingBag,
	User,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { formatPhone, getDisplayName } from "../../lib/customer";
import {
	convexErrorMessage,
	formatPrice,
	formatRelativeTime,
	formatShortDate,
} from "../../lib/format";
import { StatusBadge } from "../../routes/app.orders.index";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

type CustomerWithMetrics = Doc<"customers"> & { averageOrderValue: number };

interface CustomerDetailProps {
	customer: CustomerWithMetrics;
	currency: string;
	orders: Doc<"orders">[];
	ordersLoading: boolean;
}

const NAME_MAX = 120;
const NOTES_MAX = 2000;
type OrderStatus = Doc<"orders">["status"];

export function CustomerDetail({
	customer,
	currency,
	orders,
	ordersLoading,
}: CustomerDetailProps) {
	const displayName = getDisplayName(customer);
	const hasName = Boolean(
		customer.name?.trim() || customer.waProfileName?.trim(),
	);

	return (
		<div className="flex flex-col gap-5 lg:max-w-3xl">
			{/* Contact */}
			<section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4">
				<div className="flex items-center gap-3">
					<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted text-base font-semibold text-muted-foreground">
						{hasName ? (
							displayName[0]?.toUpperCase()
						) : (
							<User className="size-5" />
						)}
					</div>
					<div className="min-w-0 flex-1">
						<p className="truncate text-lg font-semibold">{displayName}</p>
						<p className="truncate font-mono text-xs text-muted-foreground">
							{formatPhone(customer.waPhone)}
						</p>
					</div>
					<a
						href={`https://wa.me/${customer.waPhone}`}
						target="_blank"
						rel="noopener noreferrer"
						className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-500/10 text-green-600 transition-colors hover:bg-green-500/20"
						aria-label="Message on WhatsApp"
					>
						<MessageCircle className="size-5" />
					</a>
				</div>
				<NameEditor customer={customer} />
			</section>

			{/* Lifetime metrics */}
			<section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<Metric label="Orders" value={String(customer.orderCount)} />
				<Metric
					label="Lifetime"
					value={formatPrice(customer.totalSpent, currency)}
				/>
				<Metric
					label="Avg order"
					value={formatPrice(customer.averageOrderValue, currency)}
				/>
				<Metric
					label="Customer since"
					value={formatShortDate(customer.firstOrderAt)}
				/>
			</section>

			<NotesEditor customer={customer} />

			{/* Order history */}
			<section className="flex flex-col gap-3">
				<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
					Order history
				</p>
				{ordersLoading ? (
					<p className="text-sm text-muted-foreground">Loading orders…</p>
				) : orders.length === 0 ? (
					<div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-8 text-center">
						<ShoppingBag className="size-5 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">No orders yet.</p>
					</div>
				) : (
					<ul className="flex flex-col gap-2">
						{orders.map((o) => (
							<li key={o._id}>
								<Link
									to="/app/orders/$shortId"
									params={{ shortId: o.shortId }}
									className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5 transition-all hover:border-ring hover:shadow-sm"
								>
									<div className="flex min-w-0 flex-1 flex-col gap-1">
										<div className="flex items-center gap-2">
											<span className="font-mono text-sm font-semibold">
												#{o.shortId}
											</span>
											<StatusBadge status={o.status as OrderStatus} />
										</div>
										<span className="text-[11px] text-muted-foreground">
											{formatRelativeTime(o._creationTime)}
										</span>
									</div>
									<span className="shrink-0 text-sm font-semibold tabular-nums">
										{formatPrice(o.total, o.currency)}
									</span>
									<ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
								</Link>
							</li>
						))}
					</ul>
				)}
			</section>
		</div>
	);
}

function Metric({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-3">
			<span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
				{label}
			</span>
			<span className="text-base font-semibold tabular-nums">{value}</span>
		</div>
	);
}

function NameEditor({ customer }: { customer: Doc<"customers"> }) {
	const updateName = useMutation(api.customers.updateName);
	const [editing, setEditing] = useState(false);
	const [value, setValue] = useState(customer.name ?? "");
	const [saving, setSaving] = useState(false);

	async function handleSave() {
		setSaving(true);
		try {
			await updateName({ customerId: customer._id, name: value });
			setEditing(false);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	if (!editing) {
		return (
			<button
				type="button"
				onClick={() => {
					setValue(customer.name ?? "");
					setEditing(true);
				}}
				className="flex w-fit items-center gap-1.5 text-xs font-medium text-accent hover:underline"
			>
				<Pencil className="size-3.5" />
				{customer.name?.trim() ? "Edit name" : "Set a name"}
			</button>
		);
	}

	return (
		<div className="flex flex-col gap-2">
			<Input
				value={value}
				maxLength={NAME_MAX}
				onChange={(e) => setValue(e.target.value)}
				placeholder="Customer name"
				className="h-10"
			/>
			<p className="text-xs text-muted-foreground">
				Your label for this customer. Overrides their WhatsApp profile name.
				Leave blank to fall back to it.
			</p>
			<div className="flex gap-2">
				<Button onClick={handleSave} isLoading={saving} className="h-9 flex-1">
					Save
				</Button>
				<Button
					variant="secondary"
					onClick={() => setEditing(false)}
					disabled={saving}
					className="h-9"
				>
					Cancel
				</Button>
			</div>
		</div>
	);
}

function NotesEditor({ customer }: { customer: Doc<"customers"> }) {
	const updateNotes = useMutation(api.customers.updateNotes);
	const [editing, setEditing] = useState(false);
	const [value, setValue] = useState(customer.notes ?? "");
	const [saving, setSaving] = useState(false);

	async function handleSave() {
		setSaving(true);
		try {
			await updateNotes({ customerId: customer._id, notes: value });
			setEditing(false);
			toast.success("Notes saved");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	return (
		<section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<NotebookPen className="size-4 text-muted-foreground" />
					<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
						Private notes
					</p>
				</div>
				{!editing ? (
					<button
						type="button"
						onClick={() => {
							setValue(customer.notes ?? "");
							setEditing(true);
						}}
						className="text-xs font-medium text-accent hover:underline"
					>
						{customer.notes?.trim() ? "Edit" : "Add"}
					</button>
				) : null}
			</div>

			{editing ? (
				<div className="flex flex-col gap-2">
					<Textarea
						value={value}
						maxLength={NOTES_MAX}
						onChange={(e) => setValue(e.target.value)}
						placeholder="e.g. Allergic to nuts. VIP — deliver first."
						className="min-h-24"
					/>
					<div className="flex gap-2">
						<Button
							onClick={handleSave}
							isLoading={saving}
							className="h-9 flex-1"
						>
							Save notes
						</Button>
						<Button
							variant="secondary"
							onClick={() => setEditing(false)}
							disabled={saving}
							className="h-9"
						>
							Cancel
						</Button>
					</div>
				</div>
			) : customer.notes?.trim() ? (
				<p className="whitespace-pre-wrap text-sm">{customer.notes}</p>
			) : (
				<p className="text-sm text-muted-foreground">
					Only you can see these. Add allergies, preferences, or reminders.
				</p>
			)}
		</section>
	);
}
