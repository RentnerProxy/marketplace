CREATE TABLE "tanstackdummydb"."notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"userId" uuid,
	"title" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"type" varchar(50) DEFAULT 'info' NOT NULL,
	"referenceId" uuid,
	"isRead" boolean DEFAULT false NOT NULL,
	"readAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tanstackdummydb"."notifications" ADD CONSTRAINT "notifications_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "tanstackdummydb"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_id_idx" ON "tanstackdummydb"."notifications" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "notifications_is_read_idx" ON "tanstackdummydb"."notifications" USING btree ("isRead");--> statement-breakpoint
CREATE INDEX "notifications_reference_id_idx" ON "tanstackdummydb"."notifications" USING btree ("referenceId");