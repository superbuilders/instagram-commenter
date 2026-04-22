import { classifyComment } from "@instagram-commenter/core/ai";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const MISCLASSIFIED = [
  {
    text: "AI will be solution for country future! But SOME people can't realize it",
    gold: "narrative_shaping",
    reason: "Participating in AI debate (positive stance)"
  },
  {
    text: "AI is transforming education in a remarkable way. Mastering these technologies is essential, but combining them with life skills creates a truly holistic learning experience. A perfect approach for preparing students for the future.",
    gold: "narrative_shaping",
    reason: "Substantive argument about AI and life skills"
  },
  {
    text: "Intentional screen time 🙌💙",
    gold: "narrative_shaping",
    reason: "Matches hot-topic narrative exactly"
  },
  {
    text: "AI is such an important tool to elevate learning!🙌",
    gold: "narrative_shaping",
    reason: "Substantive position on AI"
  }
];

async function main() {
  if (!ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY required");
    process.exit(1);
  }

  console.log("=== Debugging Misclassifications ===\n");

  for (const item of MISCLASSIFIED) {
    console.log(`Comment: "${item.text}"`);
    console.log(`Expected: ${item.gold} (${item.reason})`);
    
    const result = await classifyComment({
      commentText: item.text,
      postCaption: item.text.includes("solution for country future") 
        ? "Do you believe him? I actually do. I’ve heard this too many times. But I also think teachers are being put in a no-win situation with little to no support. Overall our teachers are underpaid and under"
        : "AI is the future of education. We use it for 2 hours a day and spend the rest on life skills.",
      likesCount: 5,
      authorUsername: "user",
      isTopLevel: true
    }, ANTHROPIC_API_KEY);

    const icon = result.classification === item.gold ? "✅" : "❌";
    console.log(`${icon} Predicted: ${result.classification} (${Math.round(result.confidence * 100)}%)`);
    console.log(`   Rationale Tags: ${result.rationale_tags?.join(", ") ?? "none"}`);
    console.log("-".repeat(40));
  }
}

main().catch(console.error);
