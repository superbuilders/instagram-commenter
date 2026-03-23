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
    isFromAccountOwner: boolean("is_from_account_owner").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: varchar("deleted_by", { length: 255 }),
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

export const responseExamples = pgTable("response_examples", {
  id: uuid("id").primaryKey().defaultRandom(),
  commentText: text("comment_text").notNull(),
  responseText: text("response_text").notNull(),
  isPositive: boolean("is_positive").notNull(),
  source: varchar("source", { length: 50 }).notNull(),
  classificationGroup: classificationGroupEnum("classification_group"),
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
