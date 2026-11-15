ALTER TABLE "tanstackdummydb"."backup_settings" ALTER COLUMN "isEnabled" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "tanstackdummydb"."backup_settings" ALTER COLUMN "retentionCount" SET DEFAULT 10;--> statement-breakpoint
ALTER TABLE "tanstackdummydb"."backup_settings" ADD COLUMN "scheduleType" varchar(30) DEFAULT 'daily' NOT NULL;--> statement-breakpoint
ALTER TABLE "tanstackdummydb"."backup_settings" ADD COLUMN "scheduleInterval" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "tanstackdummydb"."backup_settings" ADD COLUMN "scheduleWeekdays" varchar(20) DEFAULT '1,2,3,4,5' NOT NULL;--> statement-breakpoint
ALTER TABLE "tanstackdummydb"."backup_settings" ADD COLUMN "retentionMode" varchar(20) DEFAULT 'count' NOT NULL;--> statement-breakpoint
ALTER TABLE "tanstackdummydb"."backup_settings" DROP COLUMN "timezone";--> statement-breakpoint
ALTER TABLE "tanstackdummydb"."backup_settings" ADD CONSTRAINT "backup_settings_schedule_type_check" CHECK ("tanstackdummydb"."backup_settings"."scheduleType" in ('daily', 'weekdays', 'interval-hours', 'interval-weeks'));--> statement-breakpoint
ALTER TABLE "tanstackdummydb"."backup_settings" ADD CONSTRAINT "backup_settings_schedule_interval_check" CHECK ("tanstackdummydb"."backup_settings"."scheduleInterval" between 1 and 168);--> statement-breakpoint
ALTER TABLE "tanstackdummydb"."backup_settings" ADD CONSTRAINT "backup_settings_retention_mode_check" CHECK ("tanstackdummydb"."backup_settings"."retentionMode" in ('days', 'count', 'both'));