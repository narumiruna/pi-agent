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
