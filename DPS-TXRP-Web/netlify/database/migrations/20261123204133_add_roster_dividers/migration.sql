CREATE TABLE "roster_dividers" (
	"id" serial PRIMARY KEY,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "roster_members" ADD COLUMN "divider_id" integer;--> statement-breakpoint
ALTER TABLE "roster_members" ADD CONSTRAINT "roster_members_divider_id_roster_dividers_id_fkey" FOREIGN KEY ("divider_id") REFERENCES "roster_dividers"("id") ON DELETE SET NULL;