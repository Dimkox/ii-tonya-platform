import { canonicalPrivateProfile } from "@ii-tonya/contracts";
import { createHash } from "node:crypto";
import type { PostgresResidentPrivateJobsRepository } from "@ii-tonya/db";
import {
  compareEducation,
  proposeVerificationFields,
  unavailableSocial,
  type PrivateObjectStore,
  type IsolatedDocumentParser,
  type createTelegramDocumentReader,
  type createTelegramPreviewReader,
  type createVkWallReader,
} from "@ii-tonya/integrations";
export function createResidentPrivateJobsRunner(deps: {
  repository: PostgresResidentPrivateJobsRepository;
  reader: ReturnType<typeof createTelegramDocumentReader>;
  store: PrivateObjectStore;
  parser?: IsolatedDocumentParser;
  social?: ReturnType<typeof createVkWallReader>;
  telegramPreview?: ReturnType<typeof createTelegramPreviewReader>;
}) {
  const controller = new AbortController();
  let active = false;
  return {
    stopAccepting() {
      controller.abort();
    },
    async runOnce() {
      if (controller.signal.aborted) return { reason: "closing" };
      if (active) throw Error("private_cycle_busy");
      active = true;
      const result = { documents: 0, evidence: 0, deletions: 0, failed: 0 };
      try {
        await deps.repository.recoverStalled();
        for (const job of await deps.repository.listEvidenceJobs()) {
          if (controller.signal.aborted) break;
          try {
            const claim = await deps.repository.claimEvidence(
              job.applicationId,
              job.generation,
            );
            if (!claim) continue;
            const observations: Record<string, unknown>[] = [];
            for (const rawProfile of claim.socialLinks.slice(0, 10)) {
              const profile = canonicalPrivateProfile(rawProfile);
              const adapter =
                deps.social && profile.startsWith("https://vk.com/")
                  ? "vk-wall-v1"
                  : profile.startsWith("https://t.me/") && deps.telegramPreview
                    ? "telegram-preview-v1"
                    : "manual-v1";
              const cache = await deps.repository.cachedSocial(
                claim.applicationId,
                profile,
                adapter,
              );
              const observed =
                cache ??
                (deps.social && profile.startsWith("https://vk.com/")
                  ? await deps.social.observe(
                      profile,
                      new Date(),
                      controller.signal,
                    )
                  : deps.telegramPreview && profile.startsWith("https://t.me/")
                    ? await deps.telegramPreview.observe(
                        profile,
                        new Date(),
                        controller.signal,
                      )
                    : unavailableSocial(
                        profile,
                        new Date(),
                        profile.includes("t.me/")
                          ? "telegram_history_unavailable"
                          : "unsupported_capability",
                      ));
              observations.push(observed as unknown as Record<string, unknown>);
            }
            if (await deps.repository.completeEvidence(claim, observations))
              result.evidence++;
          } catch {
            result.failed++;
          }
        }
        for (const job of await deps.repository.listMaterializationJobs()) {
          if (controller.signal.aborted) break;
          try {
            await deps.repository.materializeEvidenceDocuments(
              job.applicationId,
              job.generation,
            );
          } catch {
            result.failed++;
          }
        }
        for (const job of await deps.repository.listDocuments()) {
          if (controller.signal.aborted) break;
          let claim;
          let verifiedSha: string | undefined;
          try {
            claim = await deps.repository.claimDocument(job.id);
            if (!claim) continue;
            const ref = claim.reference;
            const mimeType = ref.kind === "photo" ? "image/jpeg" : ref.mimeType;
            if (ref.size === null || mimeType === null) {
              await deps.repository.completeDocument(claim, {
                kind: "unavailable",
              });
              continue;
            }
            const read = await deps.reader.read({
              botId: claim.botId,
              fileId: ref.fileId,
              size: ref.size,
              mimeType,
              signal: controller.signal,
            });
            if (read.kind !== "read") {
              await deps.repository.completeDocument(claim, {
                kind: "unavailable",
              });
              continue;
            }
            const sha256 = createHash("sha256")
                .update(read.bytes)
                .digest("hex"),
              proof = {
                key: claim.key,
                custodyId: claim.id,
                sha256,
                size: read.bytes.length,
                mimeType: read.mimeType,
              };
            const put = await deps.store.put({
              ...proof,
              bytes: read.bytes,
              signal: controller.signal,
            });
            if (put.kind !== "verified") {
              await deps.repository.completeDocument(claim, {
                kind: "unknown",
                sha256,
              });
              continue;
            }
            verifiedSha = sha256;
            await deps.repository.completeDocument(claim, {
              kind: "verified",
              sha256,
            });
            result.documents++;
            const type = (
              {
                "application/pdf": "pdf",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
                  "docx",
                "image/jpeg": "jpeg",
                "image/png": "png",
              } as const
            )[read.mimeType as "application/pdf"];
            const parsed =
              type && deps.parser
                ? await deps.parser.parse({
                    type,
                    bytes: read.bytes,
                    signal: controller.signal,
                  })
                : null;
            const proposal =
              claim.purpose === "brief" && parsed
                ? proposeVerificationFields(parsed.content, { ...claim.draft })
                : undefined;
            const observation =
              claim.purpose === "education"
                ? compareEducation(
                    parsed?.content ?? "",
                    claim.draft.specialization,
                    parsed?.coverage === "complete",
                  )
                : {
                    result: "UNKNOWN",
                    reason: parsed ? "manual_review" : "parser_unavailable",
                  };
            await deps.repository.completeDocument(claim, {
              kind: "verified",
              sha256,
              ...(proposal && Object.keys(proposal).length ? { proposal } : {}),
              observation,
            });
          } catch {
            result.failed++;
            if (claim)
              await deps.repository
                .completeDocument(
                  claim,
                  verifiedSha
                    ? {
                        kind: "verified",
                        sha256: verifiedSha,
                        observation: {
                          result: "UNKNOWN",
                          reason: "derived_processing_unavailable",
                        },
                      }
                    : { kind: "unknown" },
                )
                .catch(() => undefined);
          }
        }
        for (const claim of await deps.repository.listReconciliations()) {
          if (controller.signal.aborted) break;
          try {
            if (
              claim.reference.size !== null &&
              (claim.reference.mimeType !== null ||
                claim.reference.kind === "photo")
            ) {
              const observed = await deps.store.head(
                {
                  key: claim.key,
                  custodyId: claim.id,
                  sha256: claim.sha256,
                  size: claim.reference.size,
                  mimeType:
                    claim.reference.kind === "photo"
                      ? "image/jpeg"
                      : claim.reference.mimeType!,
                },
                controller.signal,
              );
              if (observed.kind === "verified")
                await deps.repository.completeDocument(claim, {
                  kind: "verified",
                  sha256: claim.sha256,
                });
            }
            await deps.repository.finishReconciliation(claim.id);
          } catch {
            result.failed++;
          }
        }
        for (const deletion of await deps.repository.listDeletions()) {
          if (controller.signal.aborted) break;
          try {
            const operation = await deps.repository.claimDeletion(deletion.id);
            if (!operation) continue;
            // Proof is fenced to the state captured before this DELETE.
            const removed = await deps.store.remove(
              deletion.key,
              controller.signal,
            );
            await deps.repository.recordDeletion(
              deletion.id,
              removed === "deleted" ? "absent" : "unknown",
              operation.token,
            );
            result.deletions++;
          } catch {
            result.failed++;
          }
        }
        return result;
      } finally {
        active = false;
      }
    },
  };
}
