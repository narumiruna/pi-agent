export const CHAT_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
export const MAX_CHAT_IMAGES = 4;
export const MAX_CHAT_IMAGE_BYTES = 4_500_000;
export const MAX_CHAT_IMAGE_BASE64_LENGTH =
  Math.ceil(MAX_CHAT_IMAGE_BYTES / 3) * 4;

export type ChatImageMimeType = (typeof CHAT_IMAGE_MIME_TYPES)[number];

export interface ChatImage {
  type: "image";
  data: string;
  mimeType: ChatImageMimeType;
}

export function normalizeChatImageMimeType(
  value: string,
): ChatImageMimeType | undefined {
  const mimeType = value.split(";", 1)[0]?.trim().toLowerCase();
  if (mimeType === "image/jpg") return "image/jpeg";
  return CHAT_IMAGE_MIME_TYPES.find((candidate) => candidate === mimeType);
}

export type ErrorCode =
  | "agent_busy"
  | "bad_request"
  | "cancelled"
  | "conflict"
  | "forbidden"
  | "internal_error"
  | "not_found"
  | "not_ready"
  | "origin_mismatch"
  | "provider_not_configured"
  | "unauthorized";

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    params?: Record<string, boolean | number | string>;
  };
}

export function apiError(
  code: ErrorCode,
  params?: Record<string, boolean | number | string>,
): ApiErrorBody {
  return params ? { error: { code, params } } : { error: { code } };
}
