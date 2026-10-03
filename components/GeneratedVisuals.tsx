"use client";

import { ImagePlaceholder } from "@/components/ImagePlaceholder";
import type { FinalDirectionBoard, GeneratedImage, ImageRequestRecord } from "@/types";

interface Props {
  images: GeneratedImage[];
  requests: ImageRequestRecord[];
  board: FinalDirectionBoard;
  requestLimit: number;
  imageLimit: number;
  requestsRemaining: number;
  imagesRemaining: number;
  isGenerating: boolean;
  onSelect: (id: string, target: "logo" | "visual") => void;
  onRetry: (requestId: string) => void;
}

export function GeneratedVisuals({ images, requests, board, requestLimit, imageLimit, requestsRemaining, imagesRemaining, isGenerating, onSelect, onRetry }: Props) {
  const successful = requests.filter((request) => request.status === "succeeded");
  const failed = requests.filter((request) => request.status === "failed");
  return <section className="visualLibrary">
    <header><div><p className="eyebrow">GENERATED MATERIAL</p><h1>Visual library</h1><p>Compare generated material, then add images to either eligible Working Board area.</p></div><div><strong>{images.length} / {imageLimit}</strong><span>{requestsRemaining} of {requestLimit} requests remaining · {imagesRemaining} images remaining</span></div></header>
    {isGenerating && <div className="visualLoading" role="status">Generating two visual directions… You may continue using the workspace.</div>}
    {failed.map((request) => { const retrySucceeded = requests.some((item) => item.retryOfRequestId === request.requestId && item.status === "succeeded"); return <div className="visualRequestFailure" key={request.requestId}><p>{retrySucceeded ? "The earlier attempt did not complete. Its retry succeeded." : request.safeErrorMessage ?? "The visuals could not be generated. Please try again."}</p>{!retrySucceeded && <button type="button" disabled={isGenerating} onClick={() => onRetry(request.requestId)}>Retry request</button>}</div>; })}
    {successful.map((request, requestIndex) => {
      const pair = request.imageIds.map((id) => images.find((image) => image.id === id)).filter((image): image is GeneratedImage => Boolean(image));
      return <section className="visualRequestGroup" key={request.requestId}>
        <div className="visualRequestMeta"><span>Request {String(requestIndex + 1).padStart(2, "0")}</span><p>{request.promptText}</p><time dateTime={request.completedAt}>{request.completedAt ? new Date(request.completedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : ""}</time></div>
        <div className="visualPair">{pair.map((image) => {
          const logoSelected = board.selectedLogoImageId === image.id;
          const referenceSelected = board.selectedVisualImageIds.includes(image.id);
          return <article className={logoSelected || referenceSelected ? "selected" : ""} key={image.id}>
            <ImagePlaceholder image={image} />
            <div className="libraryMeta"><div><strong>{image.id}</strong><span>Generated visual {image.imageIndex ?? ""}</span></div></div>
            <div className="visualActions">
              <button type="button" className={referenceSelected ? "selected" : ""} onClick={() => onSelect(image.id, "visual")}>{referenceSelected ? "Added to visual references" : "Use as visual reference"}</button>
              <button type="button" className={logoSelected ? "selected" : ""} onClick={() => onSelect(image.id, "logo")}>{logoSelected ? "Added to logo / symbol" : "Use for logo / symbol"}</button>
            </div>
          </article>;
        })}</div>
      </section>;
    })}
    {!successful.length && !isGenerating ? <div className="libraryEmpty"><span>◇</span><h2>No generated visuals yet</h2><p>Use Generate visual in the AI conversation to create the first pair.</p></div> : null}
  </section>;
}
