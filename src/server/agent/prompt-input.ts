import { join } from "node:path";
import type { ImageContent } from "@earendil-works/pi-ai";
import {
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_IMAGES,
  normalizeChatImageMimeType,
} from "../../shared/contracts.js";

function validatePromptImages(
  images: readonly ImageContent[] | undefined,
): ImageContent[] {
  if (!images) return [];
  if (images.length > MAX_CHAT_IMAGES) throw new Error("Too many images");
  let totalBytes = 0;
  return images.map((image) => {
    const mimeType = normalizeChatImageMimeType(image.mimeType);
    if (!mimeType) throw new Error("Image type is invalid");
    const bytes = Buffer.from(image.data, "base64");
    if (bytes.length < 1 || bytes.toString("base64") !== image.data)
      throw new Error("Image data is invalid");
    totalBytes += bytes.length;
    if (totalBytes > MAX_CHAT_IMAGE_BYTES)
      throw new Error("Images are too large");
    return { type: "image", data: image.data, mimeType };
  });
}

export function validateUserInput(
  message: string,
  images: readonly ImageContent[] | undefined,
): { text: string; images: ImageContent[] } {
  const text = message.trim();
  const promptImages = validatePromptImages(images);
  if ((text.length < 1 && promptImages.length < 1) || text.length > 100_000)
    throw new Error("Message is invalid");
  return { text, images: promptImages };
}

export function heartbeatFileGuidance(agentDir: string): string {
  const path = join(agentDir, "HEARTBEAT.md");
  return [
    `Pi Agent stores its scheduled heartbeat configuration at ${path}.`,
    `When the user asks to create or update HEARTBEAT.md without another path, write ${path}, not a relative file in the workspace.`,
    "Use YAML frontmatter with enabled and every fields for the schedule.",
  ].join(" ");
}

export function heartbeatExecutionPrompt(routine: string): string {
  return [
    "Execute the scheduled heartbeat routine below now.",
    "Treat it as work to perform, not as a request to configure the routine.",
    "Do not create or modify HEARTBEAT.md during this run.",
    "Report only the result that needs the user's attention.",
    "If nothing needs attention, reply exactly HEARTBEAT_OK.",
    "",
    "<heartbeat_routine>",
    routine,
    "</heartbeat_routine>",
  ].join("\n");
}
