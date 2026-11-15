CREATE SCHEMA IF NOT EXISTS "tanstackdummydb";
--> statement-breakpoint
CREATE TABLE "tanstackdummydb"."user_profiles" (
	"userId" uuid PRIMARY KEY NOT NULL,
	"firstName" varchar(100),
	"lastName" varchar(100),
	"street" varchar(100),
	"houseNumber" varchar(20),
	"postalCode" varchar(20),
	"city" varchar(100),
	"profileImageUpdatedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tanstackdummydb"."user_settings" (
	"userId" uuid PRIMARY KEY NOT NULL,
	"primaryColor" varchar(20),
	"themeMode" varchar(20) DEFAULT 'dark' NOT NULL,
	"fontFamily" varchar(20) DEFAULT 'inter' NOT NULL,
	"fontSize" integer DEFAULT 16 NOT NULL,
	"customBackgroundUpdatedAt" timestamp with time zone,
	"customBackgroundDarkness" integer,
	CONSTRAINT "user_settings_theme_mode_check" CHECK ("tanstackdummydb"."user_settings"."themeMode" in ('dark', 'light')),
	CONSTRAINT "user_settings_font_family_check" CHECK ("tanstackdummydb"."user_settings"."fontFamily" in ('inter', 'system', 'serif', 'mono')),
	CONSTRAINT "user_settings_font_size_check" CHECK ("tanstackdummydb"."user_settings"."fontSize" in (14, 15, 16, 17, 18)),
	CONSTRAINT "user_settings_custom_background_darkness_check" CHECK ("tanstackdummydb"."user_settings"."customBackgroundDarkness" is null or ("tanstackdummydb"."user_settings"."customBackgroundDarkness" >= 0 and "tanstackdummydb"."user_settings"."customBackgroundDarkness" <= 100))
);
--> statement-breakpoint
CREATE TABLE "tanstackdummydb"."users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"username" varchar(50) NOT NULL,
	"email" varchar(255) NOT NULL,
	"passwordHash" text NOT NULL,
	"isTwoFactorEnabled" boolean DEFAULT false NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"isDeleted" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"createdByUserId" uuid
);
--> statement-breakpoint
CREATE TABLE "tanstackdummydb"."permissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" varchar(100) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permissions_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "tanstackdummydb"."user_permissions" (
	"userId" uuid NOT NULL,
	"permissionId" uuid NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_permissions_userId_permissionId_pk" PRIMARY KEY("userId","permissionId")
);
--> statement-breakpoint
CREATE TABLE "tanstackdummydb"."system_settings" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"companyName" varchar(100) NOT NULL,
	"logoUpdatedAt" timestamp with time zone,
	"isMaintenanceModeEnabled" boolean DEFAULT false NOT NULL,
	"maintenanceStartsAt" timestamp with time zone,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tanstackdummydb"."password_reset_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"userId" uuid NOT NULL,
	"tokenHash" varchar(64) NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	CONSTRAINT "password_reset_tokens_tokenHash_unique" UNIQUE("tokenHash")
);
--> statement-breakpoint
CREATE TABLE "tanstackdummydb"."sessions" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"userId" uuid NOT NULL,
	"ip" varchar(45),
	"location" varchar(255),
	"device" varchar(255),
	"browser" varchar(255),
	"expiresAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tanstackdummydb"."trusted_devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"userId" uuid NOT NULL,
	"deviceTokenHash" varchar(64) NOT NULL,
	"ip" varchar(45),
	"location" varchar(255),
	"device" varchar(255),
	"browser" varchar(255),
	"expiresAt" timestamp with time zone NOT NULL,
	"lastUsedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trusted_devices_deviceTokenHash_unique" UNIQUE("deviceTokenHash")
);
--> statement-breakpoint
CREATE TABLE "tanstackdummydb"."two_factor_auth" (
	"id" uuid PRIMARY KEY NOT NULL,
	"userId" uuid NOT NULL,
	"secret" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tanstackdummydb"."audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"action" varchar(100) NOT NULL,
	"actorUserId" uuid,
	"message" varchar(500),
	"route" varchar(255),
	"method" varchar(20),
	"oldValues" jsonb,
	"newValues" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tanstackdummydb"."user_profiles" ADD CONSTRAINT "user_profiles_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "tanstackdummydb"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tanstackdummydb"."user_settings" ADD CONSTRAINT "user_settings_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "tanstackdummydb"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tanstackdummydb"."users" ADD CONSTRAINT "users_createdByUserId_users_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "tanstackdummydb"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tanstackdummydb"."user_permissions" ADD CONSTRAINT "user_permissions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "tanstackdummydb"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tanstackdummydb"."user_permissions" ADD CONSTRAINT "user_permissions_permissionId_permissions_id_fk" FOREIGN KEY ("permissionId") REFERENCES "tanstackdummydb"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tanstackdummydb"."password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "tanstackdummydb"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tanstackdummydb"."sessions" ADD CONSTRAINT "sessions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "tanstackdummydb"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tanstackdummydb"."trusted_devices" ADD CONSTRAINT "trusted_devices_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "tanstackdummydb"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tanstackdummydb"."two_factor_auth" ADD CONSTRAINT "two_factor_auth_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "tanstackdummydb"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tanstackdummydb"."audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_users_id_fk" FOREIGN KEY ("actorUserId") REFERENCES "tanstackdummydb"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_active_unique_idx" ON "tanstackdummydb"."users" USING btree ("username") WHERE "tanstackdummydb"."users"."isDeleted" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_active_unique_idx" ON "tanstackdummydb"."users" USING btree ("email") WHERE "tanstackdummydb"."users"."isDeleted" = false;--> statement-breakpoint
CREATE INDEX "users_created_by_user_id_idx" ON "tanstackdummydb"."users" USING btree ("createdByUserId");--> statement-breakpoint
CREATE INDEX "users_is_deleted_idx" ON "tanstackdummydb"."users" USING btree ("isDeleted");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_id_idx" ON "tanstackdummydb"."password_reset_tokens" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "tanstackdummydb"."password_reset_tokens" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "tanstackdummydb"."sessions" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "tanstackdummydb"."sessions" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "trusted_devices_user_id_idx" ON "tanstackdummydb"."trusted_devices" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "trusted_devices_expires_at_idx" ON "tanstackdummydb"."trusted_devices" USING btree ("expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX "two_factor_auth_user_id_unique_idx" ON "tanstackdummydb"."two_factor_auth" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "tanstackdummydb"."audit_logs" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "tanstackdummydb"."audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_user_id_idx" ON "tanstackdummydb"."audit_logs" USING btree ("actorUserId");