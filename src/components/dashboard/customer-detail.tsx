import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import {
	ChevronRight,
	MessageCircle,
	NotebookPen,
	Pencil,
	Phone,
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
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { StatusBadge } from "./status-badge";

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
			{/* Profile header — this page exists so the seller can recognise and
			    reply: identity centred, WhatsApp as the hero action. */}
			<section className="flex flex-col items-center gap-2.5 rounded-2xl border border-border bg-card p-5">
				<div className="flex size-16 shrink-0 items-center justify-center rounded-full bg-foreground font-heading text-xl font-extrabold text-background">
					{hasName ? initialsOf(displayName) : <User className="size-6" />}
				</div>
				<div className="flex min-w-0 flex-col items-center gap-0.5 text-center">
					<p className="max-w-full truncate font-heading text-xl font-extrabold">
						{displayName}
					</p>
					<p className="max-w-full truncate text-[13px] text-muted-foreground">
						{formatPhone(customer.waPhone)} · customer since{" "}
						{formatShortDate(customer.firstOrderAt)}
					</p>
				</div>
				<div className="mt-1 flex w-full gap-2">
					<a
						href={`https://wa.me/${customer.waPhone}`}
						target="_blank"
						rel="noopener noreferrer"
						className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-accent/40 bg-accent/10 text-sm font-bold text-accent-emphasis transition-colors hover:bg-accent/20"
					>
						<MessageCircle className="size-4.5" />
						WhatsApp
					</a>
					<a
						href={`tel:+${customer.waPhone}`}
						aria-label={`Call ${displayName}`}
						className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-foreground transition-colors hover:bg-muted"
					>
						<Phone className="size-4.5" />
					</a>
				</div>
				<NameEditor customer={customer} />
			</section>

			{/* Lifetime metrics — the stat trio ("since" lives in the header). */}
			<section className="grid grid-cols-3 gap-2">
				<Metric label="Orders" value={String(customer.orderCount)} />
				<Metric
					label="Total spent"
					value={formatPrice(customer.totalSpent, currency)}
					emphasis
				/>
				<Metric
					label="Avg order"
					value={formatPrice(customer.averageOrderValue, currency)}
				/>
			</section>

			<NotesEditor customer={customer} />

			{/* Order history */}
			<section className="flex flex-col gap-3">
				<p className="font-heading text-base font-extrabold">Order history</p>
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
									<div className="flex min-w-0 flex-1 flex-col gap-0.5">
										<span className="truncate text-sm font-semibold">
											{o.items[0]?.name ?? `Order #${o.shortId}`}
											{o.items.length > 1 ? ` +${o.items.length - 1}` : ""}
										</span>
										<span className="text-xs text-muted-foreground">
											<span className="font-mono">#{o.shortId}</span>
											{" · "}
											{formatRelativeTime(o._creationTime)}
										</span>
									</div>
									<div className="flex shrink-0 items-center gap-2">
										<span className="text-sm font-semibold tabular-nums">
											{formatPrice(o.total, o.currency)}
										</span>
										<StatusBadge status={o.status as OrderStatus} />
									</div>
									<ChevronRight className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
								</Link>
							</li>
						))}
					</ul>
				)}
			</section>
		</div>
	);
}

/** "Aina Jasmin" → "AJ"; single word → first two letters. */
function initialsOf(name: string): string {
	const parts = name.trim().split(/\s+/);
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function Metric({
	label,
	value,
	emphasis = false,
}: {
	label: string;
	value: string;
	emphasis?: boolean;
}) {
	return (
		<div className="flex flex-col items-center gap-0.5 rounded-2xl border border-border bg-card px-2 py-3 text-center">
			<span
				className={`truncate font-heading text-[17px] font-extrabold tabular-nums ${emphasis ? "text-accent-emphasis" : ""}`}
			>
				{value}
			</span>
			<span className="text-[11px] font-semibold text-muted-foreground">
				{label}
			</span>
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
		/* Styled as a "sticky note" (dashed amber ticket) — visually distinct
		   from system data, and it invites editing. */
		<section className="flex flex-col gap-2 rounded-2xl border-2 border-dashed border-amber-600/25 bg-amber-50/60 p-4 dark:border-amber-500/30 dark:bg-amber-950/30">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
					<NotebookPen className="size-4" />
					<p className="text-[11px] font-bold uppercase tracking-[0.08em]">
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
						aria-label={customer.notes?.trim() ? "Edit notes" : "Add notes"}
						className="flex size-9 items-center justify-center rounded-full text-amber-700 transition-colors hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/40"
					>
						<Pencil className="size-4" />
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
