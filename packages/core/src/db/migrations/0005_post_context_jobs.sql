CREATE TABLE "post_context_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "post_id" uuid NOT NULL,
  "status" varchar(50) DEFAULT 'pending' NOT NULL,
  "apify_run_id" varchar(255),
  "apify_dataset_id" varchar(255),
  "failure_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "post_contexts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "post_id" uuid NOT NULL,
  "transcript" text,
  "duration_seconds" integer,
  "thumbnail_url" text,
  "source_url" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "post_context_jobs"
  ADD CONSTRAINT "post_context_jobs_post_id_posts_id_fk"
  FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "post_contexts"
  ADD CONSTRAINT "post_contexts_post_id_posts_id_fk"
  FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE no action ON UPDATE no action;

CREATE UNIQUE INDEX "post_context_jobs_post_idx"
  ON "post_context_jobs" USING btree ("post_id");

CREATE INDEX "post_context_jobs_status_idx"
  ON "post_context_jobs" USING btree ("status");

CREATE UNIQUE INDEX "post_contexts_post_idx"
  ON "post_contexts" USING btree ("post_id");
