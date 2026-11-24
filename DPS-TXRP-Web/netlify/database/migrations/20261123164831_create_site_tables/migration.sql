CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY,
	"username" text NOT NULL UNIQUE,
	"display_name" text DEFAULT '' NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'admin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "complaint_notes" (
	"id" serial PRIMARY KEY,
	"complaint_id" integer NOT NULL,
	"author" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "complaints" (
	"id" serial PRIMARY KEY,
	"case_number" text NOT NULL UNIQUE,
	"complainant_name" text NOT NULL,
	"complainant_discord" text DEFAULT '' NOT NULL,
	"complainant_roblox" text DEFAULT '' NOT NULL,
	"contact" text DEFAULT '' NOT NULL,
	"officer_name" text DEFAULT '' NOT NULL,
	"officer_badge" text DEFAULT '' NOT NULL,
	"incident_date" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'Misconduct' NOT NULL,
	"description" text NOT NULL,
	"evidence" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'Open' NOT NULL,
	"assigned_to" text DEFAULT '' NOT NULL,
	"webhook_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "divisions" (
	"id" serial PRIMARY KEY,
	"name" text NOT NULL,
	"code" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"image_key" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY,
	"title" text NOT NULL,
	"category" text DEFAULT 'General' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"file_key" text,
	"external_url" text,
	"visibility" text DEFAULT 'public' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leaders" (
	"id" serial PRIMARY KEY,
	"name" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"image_key" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news" (
	"id" serial PRIMARY KEY,
	"title" text NOT NULL,
	"category" text DEFAULT 'Press Release' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"image_key" text,
	"published" boolean DEFAULT true NOT NULL,
	"author_id" integer,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roster_members" (
	"id" serial PRIMARY KEY,
	"name" text NOT NULL,
	"rank" text DEFAULT '' NOT NULL,
	"badge_number" text DEFAULT '' NOT NULL,
	"callsign" text DEFAULT '' NOT NULL,
	"division_id" integer,
	"status" text DEFAULT 'Active' NOT NULL,
	"discord" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"joined_at" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" serial PRIMARY KEY,
	"token_hash" text NOT NULL UNIQUE,
	"account_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" serial PRIMARY KEY,
	"key" text NOT NULL UNIQUE,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "complaint_notes" ADD CONSTRAINT "complaint_notes_complaint_id_complaints_id_fkey" FOREIGN KEY ("complaint_id") REFERENCES "complaints"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "news" ADD CONSTRAINT "news_author_id_accounts_id_fkey" FOREIGN KEY ("author_id") REFERENCES "accounts"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "roster_members" ADD CONSTRAINT "roster_members_division_id_divisions_id_fkey" FOREIGN KEY ("division_id") REFERENCES "divisions"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE;