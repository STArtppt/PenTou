import type { PlatformSlug } from "../../shared/types";

export interface PlatformAdapter {
  platform: PlatformSlug;
  credentialStrategy: "cookie" | "session-token" | "page-world";
  matches(url: URL): boolean;
  conversationId(url: URL): string | null;
  fetchRaw(id: string): Promise<string>;
}

export class PlatformFetchError extends Error {
  constructor(message: string, public reason: "not-logged-in" | "platform-api-changed") {
    super(message);
  }
}
