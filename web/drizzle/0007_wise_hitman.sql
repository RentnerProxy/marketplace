CREATE TABLE "marketplace"."social_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"userId" uuid NOT NULL,
	"provider" varchar(20) NOT NULL,
	"subject" varchar(255) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace"."social_auth_challenges" (
	"tokenHash" varchar(64) PRIMARY KEY NOT NULL,
	"browserHash" varchar(64) NOT NULL,
	"provider" varchar(20) NOT NULL,
	"purpose" varchar(20) NOT NULL,
	"payload" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace"."pending_registrations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"username" varchar(50) NOT NULL,
	"email" varchar(255) NOT NULL,
	"passwordHash" text NOT NULL,
	"tokenHash" varchar(64) NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"termsVersion" varchar(50) NOT NULL,
	"acceptedAt" timestamp with time zone NOT NULL,
	"provider" varchar(32),
	"subject" varchar(255),
	CONSTRAINT "pending_registrations_tokenHash_unique" UNIQUE("tokenHash")
);
--> statement-breakpoint
ALTER TABLE "marketplace"."social_accounts" ADD CONSTRAINT "social_accounts_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "marketplace"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_accounts_provider_subject_unique_idx" ON "marketplace"."social_accounts" USING btree ("provider","subject");--> statement-breakpoint
CREATE UNIQUE INDEX "social_accounts_user_provider_unique_idx" ON "marketplace"."social_accounts" USING btree ("userId","provider");--> statement-breakpoint
CREATE INDEX "social_auth_challenges_expires_at_idx" ON "marketplace"."social_auth_challenges" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "pending_registrations_expires_at_idx" ON "marketplace"."pending_registrations" USING btree ("expiresAt");