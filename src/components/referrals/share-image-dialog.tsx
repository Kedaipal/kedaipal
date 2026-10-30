import { Download, Link2, Share } from "lucide-react";
import { useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { toast } from "sonner";
import { referralShareImageCopy } from "../../../convex/lib/referral";
import {
	type ReferralShareSurface,
	trackReferralShare,
} from "../../lib/ga-events";
import { copyText } from "../../lib/referral-share";
import {
	renderReferralShareImage,
	SHARE_IMAGE_SIZE,
	type ShareImageFormat,
	shareImageFileName,
} from "../../lib/referral-share-image";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";
import { ModeButton } from "../ui/mode-button";
import { Skeleton } from "../ui/skeleton";

/**
 * "Share as an image" — the referral invite as a picture, for the places a
 * text link can't travel (docs/referrals.md § The share image).
 *
 * The preview IS the file: the card is drawn on a canvas
 * (`renderReferralShareImage`) and the dialog shows that PNG, so what the
 * seller approves is byte-for-byte what the referee sees — the first build
 * showed a DOM look-alike that drifted from the download in dark mode.
 *
 * Two formats because the destinations have two shapes: Square for posts,
 * seller groups and chats; Story (9:16) for a WhatsApp status or an Instagram
 * / Facebook story — the dialog's own pitch, which a square image served
 * badly.
 *
 * Sharing comes first on a device that can share files (a phone): the system
 * share sheet puts the image straight into WhatsApp or Instagram, where a
 * download would strand it in Files. Where it can't (most desktops), the
 * primary becomes Download, and the label says so.
 */
export function ShareImageDialog({
	open,
	onClose,
	storeName,
	slug,
	link,
	surface,
}: {
	open: boolean;
	onClose: () => void;
	storeName: string;
	slug: string;
	link: string;
	surface: ReferralShareSurface;
}) {
	const [format, setFormat] = useState<ShareImageFormat>("square");
	const [image, setImage] = useState<{
		key: string;
		blob: Blob;
		url: string;
	} | null>(null);
	const [failed, setFailed] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const [canShareFiles, setCanShareFiles] = useState(false);
	// A callback ref, not useRef: the dialog's content mounts through a
	// portal one render AFTER `open` flips, so a ref read in the draw effect
	// was still null on first open and the draw reported a failure it never
	// retried. Holding the node in state re-runs the draw when it arrives.
	const [qrHost, setQrHost] = useState<HTMLDivElement | null>(null);
	// `attempt` is in the key so "Try again" re-runs the draw.
	const key = `${format}|${storeName}|${link}|${attempt}`;
	const ready = image?.key === key ? image : null;
	const copy = referralShareImageCopy(storeName);

	// Whether this device can hand a FILE to the share sheet — decided after
	// mount (no navigator during SSR), and only ever true where it works.
	useEffect(() => {
		try {
			const probe = new File([""], "probe.png", { type: "image/png" });
			setCanShareFiles(
				typeof navigator.canShare === "function" &&
					navigator.canShare({ files: [probe] }),
			);
		} catch {
			setCanShareFiles(false);
		}
	}, []);

	// Draw the card whenever the dialog opens or the format changes.
	useEffect(() => {
		if (!open || !qrHost) return;
		const svg = qrHost.querySelector("svg");
		if (!svg) {
			setFailed(true);
			return;
		}
		let cancelled = false;
		let url: string | null = null;
		setFailed(false);
		renderReferralShareImage({ format, storeName, link, qrSvg: svg })
			.then((blob) => {
				if (cancelled) return;
				url = URL.createObjectURL(blob);
				setImage({ key, blob, url });
			})
			.catch(() => {
				if (!cancelled) setFailed(true);
			});
		return () => {
			cancelled = true;
			if (url) {
				const revoked = url;
				URL.revokeObjectURL(revoked);
				// Never leave a revoked URL on screen (closing, then reopening).
				setImage((prev) => (prev?.url === revoked ? null : prev));
			}
		};
	}, [open, qrHost, format, storeName, link, key]);

	async function share() {
		if (!ready) return;
		const file = new File([ready.blob], shareImageFileName(slug, format), {
			type: "image/png",
		});
		try {
			await navigator.share({ files: [file] });
			trackReferralShare("image_share", surface);
		} catch (err) {
			// Closing the share sheet is a choice, not a failure.
			if (err instanceof DOMException && err.name === "AbortError") return;
			toast.error("Couldn't open sharing — save the image instead.");
		}
	}

	function save() {
		if (!ready) return;
		const a = document.createElement("a");
		a.href = ready.url;
		a.download = shareImageFileName(slug, format);
		a.click();
		trackReferralShare("image", surface);
	}

	async function copyLink() {
		if (await copyText(link)) {
			toast.success("Invite link copied");
			trackReferralShare("copy_link", surface);
		} else {
			toast.error("Couldn't copy — select the link and copy it by hand.");
		}
	}

	const { w, h } = SHARE_IMAGE_SIZE[format];
	const alt = `Your invite image: ${copy.eyebrow}, ${copy.headlineLead} ${copy.headlineRest} With a QR code to your link.`;

	return (
		<Dialog open={open} onOpenChange={(o) => !o && onClose()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Share as an image</DialogTitle>
					<DialogDescription>
						For your WhatsApp status, an Instagram story or a seller group. The
						QR opens your invite.
					</DialogDescription>
				</DialogHeader>

				<div className="grid grid-cols-2 gap-2">
					<ModeButton
						active={format === "square"}
						onClick={() => setFormat("square")}
						title="Square"
						subtitle="Posts & groups"
					/>
					<ModeButton
						active={format === "story"}
						onClick={() => setFormat("story")}
						title="Story"
						subtitle="Status & stories"
					/>
				</div>

				{/* The stage holds one fixed height, so switching format never
				    makes the dialog jump; the image fits inside it. */}
				<div
					className="flex h-[min(52vh,400px)] items-center justify-center rounded-2xl bg-muted p-3"
					data-testid="share-image-stage"
				>
					{ready ? (
						<img
							src={ready.url}
							alt={alt}
							width={w}
							height={h}
							className="max-h-full w-auto max-w-full rounded-xl shadow-md"
							style={{ aspectRatio: `${w} / ${h}` }}
						/>
					) : failed ? (
						<div className="flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
							<p>Couldn't draw the image.</p>
							<Button
								variant="outline"
								className="h-11"
								onClick={() => setAttempt((n) => n + 1)}
							>
								Try again
							</Button>
						</div>
					) : (
						<Skeleton
							className="max-h-full rounded-xl"
							style={{
								aspectRatio: `${w} / ${h}`,
								height: format === "story" ? "100%" : "auto",
								width: format === "story" ? "auto" : "100%",
							}}
						/>
					)}
				</div>

				{/* The QR the canvas rasterises — in the DOM so its SVG exists,
				    off screen so it is never seen twice. */}
				<div ref={setQrHost} className="sr-only" aria-hidden="true">
					<QRCode value={link} size={512} level="M" />
				</div>

				<div className="flex flex-col gap-2">
					{canShareFiles ? (
						<>
							<Button className="h-12 w-full" onClick={share} disabled={!ready}>
								<Share className="size-4" aria-hidden="true" />
								Share image
							</Button>
							<p className="text-center text-xs text-muted-foreground">
								Opens your share sheet: WhatsApp, Instagram, Facebook and more.
							</p>
							<div className="grid grid-cols-2 gap-2">
								<Button
									variant="outline"
									className="h-11"
									onClick={save}
									disabled={!ready}
								>
									<Download className="size-4" aria-hidden="true" />
									Save image
								</Button>
								<Button variant="outline" className="h-11" onClick={copyLink}>
									<Link2 className="size-4" aria-hidden="true" />
									Copy link
								</Button>
							</div>
						</>
					) : (
						<>
							<Button className="h-12 w-full" onClick={save} disabled={!ready}>
								<Download className="size-4" aria-hidden="true" />
								Download PNG
							</Button>
							<Button variant="outline" className="h-11" onClick={copyLink}>
								<Link2 className="size-4" aria-hidden="true" />
								Copy link
							</Button>
						</>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
