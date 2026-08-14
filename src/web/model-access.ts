export type ProviderCredentialType = "api_key" | "oauth";

export interface ModelOption {
  provider: string;
  id: string;
  name: string;
}

export interface ProviderOption {
  id: string;
  name: string;
  status: {
    configured: boolean;
    source?: string;
    label?: string;
    credentialType?: ProviderCredentialType;
    disconnectable: boolean;
  };
  auth: {
    apiKey?: { name: string };
    oauth?: {
      name: string;
      loginLabel?: string;
      subscription: boolean;
    };
  };
}

export interface ProviderAuthTask {
  providerId: string;
  providerName: string;
  phase: "cancelled" | "failed" | "starting" | "succeeded" | "waiting";
  method?: string;
  message?: string;
  url?: string;
  userCode?: string;
  verificationUri?: string;
  expiresAt?: number;
  error?: "login_failed";
}

export interface ModelData {
  current?: ModelOption;
  thinkingLevel: string;
  thinkingLevels: string[];
  authPending: boolean;
  models: ModelOption[];
  providers: ProviderOption[];
}
