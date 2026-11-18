ALTER TABLE "marketplace"."staff_invitations" DROP CONSTRAINT "staff_invitations_invitedByUserId_staff_accounts_userId_fk";
--> statement-breakpoint
ALTER TABLE "marketplace"."staff_invitations" ALTER COLUMN "invitedByUserId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "marketplace"."staff_invitations" ADD COLUMN "isActive" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "marketplace"."staff_invitations" ADD COLUMN "statusRevision" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "marketplace"."staff_invitations" ADD CONSTRAINT "staff_invitations_invitedByUserId_staff_accounts_userId_fk" FOREIGN KEY ("invitedByUserId") REFERENCES "marketplace"."staff_accounts"("userId") ON DELETE set null ON UPDATE no action;