import * as fs from "fs";
import * as path from "path";

interface RawComment {
  id: string;
  text: string;
  username: string;
  timestamp: string;
  likesCount: number;
  postCaption: string;
  postPermalink: string;
  mackenzieReplied: boolean;
}

interface EvalEntry {
  id: string;
  text: string;
  username: string;
  likesCount: number;
  postCaption: string;
  classification: null;
  narrative_topic: null;
  info_type: null;
  ideal_response: null;
  notes: string;
}

const dataDir = path.resolve(
  new URL(".", import.meta.url).pathname,
  "../data"
);
const commentsFile = path.join(dataDir, "voice-samples/all-comments-pool.json");
const outputFile = path.join(dataDir, "eval-dataset.json");

const comments: RawComment[] = JSON.parse(
  fs.readFileSync(commentsFile, "utf-8")
);

console.log(`Loaded ${comments.length} comments`);

// Helper patterns to pre-categorize candidates
const narrativePatterns =
  /screen\s*time|ai\s*(is|will|are|ruin|destroy|bad|awful)|artificial intelligence.*bad|sweden.*ban|research\s*shows.*screen/i;
const infoPatterns =
  /where.*locat|how.*enroll|how.*sign up|how.*register|what.*cost|tuition|how much|what age|what grade|when.*open|new.*school|campus|where.*alpha/i;
const communityPatterns =
  /love this|amazing|❤️|🙏|👏|so true|keep it up|you're awesome|thank you|beautiful|inspiring|🙌|👑|💯|🔥|amen|yes!|preach/i;
const trollPatterns =
  /scam|fraud|cult|brainwash|pyramid|fake|snake oil|grift|ponzi|shill/i;
const spamPatterns =
  /check.*profile|DM.*for|click.*link|follow.*back|promo code|discount|earn\s*\$|make\s*money/i;

function categorize(
  c: RawComment
):
  | "narrative_shaping"
  | "informational"
  | "community_building"
  | "delete"
  | "skip"
  | "mixed" {
  if (spamPatterns.test(c.text)) return "delete";
  if (trollPatterns.test(c.text) && c.likesCount < 3) return "delete";
  if (narrativePatterns.test(c.text)) return "narrative_shaping";
  if (infoPatterns.test(c.text)) return "informational";
  if (communityPatterns.test(c.text) && c.text.length < 200) {
    return "community_building";
  }
  if (c.text.length < 5) return "skip";
  return "mixed";
}

// Sample across categories
const buckets: Record<string, RawComment[]> = {
  narrative_shaping: [],
  informational: [],
  community_building: [],
  delete: [],
  skip: [],
  mixed: [],
};

for (const c of comments) {
  const cat = categorize(c);
  buckets[cat].push(c);
}

console.log("\nCategory distribution:");
for (const [cat, items] of Object.entries(buckets)) {
  console.log(`  ${cat}: ${items.length}`);
}

// Sample target: 100 comments
// ~25 narrative, ~20 community, ~15 informational, ~15 delete, ~15 skip, ~10 mixed/boundary
function sample<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

const sampled: RawComment[] = [
  ...sample(buckets.narrative_shaping, 25),
  ...sample(buckets.community_building, 20),
  ...sample(buckets.informational, 15),
  ...sample(buckets.delete, 15),
  ...sample(buckets.skip, 10),
  ...sample(buckets.mixed, 15),
];

// Also include comments MacKenzie actually replied to (high value for eval)
const repliedTo = comments.filter((c) => c.mackenzieReplied);
const repliedSample = sample(
  repliedTo.filter((c) => !sampled.some((s) => s.id === c.id)),
  10
);

sampled.push(...repliedSample);

console.log(`\nSampled ${sampled.length} comments for eval dataset`);
console.log(`  Including ${repliedSample.length} that MacKenzie replied to`);

const evalDataset: EvalEntry[] = sampled.map((c) => ({
  id: c.id,
  text: c.text,
  username: c.username,
  likesCount: c.likesCount,
  postCaption: c.postCaption.slice(0, 200),
  classification: null,
  narrative_topic: null,
  info_type: null,
  ideal_response: null,
  notes: categorize(c) + (c.mackenzieReplied ? " (MacKenzie replied)" : ""),
}));

fs.writeFileSync(outputFile, JSON.stringify(evalDataset, null, 2));
console.log(`\nSaved to ${outputFile}`);
console.log(
  "\nNext: Review and fill in classification, narrative_topic, info_type, and ideal_response for each entry."
);
console.log(
  "The 'notes' field has a rough auto-categorization to help, but human labeling is required."
);
