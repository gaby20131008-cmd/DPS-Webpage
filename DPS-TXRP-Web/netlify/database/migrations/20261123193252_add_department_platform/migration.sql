CREATE TABLE "activity_logs" (
	"id" serial PRIMARY KEY,
	"member_id" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"minutes" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" serial PRIMARY KEY,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"audience" text DEFAULT 'internal' NOT NULL,
	"priority" text DEFAULT 'Normal' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"unit_id" integer,
	"author_id" integer,
	"author_name" text DEFAULT '' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY,
	"account_id" integer,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target" text DEFAULT '' NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commendations" (
	"id" serial PRIMARY KEY,
	"member_id" integer NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'Commendation' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"issued_by" text DEFAULT '' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disciplinary_records" (
	"id" serial PRIMARY KEY,
	"member_id" integer NOT NULL,
	"complaint_id" integer,
	"action" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"issued_by" text DEFAULT '' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluations" (
	"id" serial PRIMARY KEY,
	"member_id" integer NOT NULL,
	"evaluator" text DEFAULT '' NOT NULL,
	"period" text DEFAULT '' NOT NULL,
	"ratings" jsonb DEFAULT '{}' NOT NULL,
	"overall" integer DEFAULT 3 NOT NULL,
	"strengths" text DEFAULT '' NOT NULL,
	"improvements" text DEFAULT '' NOT NULL,
	"comments" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_signups" (
	"id" serial PRIMARY KEY,
	"event_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_signups_event_account" UNIQUE("event_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'Meeting' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"audience" text DEFAULT 'internal' NOT NULL,
	"unit_id" integer,
	"allow_signup" boolean DEFAULT false NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "faqs" (
	"id" serial PRIMARY KEY,
	"question" text NOT NULL,
	"answer" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'General' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" serial PRIMARY KEY,
	"kind" text DEFAULT 'Feedback' NOT NULL,
	"name" text NOT NULL,
	"contact" text DEFAULT '' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'New' NOT NULL,
	"handled_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_events" (
	"id" serial PRIMARY KEY,
	"member_id" integer NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"actor" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY,
	"from_account_id" integer,
	"from_name" text DEFAULT '' NOT NULL,
	"to_account_id" integer NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY,
	"account_id" integer,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"link" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"slug" text PRIMARY KEY,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"updated_by" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personnel_requests" (
	"id" serial PRIMARY KEY,
	"kind" text NOT NULL,
	"account_id" integer,
	"member_id" integer,
	"requester_name" text DEFAULT '' NOT NULL,
	"start_date" text DEFAULT '' NOT NULL,
	"end_date" text DEFAULT '' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"reviewed_by" text DEFAULT '' NOT NULL,
	"review_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ranks" (
	"id" serial PRIMARY KEY,
	"name" text NOT NULL UNIQUE,
	"abbreviation" text DEFAULT '' NOT NULL,
	"tier" text DEFAULT 'Deputy' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"grants_role" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" serial PRIMARY KEY,
	"number" text NOT NULL UNIQUE,
	"type" text NOT NULL,
	"author_account_id" integer,
	"author_member_id" integer,
	"author_name" text DEFAULT '' NOT NULL,
	"title" text NOT NULL,
	"occurred_at" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"involved" text DEFAULT '' NOT NULL,
	"details" jsonb DEFAULT '{}' NOT NULL,
	"narrative" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'Submitted' NOT NULL,
	"reviewed_by" text DEFAULT '' NOT NULL,
	"review_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_courses" (
	"id" serial PRIMARY KEY,
	"title" text NOT NULL,
	"category" text DEFAULT 'General' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"file_key" text,
	"certification" text DEFAULT '' NOT NULL,
	"passing_score" integer DEFAULT 80 NOT NULL,
	"questions" jsonb DEFAULT '[]' NOT NULL,
	"published" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_records" (
	"id" serial PRIMARY KEY,
	"member_id" integer NOT NULL,
	"course_id" integer,
	"title" text NOT NULL,
	"kind" text DEFAULT 'Course' NOT NULL,
	"result" text DEFAULT 'Passed' NOT NULL,
	"score" integer,
	"instructor" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"certification" text DEFAULT '' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unit_members" (
	"id" serial PRIMARY KEY,
	"unit_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	"position" text DEFAULT 'Member' NOT NULL,
	"is_leader" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_members_unit_member" UNIQUE("unit_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "notifications_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "disabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN "source" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN "reporter_account_id" integer;--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN "subject_member_id" integer;--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN "priority" text DEFAULT 'Normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN "findings" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN "tracking_code" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "divisions" ADD COLUMN "requirements" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "divisions" ADD COLUMN "accepting_applications" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "roster_members" ADD COLUMN "account_id" integer;--> statement-breakpoint
ALTER TABLE "roster_members" ADD COLUMN "photo_key" text;--> statement-breakpoint
ALTER TABLE "roster_members" ADD COLUMN "bio" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "roster_members" ADD COLUMN "duty_status" text DEFAULT 'Off Duty' NOT NULL;--> statement-breakpoint
ALTER TABLE "roster_members" ADD COLUMN "duty_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "roster_members" ADD COLUMN "featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "roster_members" ADD COLUMN "is_instructor" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "roster_members" ADD COLUMN "card_theme" text DEFAULT 'classic' NOT NULL;--> statement-breakpoint
ALTER TABLE "roster_members" ADD CONSTRAINT "roster_members_account_id_key" UNIQUE("account_id");--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_member_id_roster_members_id_fkey" FOREIGN KEY ("member_id") REFERENCES "roster_members"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_unit_id_divisions_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "divisions"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_author_id_accounts_id_fkey" FOREIGN KEY ("author_id") REFERENCES "accounts"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_account_id_accounts_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "commendations" ADD CONSTRAINT "commendations_member_id_roster_members_id_fkey" FOREIGN KEY ("member_id") REFERENCES "roster_members"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_reporter_account_id_accounts_id_fkey" FOREIGN KEY ("reporter_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_subject_member_id_roster_members_id_fkey" FOREIGN KEY ("subject_member_id") REFERENCES "roster_members"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "disciplinary_records" ADD CONSTRAINT "disciplinary_records_member_id_roster_members_id_fkey" FOREIGN KEY ("member_id") REFERENCES "roster_members"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "disciplinary_records" ADD CONSTRAINT "disciplinary_records_complaint_id_complaints_id_fkey" FOREIGN KEY ("complaint_id") REFERENCES "complaints"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_member_id_roster_members_id_fkey" FOREIGN KEY ("member_id") REFERENCES "roster_members"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "event_signups" ADD CONSTRAINT "event_signups_event_id_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "event_signups" ADD CONSTRAINT "event_signups_account_id_accounts_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_unit_id_divisions_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "divisions"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "member_events" ADD CONSTRAINT "member_events_member_id_roster_members_id_fkey" FOREIGN KEY ("member_id") REFERENCES "roster_members"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_from_account_id_accounts_id_fkey" FOREIGN KEY ("from_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_to_account_id_accounts_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "accounts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_account_id_accounts_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "personnel_requests" ADD CONSTRAINT "personnel_requests_account_id_accounts_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "personnel_requests" ADD CONSTRAINT "personnel_requests_member_id_roster_members_id_fkey" FOREIGN KEY ("member_id") REFERENCES "roster_members"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_author_account_id_accounts_id_fkey" FOREIGN KEY ("author_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_author_member_id_roster_members_id_fkey" FOREIGN KEY ("author_member_id") REFERENCES "roster_members"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "roster_members" ADD CONSTRAINT "roster_members_account_id_accounts_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_member_id_roster_members_id_fkey" FOREIGN KEY ("member_id") REFERENCES "roster_members"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_course_id_training_courses_id_fkey" FOREIGN KEY ("course_id") REFERENCES "training_courses"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "unit_members" ADD CONSTRAINT "unit_members_unit_id_divisions_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "divisions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "unit_members" ADD CONSTRAINT "unit_members_member_id_roster_members_id_fkey" FOREIGN KEY ("member_id") REFERENCES "roster_members"("id") ON DELETE CASCADE;