CREATE TABLE "tanstackdummydb"."backup_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trigger" varchar(20) NOT NULL,
	"status" varchar(20) NOT NULL,
	"targetKey" varchar(50) NOT NULL,
	"fileName" varchar(255),
	"fileSize" bigint,
	"checksumSha256" varchar(64),
	"includesStorage" boolean DEFAULT true NOT NULL,
	"errorMessage" text,
	"startedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"completedAt" timestamp with time zone,
	"createdByUserId" uuid,
	CONSTRAINT "backup_runs_trigger_check" CHECK ("tanstackdummydb"."backup_runs"."trigger" in ('manual', 'scheduled', 'restore-safety', 'import', 'restore')),
	CONSTRAINT "backup_runs_status_check" CHECK ("tanstackdummydb"."backup_runs"."status" in ('queued', 'running', 'completed', 'failed')),
	CONSTRAINT "backup_runs_file_size_check" CHECK ("tanstackdummydb"."backup_runs"."fileSize" is null or "tanstackdummydb"."backup_runs"."fileSize" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tanstackdummydb"."backup_settings" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"isEnabled" boolean DEFAULT true NOT NULL,
	"targetKey" varchar(50) DEFAULT 'local' NOT NULL,
	"scheduleHour" integer DEFAULT 3 NOT NULL,
	"scheduleMinute" integer DEFAULT 0 NOT NULL,
	"timezone" varchar(100) DEFAULT 'Europe/Berlin' NOT NULL,
	"retentionDays" integer DEFAULT 30 NOT NULL,
	"retentionCount" integer DEFAULT 14 NOT NULL,
	"includeStorage" boolean DEFAULT true NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedByUserId" uuid,
	CONSTRAINT "backup_settings_schedule_hour_check" CHECK ("tanstackdummydb"."backup_settings"."scheduleHour" between 0 and 23),
	CONSTRAINT "backup_settings_schedule_minute_check" CHECK ("tanstackdummydb"."backup_settings"."scheduleMinute" between 0 and 59),
	CONSTRAINT "backup_settings_retention_days_check" CHECK ("tanstackdummydb"."backup_settings"."retentionDays" between 1 and 3650),
	CONSTRAINT "backup_settings_retention_count_check" CHECK ("tanstackdummydb"."backup_settings"."retentionCount" between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "tanstackdummydb"."backup_runs" ADD CONSTRAINT "backup_runs_createdByUserId_users_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "tanstackdummydb"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tanstackdummydb"."backup_settings" ADD CONSTRAINT "backup_settings_updatedByUserId_users_id_fk" FOREIGN KEY ("updatedByUserId") REFERENCES "tanstackdummydb"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backup_runs_started_at_idx" ON "tanstackdummydb"."backup_runs" USING btree ("startedAt");--> statement-breakpoint
CREATE INDEX "backup_runs_status_started_at_idx" ON "tanstackdummydb"."backup_runs" USING btree ("status","startedAt");--> statement-breakpoint
CREATE INDEX "backup_runs_target_status_started_at_idx" ON "tanstackdummydb"."backup_runs" USING btree ("targetKey","status","startedAt");