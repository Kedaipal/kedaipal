import { Link, type LinkProps } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Skeleton } from "../ui/skeleton";

interface PageHeaderBack {
	to: LinkProps["to"];
	label: string;
}

interface PageHeaderProps {
	title: string;
	subtitle?: ReactNode;
	actions?: ReactNode;
	back?: PageHeaderBack;
}

export function PageHeader({
	title,
	subtitle,
	actions,
	back,
}: PageHeaderProps) {
	return (
		<div className="hidden lg:block">
			<div className="flex flex-col gap-3 border-b border-border pb-5">
				{back ? (
					<Link
						to={back.to}
						className="inline-flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
					>
						<ChevronLeft className="size-3.5" />
						{back.label}
					</Link>
				) : null}
				<div className="flex items-end justify-between gap-6">
					<div className="flex min-w-0 flex-col gap-1">
						<h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight">
							{title}
						</h1>
						{subtitle ? (
							<div className="text-sm text-muted-foreground">{subtitle}</div>
						) : null}
					</div>
					{actions ? (
						<div className="flex shrink-0 items-center gap-2">{actions}</div>
					) : null}
				</div>
			</div>
		</div>
	);
}

interface PageHeaderSkeletonProps {
	hasBack?: boolean;
	hasSubtitle?: boolean;
	hasActions?: boolean;
}

export function PageHeaderSkeleton({
	hasBack = false,
	hasSubtitle = true,
	hasActions = false,
}: PageHeaderSkeletonProps) {
	return (
		<div className="hidden lg:block">
			<div className="flex flex-col gap-3 border-b border-border pb-5">
				{hasBack ? <Skeleton className="h-3 w-20 rounded" /> : null}
				<div className="flex items-end justify-between gap-6">
					<div className="flex min-w-0 flex-col gap-2">
						<Skeleton className="h-7 w-40 rounded" />
						{hasSubtitle ? <Skeleton className="h-4 w-56 rounded" /> : null}
					</div>
					{hasActions ? (
						<Skeleton className="h-10 w-32 shrink-0 rounded-md" />
					) : null}
				</div>
			</div>
		</div>
	);
}

export function MobilePageTitleSkeleton({
	hasSubtitle = false,
	hasAction = false,
}: {
	hasSubtitle?: boolean;
	hasAction?: boolean;
}) {
	return (
		<div className="flex items-start justify-between gap-3 lg:hidden">
			<div className="flex min-w-0 flex-col gap-1.5">
				<Skeleton className="h-6 w-28 rounded" />
				{hasSubtitle ? <Skeleton className="h-3 w-40 rounded" /> : null}
			</div>
			{hasAction ? (
				<Skeleton className="h-11 w-20 shrink-0 rounded-md" />
			) : null}
		</div>
	);
}
