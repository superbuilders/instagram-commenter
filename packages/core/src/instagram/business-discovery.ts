const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";

const NOT_DISCOVERABLE_CODES = new Set([100, 110, 803]);

export interface DiscoveredProfile {
  id: string;
  username: string;
  name?: string;
  biography?: string;
  website?: string;
  followers_count?: number;
  media_count?: number;
  profile_picture_url?: string;
}

export type DiscoverBusinessProfileResult =
  | { status: "found"; profile: DiscoveredProfile }
  | { status: "not_discoverable"; error?: string }
  | { status: "error"; error: string };

function sanitizeUsername(username: string): string {
  return username.replace(/[^A-Za-z0-9._]/g, "");
}

function isNotDiscoverable(status: number, code?: number): boolean {
  if (status >= 400 && status < 500) return true;
  return code != null && NOT_DISCOVERABLE_CODES.has(code);
}

export async function discoverBusinessProfile(
  username: string,
  opts: { accessToken: string; igUserId: string }
): Promise<DiscoverBusinessProfileResult> {
  const sanitized = sanitizeUsername(username);
  if (!sanitized) {
    return { status: "not_discoverable", error: "invalid_username" };
  }

  const url = new URL(`${GRAPH_API_BASE}/${opts.igUserId}`);
  url.searchParams.set(
    "fields",
    `business_discovery.username(${sanitized}){id,username,name,biography,website,followers_count,media_count,profile_picture_url}`
  );
  url.searchParams.set("access_token", opts.accessToken);

  try {
    const response = await fetch(url.toString());
    const data = (await response.json()) as {
      business_discovery?: DiscoveredProfile;
      error?: { message?: string; type?: string; code?: number };
    };

    if (data.error) {
      const message = data.error.message ?? "Unknown Graph error";
      if (isNotDiscoverable(response.status, data.error.code)) {
        return { status: "not_discoverable", error: message };
      }
      return { status: "error", error: message };
    }

    if (!response.ok) {
      if (isNotDiscoverable(response.status)) {
        return { status: "not_discoverable", error: `HTTP ${response.status}` };
      }
      return { status: "error", error: `HTTP ${response.status}` };
    }

    const profile = data.business_discovery;
    if (!profile?.id) {
      return { status: "not_discoverable", error: "profile_not_returned" };
    }

    return { status: "found", profile };
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
