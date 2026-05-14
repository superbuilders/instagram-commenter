ALTER TABLE "comments" ADD COLUMN "skip_reason" varchar(255);
ALTER TABLE "comments" ADD COLUMN "delete_reason" varchar(255);
ALTER TABLE "comments" ADD COLUMN "classification_policy_version" varchar(50);
ALTER TABLE "comments" ADD COLUMN "classification_rationale_tags" jsonb;

ALTER TABLE "replies" ADD COLUMN "prompt_version" varchar(50);
ALTER TABLE "replies" ADD COLUMN "review_outcome_reason" varchar(100);
ALTER TABLE "replies" ADD COLUMN "review_outcome_category" varchar(100);
ALTER TABLE "replies" ADD COLUMN "review_outcome_notes" text;

ALTER TABLE "response_examples" ADD COLUMN "review_reason" varchar(100);
ALTER TABLE "response_examples" ADD COLUMN "review_notes" text;
ALTER TABLE "response_examples" ADD COLUMN "original_reply_id" uuid REFERENCES "replies"("id");
ALTER TABLE "response_examples" ADD COLUMN "policy_version" varchar(50);

ALTER TABLE "eval_results" ADD COLUMN "eval_type" varchar(50) DEFAULT 'classification';
ALTER TABLE "eval_results" ADD COLUMN "prompt_version" varchar(50);
ALTER TABLE "eval_results" ADD COLUMN "policy_version" varchar(50);
ALTER TABLE "eval_results" ADD COLUMN "model_version" varchar(100);
ALTER TABLE "eval_results" ADD COLUMN "sample_size" integer;
ALTER TABLE "eval_results" ADD COLUMN "metrics" jsonb;
ALTER TABLE "eval_results" ADD COLUMN "slices" jsonb;

CREATE TYPE "pipeline_stage" AS ENUM (
  'ingest',
  'classify',
  'allocate',
  'retrieve',
  'generate',
  'verify',
  'slack_review',
  'post_reply',
  'delete_review',
  'delete_execute'
);

CREATE TYPE "pipeline_status" AS ENUM (
  'started',
  'succeeded',
  'skipped',
  'failed'
);

CREATE TABLE "comment_pipeline_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "comment_id" uuid NOT NULL REFERENCES "comments"("id"),
  "reply_id" uuid REFERENCES "replies"("id"),
  "stage" "pipeline_stage" NOT NULL,
  "status" "pipeline_status" NOT NULL,
  "reason_code" varchar(100),
  "reason_detail" text,
  "payload" jsonb,
  "model" varchar(100),
  "prompt_version" varchar(50),
  "latency_ms" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "comment_pipeline_events_comment_idx" ON "comment_pipeline_events" USING btree ("comment_id","created_at");
CREATE INDEX "comment_pipeline_events_stage_idx" ON "comment_pipeline_events" USING btree ("stage","status","created_at");
