CREATE TABLE "marketplace"."app_stars" (
	"userId" uuid NOT NULL,
	"appId" varchar(97) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_stars_userId_appId_pk" PRIMARY KEY("userId","appId")
);
--> statement-breakpoint
ALTER TABLE "marketplace"."app_stars" ADD CONSTRAINT "app_stars_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "marketplace"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_stars_app_idx" ON "marketplace"."app_stars" USING btree ("appId");