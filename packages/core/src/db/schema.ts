import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  real,
  date,
  jsonb,
  index,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

// --- Enums ---

export const platformEnum = pgEnum("platform", ["instagram", "facebook"]);

export const classificationGroupEnum = pgEnum("classification_group", [
  "narrative_shaping",
  "community_building",
  "informational",
  "delete",
  "skip",
]);

export const pipelineStageEnum = pgEnum("pipeline_stage", [
  "ingest",
  "classify",
  "allocate",
  "retrieve",
  "generate",
  "verify",
  "slack_review",
  "post_reply",
  "delete_review",
  "delete_execute",
]);

export const pipelineStatusEnum = pgEnum("pipeline_status", [
  "started",
  "succeeded",
  "skipped",
  "failed",
]);

export const approvalStatusEnum = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
  "auto",
]);

export const sourceTypeEnum = pgEnum("source_type", [
  "brainlift",
  "ig_caption",
  "ig_reply",
  "substack",
  "podcast",
  "website",
  "slack_approved",
  "slack_edited",
]);

export const brainliftTypeEnum = pgEnum("brainlift_type", [
  "counter_arguments",
  "voice_tone",
  "institutional",
  "deletion_guidelines",
  "messaging_boundaries",
]);

// --- Tables ---

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  platform: platformEnum("platform").notNull().default("instagram"),
  platformId: varchar("platform_id", { length: 255 }).notNull().unique(),
  username: varchar("username", { length: 255 }).notNull(),
  displayName: varchar("display_name", { length: 255 }),
  accessToken: text("access_token"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    platform: platformEnum("platform").notNull().default("instagram"),
    platformPostId: varchar("platform_post_id", { length: 255 }).notNull(),
    caption: text("caption"),
    mediaType: varchar("media_type", { length: 50 }),
    permalink: text("permalink"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("posts_platform_post_id_idx").on(table.platformPostId),
  ]
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id),
    platformCommentId: varchar("platform_comment_id", { length: 255 }).notNull(),
    parentCommentId: uuid("parent_comment_id"),
    authorUsername: varchar("author_username", { length: 255 }),
    authorId: varchar("author_id", { length: 255 }),
    text: text("text").notNull(),
    likesCount: integer("likes_count").notNull().default(0),
    classificationGroup: classificationGroupEnum("classification_group"),
    classificationConfidence: real("classification_confidence"),
    narrativeTopic: varchar("narrative_topic", { length: 255 }),
    infoType: varchar("info_type", { length: 255 }),
    skipReason: varchar("skip_reason", { length: 255 }),
    deleteReason: varchar("delete_reason", { length: 255 }),
    classificationPolicyVersion: varchar("classification_policy_version", {
      length: 50,
    }),
    classificationRationaleTags: jsonb("classification_rationale_tags"),
    isFromAccountOwner: boolean("is_from_account_owner").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: varchar("deleted_by", { length: 255 }),
    deleteSlackTs: varchar("delete_slack_ts", { length: 255 }),
    commentedAt: timestamp("commented_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("comments_platform_comment_id_idx").on(table.platformCommentId),
    index("comments_post_classification_idx").on(
      table.postId,
      table.classificationGroup
    ),
  ]
);

