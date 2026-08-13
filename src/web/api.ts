export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly params?: Record<string, unknown>,
  ) {
    super(code);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const body = (await response.json()) as T & {
    error?: { code: string; params?: Record<string, unknown> };
  };
  if (!response.ok)
    throw new ApiError(
      response.status,
      body.error?.code ?? "unknown_error",
      body.error?.params,
    );
  return body;
}

export function mutation(
  method: "DELETE" | "PATCH" | "POST" | "PUT",
  body?: unknown,
): RequestInit {
  return {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}
