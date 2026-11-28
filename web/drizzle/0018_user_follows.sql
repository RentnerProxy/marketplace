CREATE TABLE "marketplace"."user_follows" (
	"followerId" uuid NOT NULL,
	"followingId" uuid NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_follows_followerId_followingId_pk" PRIMARY KEY("followerId","followingId"),
	CONSTRAINT "user_follows_no_self_follow_check" CHECK ("marketplace"."user_follows"."followerId" <> "marketplace"."user_follows"."followingId")
);
--> statement-breakpoint
ALTER TABLE "marketplace"."user_follows" ADD CONSTRAINT "user_follows_followerId_users_id_fk" FOREIGN KEY ("followerId") REFERENCES "marketplace"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace"."user_follows" ADD CONSTRAINT "user_follows_followingId_users_id_fk" FOREIGN KEY ("followingId") REFERENCES "marketplace"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_follows_following_created_idx" ON "marketplace"."user_follows" USING btree ("followingId","createdAt");--> statement-breakpoint
CREATE INDEX "user_follows_follower_created_idx" ON "marketplace"."user_follows" USING btree ("followerId","createdAt");