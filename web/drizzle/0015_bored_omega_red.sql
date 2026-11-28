DROP INDEX "marketplace"."audit_logs_action_idx";--> statement-breakpoint
DROP INDEX "marketplace"."audit_logs_actor_user_id_idx";--> statement-breakpoint
DROP INDEX "marketplace"."notifications_user_id_idx";--> statement-breakpoint
DROP INDEX "marketplace"."notifications_is_read_idx";--> statement-breakpoint
DROP INDEX "marketplace"."sessions_user_id_idx";--> statement-breakpoint
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "marketplace"."audit_logs" USING btree ("actorUserId","createdAt");--> statement-breakpoint
CREATE INDEX "audit_logs_action_created_at_idx" ON "marketplace"."audit_logs" USING btree ("action","createdAt");--> statement-breakpoint
CREATE INDEX "notifications_user_id_created_at_idx" ON "marketplace"."notifications" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "notifications_user_id_is_read_idx" ON "marketplace"."notifications" USING btree ("userId","isRead");--> statement-breakpoint
CREATE INDEX "permission_preset_permissions_permission_id_idx" ON "marketplace"."permission_preset_permissions" USING btree ("permissionId");--> statement-breakpoint
CREATE INDEX "public_user_permissions_permission_id_idx" ON "marketplace"."public_user_permissions" USING btree ("permissionId");--> statement-breakpoint
CREATE INDEX "sessions_user_id_expires_at_idx" ON "marketplace"."sessions" USING btree ("userId","expiresAt");--> statement-breakpoint
CREATE INDEX "staff_user_permissions_permission_id_idx" ON "marketplace"."staff_user_permissions" USING btree ("permissionId");