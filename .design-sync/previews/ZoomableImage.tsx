import { ZoomableImage } from "kedaipal";

const SAMPLE_IMG =
	"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='240'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%237BA394'/%3E%3Cstop offset='1' stop-color='%23010066'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='320' height='240' fill='url(%23g)'/%3E%3C/svg%3E";

export function Thumbnail() {
	return (
		<ZoomableImage
			src={SAMPLE_IMG}
			alt="Payment QR code"
			className="aspect-square w-40 rounded-xl object-cover"
			caption="DuitNow QR"
		/>
	);
}
