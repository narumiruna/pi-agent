export interface OwnerClaims {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
}

export interface OwnerRule {
  ownerSub?: string;
  ownerEmail?: string;
}

export function assertOwner(claims: OwnerClaims, rule: OwnerRule): void {
  if (!rule.ownerSub && !rule.ownerEmail) {
    throw new Error("An owner subject or email must be configured");
  }
  if (rule.ownerSub && claims.sub !== rule.ownerSub) {
    throw new Error("OIDC subject is not the configured owner");
  }
  if (rule.ownerEmail) {
    if (claims.email_verified !== true) {
      throw new Error("OIDC owner email must be verified");
    }
    if (
      typeof claims.email !== "string" ||
      claims.email.toLowerCase() !== rule.ownerEmail.toLowerCase()
    ) {
      throw new Error("OIDC email is not the configured owner");
    }
  }
}
