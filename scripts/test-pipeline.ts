import { classifyComment } from "@instagram-commenter/core/ai";
import { generateReply } from "@instagram-commenter/core/ai";
import { retrieveForComment } from "@instagram-commenter/core/knowledge";
import { createDb } from "@instagram-commenter/core/db";

const DATABASE_URL = process.env.DATABASE_URL;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!DATABASE_URL || !ANTHROPIC_API_KEY || !OPENAI_API_KEY) {
  console.error(
    "DATABASE_URL, ANTHROPIC_API_KEY, and OPENAI_API_KEY are required."
  );
  process.exit(1);
}

const db = createDb(DATABASE_URL);

const TEST_COMMENTS = [
  // Narrative shaping
  {
    text: "Research shows screen time is destroying kids' ability to focus. Sweden banned it. Why would you double down on screens?",
    caption: "Our students just completed an amazing project using AI tools",
    likes: 342,
    username: "concerned_parent_22",
  },
  {
    text: "AI is ruining children's brains. This is child abuse disguised as innovation.",
    caption: "2 Hour Learning means more time for life skills",
    likes: 89,
    username: "tradschool_mom",
  },
  // Community building
  {
    text: "This is absolutely incredible! My daughter would LOVE this 🙌",
    caption: "Watch our students present their entrepreneurship projects",
    likes: 15,
    username: "happy_mom_tx",
  },
  {
    text: "You are doing God's work MacKenzie. Keep going!",
    caption: "Another day at Alpha School",
    likes: 45,
    username: "education_fan",
  },
  // Informational
  {
    text: "How do I enroll my kids? We're in Austin. What ages do you accept?",
    caption: "Alpha School is growing!",
    likes: 3,
    username: "austin_dad",
  },
  {
    text: "Are you planning to open a location in Chicago? We need this here!",
    caption: "New campus opening soon",
    likes: 28,
    username: "chi_town_parent",
  },
  // Delete candidates
  {
    text: "check my profile for amazing deals 💰💰💰 click the link",
    caption: "Our students learning robotics",
    likes: 0,
    username: "promo_bot_2024",
  },
  // Skip
  {
    text: "🔥",
    caption: "Alpha students at the science fair",
    likes: 1,
    username: "random_user",
  },
  {
    text: "My child has been diagnosed with severe anxiety and I'm worried about the screen time. She's in therapy and her doctor says no screens. What should I do?",
    caption: "How 2 Hour Learning works",
    likes: 5,
    username: "worried_parent",
  },
  // Boundary case — negative but NOT delete
  {
    text: "This looks like a scam. How is 2 hours of learning enough? These kids are going to be so behind when they get to the real world.",
    caption: "Our approach to education",
    likes: 67,
    username: "skeptical_teacher",
  },
];

async function runTest(
  comment: (typeof TEST_COMMENTS)[0],
  index: number
) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`TEST ${index + 1}: "${comment.text.slice(0, 80)}..."`);
  console.log(`  Likes: ${comment.likes} | Author: @${comment.username}`);

  // Step 1: Classify
  console.log("\n  [1] CLASSIFYING...");
  const classification = await classifyComment(
    {
      commentText: comment.text,
      postCaption: comment.caption,
      likesCount: comment.likes,
      authorUsername: comment.username,
      isTopLevel: true,
    },
    ANTHROPIC_API_KEY!
  );

  console.log(
    `  → ${classification.classification} (${(classification.confidence * 100).toFixed(0)}% confidence)`
  );
  if (classification.narrative_topic)
    console.log(`    Narrative: ${classification.narrative_topic}`);
  if (classification.info_type)
    console.log(`    Info type: ${classification.info_type}`);
  if (classification.skip_reason)
    console.log(`    Skip reason: ${classification.skip_reason}`);
  if (classification.delete_reason)
    console.log(`    Delete reason: ${classification.delete_reason}`);

  // Step 2: If reply needed, retrieve + generate
  if (
    classification.classification === "narrative_shaping" ||
    classification.classification === "community_building" ||
    classification.classification === "informational"
  ) {
    console.log("\n  [2] RETRIEVING KNOWLEDGE...");
    const retrieval = await retrieveForComment(
      comment.text,
      classification.classification,
      classification.narrative_topic ?? null,
      { db, openaiApiKey: OPENAI_API_KEY! }
    );

    console.log(
      `  → ${retrieval.knowledge.length} knowledge results, ${retrieval.examples.length} examples`
    );
    console.log(
      `  → Has relevant knowledge: ${retrieval.hasRelevantKnowledge}`
    );

    if (
      !retrieval.hasRelevantKnowledge &&
      classification.classification === "narrative_shaping"
    ) {
      console.log(
        "\n  [3] SKIPPED — No relevant knowledge for narrative shaping (guardrail working)"
      );
      return;
    }

    console.log("\n  [3] GENERATING REPLY...");
    const reply = await generateReply(
      {
        commentText: comment.text,
        postCaption: comment.caption,
        classificationGroup: classification.classification,
        narrativeTopic: classification.narrative_topic,
        infoType: classification.info_type,
        knowledge: retrieval.knowledge,
        examples: retrieval.examples,
      },
      ANTHROPIC_API_KEY!
    );

    if (reply.skip) {
      console.log(`  → SKIPPED: ${reply.reason}`);
    } else {
      console.log(`  → REPLY (${reply.reply_text.length} chars):`);
      console.log(`    "${reply.reply_text}"`);
    }
  } else {
    console.log(`\n  [2-3] NO REPLY NEEDED (${classification.classification})`);
  }
}

async function main() {
  console.log("=== End-to-End Pipeline Test ===");
  console.log(`Testing ${TEST_COMMENTS.length} comments\n`);
  console.log(
    "NOTE: Without deployed DB/knowledge bank, retrieval will return empty results."
  );
  console.log(
    "The generator will still work using voice rules alone.\n"
  );

  for (let i = 0; i < TEST_COMMENTS.length; i++) {
    await runTest(TEST_COMMENTS[i], i);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("Pipeline test complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Pipeline test failed:", err);
  process.exit(1);
});
