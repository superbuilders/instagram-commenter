CREATE TABLE "bio_link_inventories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL,
  "profile_username" varchar(255) NOT NULL,
  "source_url" text NOT NULL,
  "refreshed_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "bio_destinations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL,
  "title" varchar(500) NOT NULL,
  "url" text NOT NULL,
  "status" varchar(50) DEFAULT 'active' NOT NULL,
  "first_seen_at" timestamp with time zone NOT NULL,
  "last_seen_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "bio_destination_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "destination_id" uuid NOT NULL,
  "title" varchar(500) NOT NULL,
  "url" text NOT NULL,
  "visible_text" text NOT NULL,
  "content_hash" varchar(64) NOT NULL,
  "fetch_status" varchar(50) NOT NULL,
  "error_message" text,
  "fetched_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "bio_link_inventories"
  ADD CONSTRAINT "bio_link_inventories_account_id_accounts_id_fk"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "bio_destinations"
  ADD CONSTRAINT "bio_destinations_account_id_accounts_id_fk"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "bio_destination_snapshots"
  ADD CONSTRAINT "bio_destination_snapshots_destination_id_bio_destinations_id_fk"
  FOREIGN KEY ("destination_id") REFERENCES "bio_destinations"("id") ON DELETE no action ON UPDATE no action;

CREATE UNIQUE INDEX "bio_link_inventories_account_idx"
  ON "bio_link_inventories" USING btree ("account_id");

CREATE UNIQUE INDEX "bio_destinations_account_url_idx"
  ON "bio_destinations" USING btree ("account_id","url");

CREATE INDEX "bio_destinations_account_status_idx"
  ON "bio_destinations" USING btree ("account_id","status");

CREATE INDEX "bio_destination_snapshots_destination_idx"
  ON "bio_destination_snapshots" USING btree ("destination_id","fetched_at");
