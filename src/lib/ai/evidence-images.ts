import type { AiContentPart } from "./client";
import type { EvidenceImage } from "./types";

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
