CREATE TABLE "tanstackdummydb"."passkey_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"userId" uuid,
	"identifier" varchar(255),
	"webauthnUserId" text,
	"challenge" text NOT NULL,
	"type" varchar(32) NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tanstackdummydb"."passkey_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"userId" uuid NOT NULL,
	"credentialId" text NOT NULL,
	"publicKey" text NOT NULL,
	"webauthnUserId" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"transports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deviceType" varchar(32) NOT NULL,
	"backedUp" boolean DEFAULT false NOT NULL,
	"name" varchar(100) NOT NULL,
	"lastUsedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tanstackdummydb"."passkey_challenges" ADD CONSTRAINT "passkey_challenges_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "tanstackdummydb"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tanstackdummydb"."passkey_credentials" ADD CONSTRAINT "passkey_credentials_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "tanstackdummydb"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "passkey_challenges_user_id_idx" ON "tanstackdummydb"."passkey_challenges" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "passkey_challenges_expires_at_idx" ON "tanstackdummydb"."passkey_challenges" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "passkey_challenges_type_idx" ON "tanstackdummydb"."passkey_challenges" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "passkey_credentials_credential_id_unique_idx" ON "tanstackdummydb"."passkey_credentials" USING btree ("credentialId");--> statement-breakpoint
CREATE INDEX "passkey_credentials_user_id_idx" ON "tanstackdummydb"."passkey_credentials" USING btree ("userId");