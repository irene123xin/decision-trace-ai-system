"use client";

import { useEffect, useState } from "react";
import { readGeneratedImageBlob } from "@/services/imageStorageAdapter";
import type { GeneratedImage } from "@/types";

export function ImagePlaceholder({ image, compact = false }: { image: GeneratedImage; compact?: boolean }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const remoteImageUrl = image.storageBackend === "supabase" && image.sessionId
    ? `/api/images/${encodeURIComponent(image.sessionId)}/${encodeURIComponent(image.id)}`
    : null;
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    if (!remoteImageUrl && image.storageReference) {
      void readGeneratedImageBlob(image.storageReference).then((blob) => {
        if (!active || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      }).catch(() => undefined);
    }
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [image.storageReference, remoteImageUrl]);

  if (remoteImageUrl || image.storageReference) {
    const resolvedUrl = remoteImageUrl ?? imageUrl;
    return <div
      className={`generatedArtwork liveImage ${compact ? "compact" : ""} ${resolvedUrl ? "loaded" : "loading"}`}
      role="img"
      aria-label={`Generated visual ${image.imageIndex ?? ""} from request ${image.requestId ?? ""}`.trim()}
      style={resolvedUrl ? { backgroundImage: `url(${resolvedUrl})` } : undefined}
    ><span>{image.id}</span></div>;
  }
  return (
    <div className={`generatedArtwork ${image.kind} ${compact ? "compact" : ""}`} role="img" aria-label={`Generated visual ${image.id}`} style={{ "--c1": image.palette[0], "--c2": image.palette[1], "--c3": image.palette[2] } as React.CSSProperties}>
      {image.kind === "logo" ? (
        <div className="symbolShape"><i /><i /></div>
      ) : (
        <><div className="visualBlock one" /><div className="visualBlock two" /><div className="visualLine" /></>
      )}
      <span>{image.id}</span>
    </div>
  );
}
