ALTER SCHEMA "tanstackdummydb" RENAME TO "marketplace";
--> statement-breakpoint
ALTER TABLE "marketplace"."user_settings" DROP CONSTRAINT "user_settings_theme_mode_check";--> statement-breakpoint
ALTER TABLE "marketplace"."user_settings" DROP CONSTRAINT "user_settings_font_family_check";--> statement-breakpoint
ALTER TABLE "marketplace"."user_settings" DROP CONSTRAINT "user_settings_font_size_check";--> statement-breakpoint
ALTER TABLE "marketplace"."user_settings" DROP CONSTRAINT "user_settings_custom_background_darkness_check";--> statement-breakpoint
ALTER TABLE "marketplace"."backup_runs" DROP CONSTRAINT "backup_runs_trigger_check";--> statement-breakpoint
ALTER TABLE "marketplace"."backup_runs" DROP CONSTRAINT "backup_runs_status_check";--> statement-breakpoint
ALTER TABLE "marketplace"."backup_runs" DROP CONSTRAINT "backup_runs_file_size_check";--> statement-breakpoint
ALTER TABLE "marketplace"."backup_settings" DROP CONSTRAINT "backup_settings_schedule_type_check";--> statement-breakpoint
ALTER TABLE "marketplace"."backup_settings" DROP CONSTRAINT "backup_settings_schedule_interval_check";--> statement-breakpoint
ALTER TABLE "marketplace"."backup_settings" DROP CONSTRAINT "backup_settings_retention_mode_check";--> statement-breakpoint
ALTER TABLE "marketplace"."backup_settings" DROP CONSTRAINT "backup_settings_schedule_hour_check";--> statement-breakpoint
ALTER TABLE "marketplace"."backup_settings" DROP CONSTRAINT "backup_settings_schedule_minute_check";--> statement-breakpoint
ALTER TABLE "marketplace"."backup_settings" DROP CONSTRAINT "backup_settings_retention_days_check";--> statement-breakpoint
ALTER TABLE "marketplace"."backup_settings" DROP CONSTRAINT "backup_settings_retention_count_check";--> statement-breakpoint
ALTER TABLE "marketplace"."notifications" DROP CONSTRAINT "notifications_userId_users_id_fk";
--> statement-breakpoint
ALTER TABLE "marketplace"."user_profiles" DROP CONSTRAINT "user_profiles_userId_users_id_fk";
--> statement-breakpoint
ALTER TABLE "marketplace"."user_settings" DROP CONSTRAINT "user_settings_userId_users_id_fk";
--> statement-breakpoint
ALTER TABLE "marketplace"."users" DROP CONSTRAINT "users_createdByUserId_users_id_fk";
--> statement-breakpoint
ALTER TABLE "marketplace"."default_user_permissions" DROP CONSTRAINT "default_user_permissions_permissionId_permissions_id_fk";
--> statement-breakpoint
ALTER TABLE "marketplace"."permission_preset_permissions" DROP CONSTRAINT "permission_preset_permissions_presetId_permission_presets_id_fk";
--> statement-breakpoint
ALTER TABLE "marketplace"."permission_preset_permissions" DROP CONSTRAINT "permission_preset_permissions_permissionId_permissions_id_fk";
--> statement-breakpoint
ALTER TABLE "marketplace"."user_permissions" DROP CONSTRAINT "user_permissions_userId_users_id_fk";
--> statement-breakpoint
ALTER TABLE "marketplace"."user_permissions" DROP CONSTRAINT "user_permissions_permissionId_permissions_id_fk";
--> statement-breakpoint
ALTER TABLE "marketplace"."passkey_challenges" DROP CONSTRAINT "passkey_challenges_userId_users_id_fk";
--> statement-breakpoint
ALTER TABLE "marketplace"."passkey_credentials" DROP CONSTRAINT "passkey_credentials_userId_users_id_fk";
--> statement-breakpoint
ALTER TABLE "marketplace"."password_reset_tokens" DROP CONSTRAINT "password_reset_tokens_userId_users_id_fk";
--> statement-breakpoint
ALTER TABLE "marketplace"."sessions" DROP CONSTRAINT "sessions_userId_users_id_fk";
--> statement-breakpoint
ALTER TABLE "marketplace"."trusted_devices" DROP CONSTRAINT "trusted_devices_userId_users_id_fk";
--> statement-breakpoint
ALTER TABLE "marketplace"."two_factor_auth" DROP CONSTRAINT "two_factor_auth_userId_users_id_fk";
--> statement-breakpoint
ALTER TABLE "marketplace"."audit_logs" DROP CONSTRAINT "audit_logs_actorUserId_users_id_fk";
--> statement-breakpoint
ALTER TABLE "marketplace"."backup_runs" DROP CONSTRAINT "backup_runs_createdByUserId_users_id_fk";
--> statement-breakpoint
ALTER TABLE "marketplace"."backup_settings" DROP CONSTRAINT "backup_settings_updatedByUserId_users_id_fk";
--> statement-breakpoint
DROP INDEX "marketplace"."users_username_active_unique_idx";--> statement-breakpoint
DROP INDEX "marketplace"."users_email_active_unique_idx";--> statement-breakpoint
ALTER TABLE "marketplace"."notifications" ADD CONSTRAINT "notifications_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "marketplace"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace"."user_profiles" ADD CONSTRAINT "user_profiles_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "marketplace"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace"."user_settings" ADD CONSTRAINT "user_settings_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "marketplace"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace"."users" ADD CONSTRAINT "users_createdByUserId_users_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "marketplace"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace"."default_user_permissions" ADD CONSTRAINT "default_user_permissions_permissionId_permissions_id_fk" FOREIGN KEY ("permissionId") REFERENCES "marketplace"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace"."permission_preset_permissions" ADD CONSTRAINT "permission_preset_permissions_presetId_permission_presets_id_fk" FOREIGN KEY ("presetId") REFERENCES "marketplace"."permission_presets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace"."permission_preset_permissions" ADD CONSTRAINT "permission_preset_permissions_permissionId_permissions_id_fk" FOREIGN KEY ("permissionId") REFERENCES "marketplace"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace"."user_permissions" ADD CONSTRAINT "user_permissions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "marketplace"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace"."user_permissions" ADD CONSTRAINT "user_permissions_permissionId_permissions_id_fk" FOREIGN KEY ("permissionId") REFERENCES "marketplace"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace"."passkey_challenges" ADD CONSTRAINT "passkey_challenges_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "marketplace"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace"."passkey_credentials" ADD CONSTRAINT "passkey_credentials_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "marketplace"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace"."password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "marketplace"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace"."sessions" ADD CONSTRAINT "sessions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "marketplace"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace"."trusted_devices" ADD CONSTRAINT "trusted_devices_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "marketplace"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace"."two_factor_auth" ADD CONSTRAINT "two_factor_auth_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "marketplace"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace"."audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_users_id_fk" FOREIGN KEY ("actorUserId") REFERENCES "marketplace"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace"."backup_runs" ADD CONSTRAINT "backup_runs_createdByUserId_users_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "marketplace"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace"."backup_settings" ADD CONSTRAINT "backup_settings_updatedByUserId_users_id_fk" FOREIGN KEY ("updatedByUserId") REFERENCES "marketplace"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_active_unique_idx" ON "marketplace"."users" USING btree ("username") WHERE "marketplace"."users"."isDeleted" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_active_unique_idx" ON "marketplace"."users" USING btree ("email") WHERE "marketplace"."users"."isDeleted" = false;--> statement-breakpoint
ALTER TABLE "marketplace"."user_settings" ADD CONSTRAINT "user_settings_theme_mode_check" CHECK ("marketplace"."user_settings"."themeMode" in ('dark', 'light'));--> statement-breakpoint
ALTER TABLE "marketplace"."user_settings" ADD CONSTRAINT "user_settings_font_family_check" CHECK ("marketplace"."user_settings"."fontFamily" in ('inter', 'system', 'serif', 'mono'));--> statement-breakpoint
ALTER TABLE "marketplace"."user_settings" ADD CONSTRAINT "user_settings_font_size_check" CHECK ("marketplace"."user_settings"."fontSize" in (14, 15, 16, 17, 18));--> statement-breakpoint
ALTER TABLE "marketplace"."user_settings" ADD CONSTRAINT "user_settings_custom_background_darkness_check" CHECK ("marketplace"."user_settings"."customBackgroundDarkness" is null or ("marketplace"."user_settings"."customBackgroundDarkness" >= 0 and "marketplace"."user_settings"."customBackgroundDarkness" <= 100));--> statement-breakpoint
ALTER TABLE "marketplace"."backup_runs" ADD CONSTRAINT "backup_runs_trigger_check" CHECK ("marketplace"."backup_runs"."trigger" in ('manual', 'scheduled', 'restore-safety', 'import', 'restore'));--> statement-breakpoint
ALTER TABLE "marketplace"."backup_runs" ADD CONSTRAINT "backup_runs_status_check" CHECK ("marketplace"."backup_runs"."status" in ('queued', 'running', 'completed', 'failed'));--> statement-breakpoint
ALTER TABLE "marketplace"."backup_runs" ADD CONSTRAINT "backup_runs_file_size_check" CHECK ("marketplace"."backup_runs"."fileSize" is null or "marketplace"."backup_runs"."fileSize" >= 0);--> statement-breakpoint
ALTER TABLE "marketplace"."backup_settings" ADD CONSTRAINT "backup_settings_schedule_type_check" CHECK ("marketplace"."backup_settings"."scheduleType" in ('daily', 'weekdays', 'interval-hours', 'interval-weeks'));--> statement-breakpoint
ALTER TABLE "marketplace"."backup_settings" ADD CONSTRAINT "backup_settings_schedule_interval_check" CHECK ("marketplace"."backup_settings"."scheduleInterval" between 1 and 168);--> statement-breakpoint
ALTER TABLE "marketplace"."backup_settings" ADD CONSTRAINT "backup_settings_retention_mode_check" CHECK ("marketplace"."backup_settings"."retentionMode" in ('days', 'count', 'both'));--> statement-breakpoint
ALTER TABLE "marketplace"."backup_settings" ADD CONSTRAINT "backup_settings_schedule_hour_check" CHECK ("marketplace"."backup_settings"."scheduleHour" between 0 and 23);--> statement-breakpoint
ALTER TABLE "marketplace"."backup_settings" ADD CONSTRAINT "backup_settings_schedule_minute_check" CHECK ("marketplace"."backup_settings"."scheduleMinute" between 0 and 59);--> statement-breakpoint
ALTER TABLE "marketplace"."backup_settings" ADD CONSTRAINT "backup_settings_retention_days_check" CHECK ("marketplace"."backup_settings"."retentionDays" between 1 and 3650);--> statement-breakpoint
ALTER TABLE "marketplace"."backup_settings" ADD CONSTRAINT "backup_settings_retention_count_check" CHECK ("marketplace"."backup_settings"."retentionCount" between 1 and 1000);