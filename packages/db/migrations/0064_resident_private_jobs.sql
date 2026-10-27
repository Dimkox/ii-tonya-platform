-- Opaque key custody survives erasure; transient pseudonymous linkage binds physical deletion to its receipt.
CREATE TABLE resident_object_deletions (
 custody_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 object_key text NOT NULL UNIQUE,
 write_state text NOT NULL DEFAULT 'allocated' CHECK(write_state IN ('allocated','inflight','settled','unknown')),
 claim_token uuid,
 erased boolean NOT NULL DEFAULT false,
 delete_state text NOT NULL DEFAULT 'dormant' CHECK(delete_state IN ('dormant','pending','unknown','verified')),
 delete_attempts integer NOT NULL DEFAULT 0 CHECK(delete_attempts BETWEEN 0 AND 3),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(object_key='custody/'||custody_id::text),
 CHECK((NOT erased AND delete_state='dormant') OR erased),
 CHECK(delete_state<>'verified' OR write_state IN ('allocated','settled'))
);
--> statement-breakpoint
CREATE TABLE resident_private_objects (
 id uuid PRIMARY KEY REFERENCES resident_object_deletions(custody_id),
 application_id uuid NOT NULL REFERENCES residents_applications(id) ON DELETE CASCADE,
 generation integer NOT NULL CHECK(generation>=0),
 source_revision integer NOT NULL CHECK(source_revision>=0),
 purpose text NOT NULL CHECK(purpose IN ('brief','education','propertyEvidence','tourMedia','licence','followup')),
 reference jsonb NOT NULL CHECK(jsonb_typeof(reference)='object' AND octet_length(reference::text)<=4096),
 consent_authority jsonb NOT NULL,
 state text NOT NULL DEFAULT 'allocated' CHECK(state IN ('allocated','inflight','unknown','verified','unavailable')),
 claim_token uuid,
 started_at timestamptz,
 sha256 text CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 proposal jsonb CHECK(proposal IS NULL OR jsonb_typeof(proposal)='object' AND octet_length(proposal::text)<=16000),
 observation jsonb CHECK(observation IS NULL OR jsonb_typeof(observation)='object' AND octet_length(observation::text)<=16000),
 confirmed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(application_id,generation,source_revision,purpose,reference),
 CHECK(state<>'verified' OR sha256 IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX resident_private_objects_pending ON resident_private_objects(created_at,id) WHERE state='allocated';
--> statement-breakpoint
CREATE INDEX resident_object_deletions_pending ON resident_object_deletions(updated_at,custody_id) WHERE erased AND delete_state IN ('pending','unknown');
--> statement-breakpoint
CREATE FUNCTION retain_resident_private_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE resident_object_deletions SET erased=true,delete_state='pending',updated_at=clock_timestamp() WHERE custody_id=OLD.id;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER resident_private_objects_erase BEFORE DELETE ON resident_private_objects FOR EACH ROW EXECUTE FUNCTION retain_resident_private_deletion();
--> statement-breakpoint
CREATE TABLE resident_evidence_jobs (
 application_id uuid NOT NULL,
 generation integer NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','claimed','complete','cancelled','unknown')),
 claim_token uuid,
 claimed_at timestamptz,
 consent_authority jsonb,
 result jsonb CHECK(result IS NULL OR jsonb_typeof(result)='object' AND octet_length(result::text)<=64000),
 completed_at timestamptz,
 PRIMARY KEY(application_id,generation),
 FOREIGN KEY(application_id,generation) REFERENCES resident_check_generations(application_id,generation) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE resident_social_observations (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 application_id uuid NOT NULL REFERENCES residents_applications(id) ON DELETE CASCADE,
 profile text NOT NULL CHECK(length(profile)<=2048),
 adapter_version text NOT NULL CHECK(length(adapter_version)<=100),
 observed_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 observation jsonb NOT NULL CHECK(jsonb_typeof(observation)='object' AND octet_length(observation::text)<=16000),
 PRIMARY KEY(user_id,profile,adapter_version),
 CHECK(expires_at=observed_at+interval '24 hours')
);
--> statement-breakpoint
CREATE TABLE resident_document_access_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 custody_id uuid NOT NULL,
 manager_id uuid NOT NULL REFERENCES users(id),
 issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '120 seconds',
 action text NOT NULL CHECK(action IN ('link_issued','reconcile_requested'))
);
--> statement-breakpoint
ALTER TABLE resident_private_objects ADD COLUMN reconciliation_requested boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE FUNCTION protect_resident_object_key() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'private_key_responsibility_retained'; END IF;
 IF NEW.custody_id IS DISTINCT FROM OLD.custody_id OR NEW.object_key IS DISTINCT FROM OLD.object_key OR (OLD.erased AND NOT NEW.erased) OR (OLD.claim_token IS NOT NULL AND NEW.claim_token IS DISTINCT FROM OLD.claim_token) OR (OLD.write_state<>'allocated' AND NEW.write_state='allocated') THEN RAISE EXCEPTION 'private_key_immutable'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER resident_object_key_immutable BEFORE UPDATE OR DELETE ON resident_object_deletions FOR EACH ROW EXECUTE FUNCTION protect_resident_object_key();
--> statement-breakpoint
ALTER TABLE resident_evidence_jobs ADD COLUMN document_cursor integer NOT NULL DEFAULT 0 CHECK(document_cursor>=0), ADD COLUMN documents_materialized boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE resident_object_deletions ADD COLUMN subject_erasure_key text CHECK(subject_erasure_key ~ '^[0-9a-f]{64}$'), ADD COLUMN deletion_job_id uuid REFERENCES privacy_deletion_jobs(id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_resident_object_key() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'private_key_responsibility_retained'; END IF;
 IF TG_OP='UPDATE' AND (NEW.custody_id IS DISTINCT FROM OLD.custody_id OR NEW.object_key IS DISTINCT FROM OLD.object_key OR (OLD.erased AND NOT NEW.erased) OR (OLD.claim_token IS NOT NULL AND NEW.claim_token IS DISTINCT FROM OLD.claim_token) OR (OLD.write_state<>'allocated' AND NEW.write_state='allocated') OR (OLD.subject_erasure_key IS DISTINCT FROM NEW.subject_erasure_key AND NOT (NEW.subject_erasure_key IS NULL AND (NEW.deletion_job_id IS NOT NULL OR NEW.delete_state='verified'))) OR (OLD.deletion_job_id IS NOT NULL AND NEW.deletion_job_id IS DISTINCT FROM OLD.deletion_job_id)) THEN RAISE EXCEPTION 'private_key_immutable'; END IF;
 IF NEW.delete_state<>'verified' AND EXISTS(SELECT 1 FROM privacy_deletion_jobs p WHERE p.status IN('processor_complete','backup_verified') AND (p.id=NEW.deletion_job_id OR NEW.subject_erasure_key=encode(digest('resident-private:'||p.user_id::text,'sha256'),'hex'))) THEN RAISE EXCEPTION 'private_object_erasure_pending'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER resident_object_key_immutable ON resident_object_deletions;
--> statement-breakpoint
CREATE TRIGGER resident_object_key_immutable BEFORE INSERT OR UPDATE OR DELETE ON resident_object_deletions FOR EACH ROW EXECUTE FUNCTION protect_resident_object_key();
--> statement-breakpoint
CREATE FUNCTION resident_private_erasure_completion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status IN('processor_complete','backup_verified') AND EXISTS(SELECT 1 FROM resident_object_deletions d LEFT JOIN privacy_deletion_jobs p ON p.id=d.deletion_job_id WHERE d.delete_state<>'verified' AND (d.subject_erasure_key=encode(digest('resident-private:'||NEW.user_id::text,'sha256'),'hex') OR p.user_id=NEW.user_id)) THEN RAISE EXCEPTION 'private_object_erasure_pending'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER resident_private_erasure_completion_guard BEFORE INSERT OR UPDATE OF status ON privacy_deletion_jobs FOR EACH ROW EXECUTE FUNCTION resident_private_erasure_completion();
--> statement-breakpoint
CREATE INDEX resident_object_deletions_subject ON resident_object_deletions(subject_erasure_key) WHERE subject_erasure_key IS NOT NULL;
--> statement-breakpoint
CREATE INDEX resident_object_deletions_job ON resident_object_deletions(deletion_job_id) WHERE deletion_job_id IS NOT NULL;

--> statement-breakpoint
ALTER TABLE resident_object_deletions ADD CONSTRAINT resident_private_erasure_link CHECK(subject_erasure_key IS NOT NULL OR deletion_job_id IS NOT NULL OR delete_state='verified');
