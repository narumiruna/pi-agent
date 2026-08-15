const RESERVED_WEB_PREFIXES = ["/api", "/assets", "/auth", "/health"];

function acceptsHtml(accept: string | undefined): boolean {
  return Boolean(
    accept?.split(",").some((range) => {
      const [mediaType, ...parameters] = range.trim().toLowerCase().split(";");
      if (mediaType !== "text/html") return false;
      const quality = parameters
        .map((parameter) => parameter.trim())
        .find((parameter) => parameter.startsWith("q="));
      return quality === undefined || Number(quality.slice(2)) > 0;
    }),
  );
}

export function shouldServeWebApp(
  pathname: string,
  accept: string | undefined,
): boolean {
  if (!acceptsHtml(accept)) return false;
  return !RESERVED_WEB_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
