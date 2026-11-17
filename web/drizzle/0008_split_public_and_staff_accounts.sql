CREATE TABLE "marketplace"."public_accounts" (
	"userId" uuid PRIMARY KEY NOT NULL,
	"accountType" varchar(6) DEFAULT 'public' NOT NULL,
	CONSTRAINT "public_accounts_type_check" CHECK ("marketplace"."public_accounts"."accountType" = 'public')
);
--> statement-breakpoint
CREATE TABLE "marketplace"."staff_accounts" (
	"userId" uuid PRIMARY KEY NOT NULL,
	"accountType" varchar(6) DEFAULT 'staff' NOT NULL,
	"invitedByUserId" uuid,
	CONSTRAINT "staff_accounts_type_check" CHECK ("marketplace"."staff_accounts"."accountType" = 'staff')
);
--> statement-breakpoint
CREATE TABLE "marketplace"."staff_invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"username" varchar(50) NOT NULL,
	"tokenHash" varchar(64) NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"invitedByUserId" uuid NOT NULL,
	"permissionKeys" jsonb NOT NULL,
	CONSTRAINT "staff_invitations_tokenHash_unique" UNIQUE("tokenHash")
);
--> statement-breakpoint
CREATE TABLE "marketplace"."public_user_permissions" (
	"userId" uuid NOT NULL,
	"permissionId" uuid NOT NULL,
	"publicEligible" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_user_permissions_userId_permissionId_pk" PRIMARY KEY("userId","permissionId"),
	CONSTRAINT "public_user_permissions_scope_check" CHECK ("marketplace"."public_user_permissions"."publicEligible")
);
--> statement-breakpoint
CREATE TABLE "marketplace"."staff_user_permissions" (
	"userId" uuid NOT NULL,
	"permissionId" uuid NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_user_permissions_userId_permissionId_pk" PRIMARY KEY("userId","permissionId")
);
--> statement-breakpoint
ALTER TABLE "marketplace"."user_permissions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "marketplace"."user_permissions" CASCADE;--> statement-breakpoint
ALTER TABLE "marketplace"."users" DROP CONSTRAINT "users_createdByUserId_users_id_fk";
--> statement-breakpoint
ALTER TABLE "marketplace"."default_user_permissions" DROP CONSTRAINT "default_user_permissions_permissionId_permissions_id_fk";
--> statement-breakpoint
DROP INDEX "marketplace"."users_created_by_user_id_idx";--> statement-breakpoint
ALTER TABLE "marketplace"."users" ADD COLUMN "accountType" varchar(6) NOT NULL;--> statement-breakpoint
ALTER TABLE "marketplace"."default_user_permissions" ADD COLUMN "publicEligible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "marketplace"."permissions" ADD COLUMN "publicEligible" boolean GENERATED ALWAYS AS ("key" like 'user.%') STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "marketplace"."staff_accounts" ADD CONSTRAINT "staff_accounts_invitedByUserId_staff_accounts_userId_fk" FOREIGN KEY ("invitedByUserId") REFERENCES "marketplace"."staff_accounts"("userId") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace"."staff_invitations" ADD CONSTRAINT "staff_invitations_invitedByUserId_staff_accounts_userId_fk" FOREIGN KEY ("invitedByUserId") REFERENCES "marketplace"."staff_accounts"("userId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace"."public_user_permissions" ADD CONSTRAINT "public_user_permissions_userId_public_accounts_userId_fk" FOREIGN KEY ("userId") REFERENCES "marketplace"."public_accounts"("userId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace"."staff_user_permissions" ADD CONSTRAINT "staff_user_permissions_userId_staff_accounts_userId_fk" FOREIGN KEY ("userId") REFERENCES "marketplace"."staff_accounts"("userId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace"."staff_user_permissions" ADD CONSTRAINT "staff_user_permissions_permissionId_permissions_id_fk" FOREIGN KEY ("permissionId") REFERENCES "marketplace"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_accounts_invited_by_idx" ON "marketplace"."staff_accounts" USING btree ("invitedByUserId");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_invitations_email_unique" ON "marketplace"."staff_invitations" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "staff_invitations_username_unique" ON "marketplace"."staff_invitations" USING btree (lower("username"));--> statement-breakpoint
CREATE INDEX "staff_invitations_expires_at_idx" ON "marketplace"."staff_invitations" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "staff_invitations_invited_by_idx" ON "marketplace"."staff_invitations" USING btree ("invitedByUserId");--> statement-breakpoint
CREATE INDEX "users_account_type_idx" ON "marketplace"."users" USING btree ("accountType");--> statement-breakpoint
ALTER TABLE "marketplace"."users" DROP COLUMN "createdByUserId";--> statement-breakpoint
ALTER TABLE "marketplace"."users" ADD CONSTRAINT "users_id_account_type_unique" UNIQUE("id","accountType");--> statement-breakpoint
ALTER TABLE "marketplace"."permissions" ADD CONSTRAINT "permissions_id_public_eligible_unique" UNIQUE("id","publicEligible");--> statement-breakpoint
ALTER TABLE "marketplace"."users" ADD CONSTRAINT "users_account_type_check" CHECK ("marketplace"."users"."accountType" in ('public', 'staff'));--> statement-breakpoint
ALTER TABLE "marketplace"."default_user_permissions" ADD CONSTRAINT "default_user_permissions_scope_check" CHECK ("marketplace"."default_user_permissions"."publicEligible");--> statement-breakpoint
CREATE VIEW "marketplace"."account_permissions" AS (
    select "userId", "permissionId" from "marketplace"."public_user_permissions"
    union all
    select "userId", "permissionId" from "marketplace"."staff_user_permissions"
);