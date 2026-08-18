CREATE INDEX "comments_author_id_idx" ON "comments" USING btree ("author_id");

CREATE TYPE "discovery_status" AS ENUM ('found', 'not_discoverable', 'error');

CREATE TABLE "commenter_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "author_id" varchar(255),
  "author_username" varchar(255) NOT NULL,
  "ig_business_id" varchar(255),
  "name" varchar(255),
  "biography" text,
  "website" text,
  "profile_picture_url" text,
  "followers_count" integer,
  "media_count" integer,
  "discovery_status" "discovery_status" NOT NULL,
  "researched_at" timestamp with time zone,
  "slack_message_ts" varchar(255),
  "source" varchar(100) DEFAULT 'graph_business_discovery' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "commenter_profiles_author_id_idx" ON "commenter_profiles" ("author_id") WHERE "author_id" IS NOT NULL;
CREATE UNIQUE INDEX "commenter_profiles_author_username_idx" ON "commenter_profiles" ("author_username");
