ALTER TABLE "privacy_deletion_manifests" ALTER COLUMN "key_reference" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "privacy_deletion_manifests" ALTER COLUMN "algorithm" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "privacy_deletion_manifests" ALTER COLUMN "version" DROP DEFAULT;