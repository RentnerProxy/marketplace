CREATE TABLE "marketplace"."marketplace_official_apps" (
	"app_id" varchar(97) PRIMARY KEY NOT NULL,
	"claim_id" uuid,
	"revision" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace"."marketplace_repository_claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"submitter_id" uuid NOT NULL,
	"repository" varchar(140) NOT NULL,
	"repository_id" varchar(20) NOT NULL,
	"owner_id" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace"."marketplace_submissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"submitter_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"namespace_revision" integer,
	"app_id" varchar(97) NOT NULL,
	"version" varchar(64) NOT NULL,
	"request" jsonb NOT NULL,
	"status" varchar(24) NOT NULL,
	"revision" integer NOT NULL,
	"history" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_check_at" timestamp with time zone,
	"dispatch_requested_at" timestamp with time zone,
	"build_key" uuid NOT NULL,
	"build_run_id" varchar(20),
	"validation" jsonb,
	"approval" jsonb,
	"publication_run" jsonb,
	"publication" jsonb,
	CONSTRAINT "marketplace_submission_status_check" CHECK ("marketplace"."marketplace_submissions"."status" in (
            'submitted', 'validating', 'awaitingReview', 'approved', 'publishing',
            'published', 'rejected', 'failed', 'withdrawn', 'revoked'
        ))
);
--> statement-breakpoint
ALTER TABLE "marketplace"."marketplace_official_apps" ADD CONSTRAINT "marketplace_official_apps_claim_id_marketplace_repository_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "marketplace"."marketplace_repository_claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace"."marketplace_submissions" ADD CONSTRAINT "marketplace_submissions_claim_id_marketplace_repository_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "marketplace"."marketplace_repository_claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_repository_claim_identity_idx" ON "marketplace"."marketplace_repository_claims" USING btree ("submitter_id","repository_id","owner_id","repository");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_submission_active_version_idx" ON "marketplace"."marketplace_submissions" USING btree ("app_id","version") WHERE "marketplace"."marketplace_submissions"."status" in (
                'submitted', 'validating', 'awaitingReview', 'approved',
                'publishing', 'published', 'revoked'
            ) or "marketplace"."marketplace_submissions"."publication_run" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_submission_build_run_idx" ON "marketplace"."marketplace_submissions" USING btree ("build_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_submission_build_key_idx" ON "marketplace"."marketplace_submissions" USING btree ("build_key");--> statement-breakpoint
CREATE INDEX "marketplace_submission_due_idx" ON "marketplace"."marketplace_submissions" USING btree ("next_check_at") WHERE "marketplace"."marketplace_submissions"."next_check_at" is not null;--> statement-breakpoint
CREATE INDEX "marketplace_submission_owner_idx" ON "marketplace"."marketplace_submissions" USING btree ("submitter_id","created_at");--> statement-breakpoint
CREATE INDEX "marketplace_submission_history_idx" ON "marketplace"."marketplace_submissions" USING btree ("created_at");