export const replies = pgTable(
  "replies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commentId: uuid("comment_id")
      .notNull()
      .references(() => comments.id),
    originalText: text("original_text").notNull(),
    editedText: text("edited_text"),
    postedText: text("posted_text"),
    approvalStatus: approvalStatusEnum("approval_status").notNull().default("pending"),
    approvedBy: varchar("approved_by", { length: 255 }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    promptVersion: varchar("prompt_version", { length: 50 }),
    reviewOutcomeReason: varchar("review_outcome_reason", { length: 100 }),
    reviewOutcomeCategory: varchar("review_outcome_category", { length: 100 }),
    reviewOutcomeNotes: text("review_outcome_notes"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    platformReplyId: varchar("platform_reply_id", { length: 255 }),
    slackMessageTs: varchar("slack_message_ts", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("replies_comment_id_idx").on(table.commentId),
    index("replies_approval_status_idx").on(table.approvalStatus),
  ]
);

export const knowledgeSources = pgTable(
  "knowledge_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceType: sourceTypeEnum("source_type").notNull(),
    brainliftType: brainliftTypeEnum("brainlift_type"),
    title: varchar("title", { length: 500 }),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
    sourceWeight: real("source_weight").notNull().default(1.0),
    narrativeTopics: text("narrative_topics").array().default([]),
    sourceUrl: text("source_url"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("knowledge_sources_type_idx").on(table.sourceType, table.brainliftType),
  ]
);

export const brainliftSources = pgTable("brainlift_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  knowledgeSourceId: uuid("knowledge_source_id")
    .notNull()
    .references(() => knowledgeSources.id),
  workflowyNodeId: varchar("workflowy_node_id", { length: 255 }).notNull(),
  brainliftType: brainliftTypeEnum("brainlift_type").notNull(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  contentHash: varchar("content_hash", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bioLinkInventories = pgTable("bio_link_inventories", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id),
  profileUsername: varchar("profile_username", { length: 255 }).notNull(),
  sourceUrl: text("source_url").notNull(),
  refreshedAt: timestamp("refreshed_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("bio_link_inventories_account_idx").on(table.accountId),
]);

export const bioDestinations = pgTable("bio_destinations", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id),
  title: varchar("title", { length: 500 }).notNull(),
  url: text("url").notNull(),
  status: varchar("status", { length: 50 }).notNull().default("active"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("bio_destinations_account_url_idx").on(table.accountId, table.url),
  index("bio_destinations_account_status_idx").on(table.accountId, table.status),
]);

export const bioDestinationSnapshots = pgTable("bio_destination_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  destinationId: uuid("destination_id")
    .notNull()
    .references(() => bioDestinations.id),
  title: varchar("title", { length: 500 }).notNull(),
  url: text("url").notNull(),
  visibleText: text("visible_text").notNull(),
  contentHash: varchar("content_hash", { length: 64 }).notNull(),
  fetchStatus: varchar("fetch_status", { length: 50 }).notNull(),
  errorMessage: text("error_message"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("bio_destination_snapshots_destination_idx").on(
    table.destinationId,
    table.fetchedAt
  ),
]);

export const postContextJobs = pgTable("post_context_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  postId: uuid("post_id")
    .notNull()
    .references(() => posts.id),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  apifyRunId: varchar("apify_run_id", { length: 255 }),
  apifyDatasetId: varchar("apify_dataset_id", { length: 255 }),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("post_context_jobs_post_idx").on(table.postId),
  index("post_context_jobs_status_idx").on(table.status),
]);

export const postContexts = pgTable("post_contexts", {
  id: uuid("id").primaryKey().defaultRandom(),
  postId: uuid("post_id")
    .notNull()
    .references(() => posts.id),
  transcript: text("transcript"),
  durationSeconds: integer("duration_seconds"),
  thumbnailUrl: text("thumbnail_url"),
  sourceUrl: text("source_url"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("post_contexts_post_idx").on(table.postId),
]);

export const responseExamples = pgTable("response_examples", {
  id: uuid("id").primaryKey().defaultRandom(),
  commentText: text("comment_text").notNull(),
  responseText: text("response_text").notNull(),
  isPositive: boolean("is_positive").notNull(),
  source: varchar("source", { length: 50 }).notNull(),
  classificationGroup: classificationGroupEnum("classification_group"),
  reviewReason: varchar("review_reason", { length: 100 }),
  reviewNotes: text("review_notes"),
  originalReplyId: uuid("original_reply_id").references(() => replies.id),
  policyVersion: varchar("policy_version", { length: 50 }),
  embedding: vector("embedding", { dimensions: 1536 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const voiceConfigs = pgTable("voice_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id),
  configKey: varchar("config_key", { length: 255 }).notNull(),
  configValue: jsonb("config_value").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const apiUsage = pgTable(
  "api_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    service: varchar("service", { length: 50 }).notNull(),
    endpoint: varchar("endpoint", { length: 255 }).notNull(),
    tokensUsed: integer("tokens_used"),
    costEstimate: real("cost_estimate"),
    calledAt: timestamp("called_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("api_usage_called_at_idx").on(table.calledAt)]
);

export const dailyBudgets = pgTable(
  "daily_budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    budgetDate: date("budget_date").notNull(),
    totalCommentsSeen: integer("total_comments_seen").notNull().default(0),
    repliesAllocated: integer("replies_allocated").notNull().default(0),
    repliesPosted: integer("replies_posted").notNull().default(0),
    repliesPending: integer("replies_pending").notNull().default(0),
    budgetLimit: integer("budget_limit").notNull(),
    narrativeReplies: integer("narrative_replies").notNull().default(0),
    communityReplies: integer("community_replies").notNull().default(0),
    informationalReplies: integer("informational_replies").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("daily_budgets_account_date_idx").on(
      table.accountId,
      table.budgetDate
    ),
  ]
);

export const evalResults = pgTable(
  "eval_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    evalDate: date("eval_date").notNull(),
    classificationAccuracy: real("classification_accuracy"),
    classificationCorrect: integer("classification_correct"),
    classificationTotal: integer("classification_total"),
    replyQualityAvg: real("reply_quality_avg"),
    evalType: varchar("eval_type", { length: 50 }).default("classification"),
    promptVersion: varchar("prompt_version", { length: 50 }),
    policyVersion: varchar("policy_version", { length: 50 }),
    modelVersion: varchar("model_version", { length: 100 }),
    sampleSize: integer("sample_size"),
    metrics: jsonb("metrics"),
    slices: jsonb("slices"),
    perCategory: jsonb("per_category"),
    confusion: jsonb("confusion"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("eval_results_date_idx").on(table.evalDate),
  ]
);

export const commentPipelineEvents = pgTable(
  "comment_pipeline_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commentId: uuid("comment_id")
      .notNull()
      .references(() => comments.id),
    replyId: uuid("reply_id").references(() => replies.id),
    stage: pipelineStageEnum("stage").notNull(),
    status: pipelineStatusEnum("status").notNull(),
    reasonCode: varchar("reason_code", { length: 100 }),
    reasonDetail: text("reason_detail"),
    payload: jsonb("payload"),
    model: varchar("model", { length: 100 }),
    promptVersion: varchar("prompt_version", { length: 50 }),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("comment_pipeline_events_comment_idx").on(table.commentId, table.createdAt),
    index("comment_pipeline_events_stage_idx").on(table.stage, table.status, table.createdAt),
  ]
);
