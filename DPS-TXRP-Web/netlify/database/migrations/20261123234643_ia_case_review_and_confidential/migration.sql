ALTER TABLE "complaints" ADD COLUMN "confidential" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN "review_status" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN "requested_status" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN "review_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN "reviewed_by_account_id" integer;--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_reviewed_by_account_id_accounts_id_fkey" FOREIGN KEY ("reviewed_by_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL;