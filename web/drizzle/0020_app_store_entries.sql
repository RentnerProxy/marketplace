CREATE TABLE "marketplace"."app_store_entries" (
	"appId" varchar(97) PRIMARY KEY NOT NULL,
	"description" varchar(5000),
	"logoFileId" uuid,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedBy" uuid
);
--> statement-breakpoint
CREATE TABLE "marketplace"."app_store_screenshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"appId" varchar(97) NOT NULL,
	"position" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marketplace"."app_store_entries" ADD CONSTRAINT "app_store_entries_updatedBy_users_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "marketplace"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace"."app_store_screenshots" ADD CONSTRAINT "app_store_screenshots_appId_app_store_entries_appId_fk" FOREIGN KEY ("appId") REFERENCES "marketplace"."app_store_entries"("appId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_store_screenshots_app_position_idx" ON "marketplace"."app_store_screenshots" USING btree ("appId","position");