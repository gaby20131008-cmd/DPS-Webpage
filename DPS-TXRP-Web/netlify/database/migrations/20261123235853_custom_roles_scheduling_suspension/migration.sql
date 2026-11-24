CREATE TABLE "custom_roles" (
	"id" serial PRIMARY KEY,
	"key" text NOT NULL UNIQUE,
	"label" text NOT NULL,
	"perms" jsonb DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_events" (
	"id" serial PRIMARY KEY,
	"account_id" integer,
	"username" text DEFAULT '' NOT NULL,
	"success" boolean DEFAULT false NOT NULL,
	"ip" text DEFAULT '' NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "suspended_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "suspended_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "publish_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "login_events" ADD CONSTRAINT "login_events_account_id_accounts_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE;