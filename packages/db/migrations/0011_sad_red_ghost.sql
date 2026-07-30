ALTER TABLE "privacy_deletion_manifests" ADD COLUMN "key_reference" text DEFAULT 'unbound-placeholder' NOT NULL;--> statement-breakpoint
ALTER TABLE "privacy_deletion_manifests" ADD COLUMN "algorithm" text DEFAULT 'opaque-envelope' NOT NULL;--> statement-breakpoint
ALTER TABLE "privacy_deletion_manifests" ADD COLUMN "version" text DEFAULT 'v1' NOT NULL;