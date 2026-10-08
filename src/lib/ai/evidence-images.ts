import type { PreparedAiImage } from "@/lib/storage/image-processing";
import type { AiContentPart } from "./client";
import type { EvidenceImage } from "./types";

function dataUrl(contentType: string, bytes: Buffer): string {
  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

/**
 * A prepared stored image as the AI receives it: one data URL, or the parts of a cut screenshot.
 * Pure, so the app and the prompt bench hand the model the same thing.
 */
export function toEvidenceImage(prepared: PreparedAiImage): EvidenceImage {
  if (prepared.parts.length === 1) {
    return { dataUrl: dataUrl(prepared.contentType, prepared.parts[0]!) };
  }
  return {
    parts: prepared.parts.map((part) => dataUrl(prepared.contentType, part)),
    overlapPx: prepared.overlapPx,
  };
}

/**
 * The message parts for a document's images, in order. Each part of a cut screenshot is preceded
 * by a line saying which image it belongs to and where, so the model reads the parts as one image.
 */
export function evidenceImageContent(images: readonly EvidenceImage[]): AiContentPart[] {
  // Once one image is cut, the others are numbered too, so "Image 2" means the same to the model.
  const numbered = images.some((image) => !("dataUrl" in image));
  return images.flatMap((image, index): AiContentPart[] => {
    if ("dataUrl" in image) {
      const part: AiContentPart = { type: "image_url", image_url: { url: image.dataUrl } };
      return numbered ? [{ type: "text", text: `Image ${index + 1}.` }, part] : [part];
    }
    return image.parts.flatMap((url, part): AiContentPart[] => [
      {
        type: "text",
        text: `Image ${index + 1}, part ${part + 1}/${image.parts.length} of one tall screenshot; parts overlap by ~${image.overlapPx} px.`,
      },
      { type: "image_url", image_url: { url } },
    ]);
  });
}
