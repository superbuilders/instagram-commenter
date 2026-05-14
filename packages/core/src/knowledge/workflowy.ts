const BASE_URL = "https://workflowy.com/api/v1";

export interface WorkflowyNode {
  id: string;
  name: string;
  note: string;
  priority: number;
  createdAt: number;
  modifiedAt: number;
  completedAt: number | null;
  parentId: string | null;
  data?: { layoutMode?: string };
}

export interface WorkflowyClient {
  getNode(id: string): Promise<WorkflowyNode>;
  getChildren(parentId: string): Promise<WorkflowyNode[]>;
  exportAll(): Promise<WorkflowyNode[]>;
}

export function createWorkflowyClient(apiToken: string): WorkflowyClient {
  async function request<T>(
    path: string,
    params?: Record<string, string>
  ): Promise<T> {
    const url = new URL(`${BASE_URL}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`WorkFlowy API error ${response.status}: ${err}`);
    }

    return response.json() as Promise<T>;
  }

  return {
    async getNode(id: string) {
      return request<WorkflowyNode>(`/nodes/${id}`);
    },

    async getChildren(parentId: string) {
      const nodes = await request<WorkflowyNode[]>("/nodes", {
        parent_id: parentId,
      });
      return nodes.sort((a, b) => a.priority - b.priority);
    },

    async exportAll() {
      return request<WorkflowyNode[]>("/nodes-export");
    },
  };
}

export type BrainliftType =
  | "counter_arguments"
  | "voice_tone"
  | "institutional"
  | "deletion_guidelines"
  | "messaging_boundaries";

export interface BrainliftMapping {
  name: string;
  workflowyNodeId: string;
  brainliftType: BrainliftType;
  sourceWeight: number;
}

export interface SyncResult {
  mapping: BrainliftMapping;
  content: string;
  contentHash: string;
  modifiedAt: number;
}

export interface SyncReport {
  synced: SyncResult[];
  skipped: Array<{ name: string; nodeId: string; reason: string }>;
}

/**
 * Syncs BrainLifts from WorkFlowy. Every child node under rootNodeId
 * is treated as a BrainLift. The team manages this entirely in WorkFlowy:
 *
 * - Add a child node → it becomes a new BrainLift
 * - Complete/delete a child node → it's removed from the knowledge bank
 * - Edit content inside a node → changes are detected and re-ingested
 *
 * Type detection (checked in order):
 * 1. Explicit tag in name or note: [counter_arguments], [voice_tone], etc.
 * 2. Keyword matching on the node name (fallback)
 * 3. If neither works → skipped with a warning so someone can fix the name
 */
export async function syncBrainlifts(
  client: WorkflowyClient,
  rootNodeId: string
): Promise<SyncReport> {
  const children = await client.getChildren(rootNodeId);
  const synced: SyncResult[] = [];
  const skipped: SyncReport["skipped"] = [];

  for (const child of children) {
    // Skip completed nodes — team can "complete" a BrainLift to remove it
    if (child.completedAt) {
      skipped.push({
        name: child.name,
        nodeId: child.id,
        reason: "completed (treated as removed)",
      });
      continue;
    }

    const mapping = detectBrainliftType(child.name, child.note);
    if (!mapping) {
      skipped.push({
        name: child.name,
        nodeId: child.id,
        reason:
          "Could not detect BrainLift type. Add a tag like [voice_tone] to the name or note, or use a recognizable name (e.g., 'Counter-Arguments', 'Voice & Tone').",
      });
      continue;
    }

    const content = await collectNodeContent(client, child.id);
    if (!content.trim()) {
      skipped.push({
        name: child.name,
        nodeId: child.id,
        reason: "empty content",
      });
      continue;
    }

    const contentHash = await hashContent(content);

    synced.push({
      mapping: {
        ...mapping,
        workflowyNodeId: child.id,
      },
      content,
      contentHash,
      modifiedAt: child.modifiedAt,
    });
  }

  return { synced, skipped };
}

async function collectNodeContent(
  client: WorkflowyClient,
  nodeId: string
): Promise<string> {
  const node = await client.getNode(nodeId);
  const parts: string[] = [];

  if (node.name) parts.push(stripMarkdown(node.name));
  if (node.note) parts.push(node.note);

  const children = await client.getChildren(nodeId);
  for (const child of children) {
    if (child.completedAt) continue;
    const childContent = await collectNodeContent(client, child.id);
    if (childContent) parts.push(childContent);
  }

  return parts.join("\n\n");
}

const VALID_TYPES: Record<BrainliftType, number> = {
  counter_arguments: 1.5,
  voice_tone: 2.0,
  institutional: 1.0,
  deletion_guidelines: 1.0,
  messaging_boundaries: 1.0,
};

const KEYWORD_MAP: Array<{ keywords: string[]; type: BrainliftType }> = [
  { keywords: ["counter", "argument", "narrative"], type: "counter_arguments" },
  { keywords: ["voice", "tone"], type: "voice_tone" },
  { keywords: ["institutional", "knowledge", "facts", "enrollment", "location"], type: "institutional" },
  { keywords: ["delet", "guideline", "troll", "spam"], type: "deletion_guidelines" },
  { keywords: ["boundar", "messaging", "approved", "forbidden"], type: "messaging_boundaries" },
];

function detectBrainliftType(
  name: string,
  note: string
): Omit<BrainliftMapping, "workflowyNodeId"> | null {
  const combined = `${name} ${note}`.toLowerCase();

  // 1. Check for explicit tag: [counter_arguments], [voice_tone], etc.
  const tagMatch = combined.match(/\[(\w+)\]/);
  if (tagMatch) {
    const tagType = tagMatch[1] as BrainliftType;
    if (tagType in VALID_TYPES) {
      return {
        name: name.replace(/\s*\[\w+\]\s*/, "").trim(),
        brainliftType: tagType,
        sourceWeight: VALID_TYPES[tagType],
      };
    }
  }

  // 2. Fallback: keyword matching on name
  const lower = name.toLowerCase();
  for (const { keywords, type } of KEYWORD_MAP) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return { name, brainliftType: type, sourceWeight: VALID_TYPES[type] };
    }
  }

  return null;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/`(.*?)`/g, "$1");
}

async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
