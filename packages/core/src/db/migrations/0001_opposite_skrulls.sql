CREATE TABLE "eval_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"eval_date" date NOT NULL,
	"classification_accuracy" real,
	"classification_correct" integer,
	"classification_total" integer,
	"reply_quality_avg" real,
	"per_category" jsonb,
	"confusion" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "eval_results_date_idx" ON "eval_results" USING btree ("eval_date");