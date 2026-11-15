CREATE TABLE "tanstackdummydb"."default_user_permissions" (
	"permissionId" uuid PRIMARY KEY NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tanstackdummydb"."permission_preset_permissions" (
	"presetId" uuid NOT NULL,
	"permissionId" uuid NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permission_preset_permissions_presetId_permissionId_pk" PRIMARY KEY("presetId","permissionId")
);
--> statement-breakpoint
CREATE TABLE "tanstackdummydb"."permission_presets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permission_presets_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "tanstackdummydb"."default_user_permissions" ADD CONSTRAINT "default_user_permissions_permissionId_permissions_id_fk" FOREIGN KEY ("permissionId") REFERENCES "tanstackdummydb"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tanstackdummydb"."permission_preset_permissions" ADD CONSTRAINT "permission_preset_permissions_presetId_permission_presets_id_fk" FOREIGN KEY ("presetId") REFERENCES "tanstackdummydb"."permission_presets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tanstackdummydb"."permission_preset_permissions" ADD CONSTRAINT "permission_preset_permissions_permissionId_permissions_id_fk" FOREIGN KEY ("permissionId") REFERENCES "tanstackdummydb"."permissions"("id") ON DELETE cascade ON UPDATE no action;