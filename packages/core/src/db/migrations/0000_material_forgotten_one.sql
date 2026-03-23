CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'auto');--> statement-breakpoint
CREATE TYPE "public"."brainlift_type" AS ENUM('counter_arguments', 'voice_tone', 'institutional', 'deletion_guidelines', 'messaging_boundaries');--> statement-breakpoint
CREATE TYPE "public"."classification_group" AS ENUM('narrative_shaping', 'community_building', 'informational', 'delete', 'skip');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('instagram', 'facebook');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('brainlift', 'ig_caption', 'ig_reply', 'substack', 'podcast', 'website', 'slack_approved', 'slack_edited');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" "platform" DEFAULT 'instagram' NOT NULL,
	"platform_id" varchar(255) NOT NULL,
	"username" varchar(255) NOT NULL,
	"display_name" varchar(255),
	"access_token" text,
	"token_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_platform_id_unique" UNIQUE("platform_id")
);
--> statement-breakpoint
CREATE TABLE "api_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service" varchar(50) NOT NULL,
	"endpoint" varchar(255) NOT NULL,
	"tokens_used" integer,
	"cost_estimate" real,
	"called_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brainlift_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"knowledge_source_id" uuid NOT NULL,
	"workflowy_node_id" varchar(255) NOT NULL,
	"brainlift_type" "brainlift_type" NOT NULL,
	"last_synced_at" timestamp with time zone,
	"content_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"platform_comment_id" varchar(255) NOT NULL,
	"parent_comment_id" uuid,
	"author_username" varchar(255),
	"author_id" varchar(255),
	"text" text NOT NULL,
	"likes_count" integer DEFAULT 0 NOT NULL,
	"classification_group" "classification_group",
	"classification_confidence" real,
	"narrative_topic" varchar(255),
	"info_type" varchar(255),
	"is_from_account_owner" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" varchar(255),
	"commented_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"budget_date" date NOT NULL,
	"total_comments_seen" integer DEFAULT 0 NOT NULL,
	"replies_allocated" integer DEFAULT 0 NOT NULL,
	"replies_posted" integer DEFAULT 0 NOT NULL,
	"replies_pending" integer DEFAULT 0 NOT NULL,
	"budget_limit" integer NOT NULL,
	"narrative_replies" integer DEFAULT 0 NOT NULL,
	"community_replies" integer DEFAULT 0 NOT NULL,
	"informational_replies" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" "source_type" NOT NULL,
	"brainlift_type" "brainlift_type",
	"title" varchar(500),
	"content" text NOT NULL,
	"embedding" vector(1536),
	"source_weight" real DEFAULT 1 NOT NULL,
	"narrative_topics" text[] DEFAULT '{}',
	"source_url" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"platform" "platform" DEFAULT 'instagram' NOT NULL,
	"platform_post_id" varchar(255) NOT NULL,
	"caption" text,
	"media_type" varchar(50),
	"permalink" text,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"original_text" text NOT NULL,
	"edited_text" text,
	"posted_text" text,
	"approval_status" "approval_status" DEFAULT 'pending' NOT NULL,
	"approved_by" varchar(255),
	"approved_at" timestamp with time zone,
	"posted_at" timestamp with time zone,
	"platform_reply_id" varchar(255),
	"slack_message_ts" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "response_examples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_text" text NOT NULL,
	"response_text" text NOT NULL,
	"is_positive" boolean NOT NULL,
	"source" varchar(50) NOT NULL,
	"classification_group" "classification_group",
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"config_key" varchar(255) NOT NULL,
	"config_value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brainlift_sources" ADD CONSTRAINT "brainlift_sources_knowledge_source_id_knowledge_sources_id_fk" FOREIGN KEY ("knowledge_source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_budgets" ADD CONSTRAINT "daily_budgets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_configs" ADD CONSTRAINT "voice_configs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_usage_called_at_idx" ON "api_usage" USING btree ("called_at");--> statement-breakpoint
CREATE UNIQUE INDEX "comments_platform_comment_id_idx" ON "comments" USING btree ("platform_comment_id");--> statement-breakpoint
CREATE INDEX "comments_post_classification_idx" ON "comments" USING btree ("post_id","classification_group");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_budgets_account_date_idx" ON "daily_budgets" USING btree ("account_id","budget_date");--> statement-breakpoint
CREATE INDEX "knowledge_sources_type_idx" ON "knowledge_sources" USING btree ("source_type","brainlift_type");--> statement-breakpoint
CREATE UNIQUE INDEX "posts_platform_post_id_idx" ON "posts" USING btree ("platform_post_id");--> statement-breakpoint
CREATE INDEX "replies_comment_id_idx" ON "replies" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "replies_approval_status_idx" ON "replies" USING btree ("approval_status");