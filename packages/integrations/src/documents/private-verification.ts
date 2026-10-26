import { canonicalPrivateProfile } from "@ii-tonya/contracts";
import { createHash } from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
const MAX_BYTES = 20 * 1024 * 1024;
const mimes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "video/mp4",
]);
const objectKey =
  /^custody\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
/** Streaming accounting includes a deadline covering headers AND body. Errors are never forwarded. */
async function bounded(
  response: Response,
  max: number,
  signal: AbortSignal,
): Promise<Buffer> {
  if (!response.ok || !response.body) throw Error("unavailable");
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > max))
    throw Error("size");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let count = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      count += value.byteLength;
      if (count > max) throw Error("size");
      chunks.push(value);
    }
    if (length !== null && Number(length) !== count) throw Error("truncated");
    return Buffer.concat(chunks, count);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
function magic(b: Buffer, mime: string) {
  if (mime === "application/pdf")
    return b.subarray(0, 5).toString() === "%PDF-";
  if (mime === "image/jpeg")
    return b[0] === 255 && b[1] === 216 && b[2] === 255;
  if (mime === "image/png")
    return b
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "video/mp4") return b.subarray(4, 8).toString() === "ftyp";
  return (
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" &&
    b.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))
  );
}
export interface PrivateDocumentReference {
  fileId: string;
  size: number;
  mimeType: string;
  botId: string;
  signal: AbortSignal;
}
export type DocumentRead =
  | { kind: "read"; bytes: Buffer; mimeType: string }
  | {
      kind: "unavailable";
      reason:
        "source_identity" | "invalid_file" | "transport_unavailable" | "busy";
    };
export function createTelegramDocumentReader(options: {
  botId: string;
  token: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}) {
  const transport = options.fetch ?? fetch;
  const timeout = options.timeoutMs ?? 10000;
  let active = false;
  if (
    !/^[1-9]\d{0,15}$/u.test(options.botId) ||
    !options.token.startsWith(options.botId + ":") ||
    !/^[\w:-]+$/u.test(options.token) ||
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 20000
  )
    throw Error("private_reader_configuration");
  return {
    async read(input: PrivateDocumentReference): Promise<DocumentRead> {
      if (input.botId !== options.botId)
        return { kind: "unavailable", reason: "source_identity" };
      if (
        !/^[\w-]{1,512}$/u.test(input.fileId) ||
        !Number.isSafeInteger(input.size) ||
        input.size < 1 ||
        input.size > MAX_BYTES ||
        !mimes.has(input.mimeType)
      )
        return { kind: "unavailable", reason: "invalid_file" };
      if (active) return { kind: "unavailable", reason: "busy" };
      active = true;
      const signal = AbortSignal.any([
        input.signal,
        AbortSignal.timeout(timeout),
      ]);
      try {
        signal.throwIfAborted();
        const meta = JSON.parse(
          (
            await bounded(
              await transport(
                `https://api.telegram.org/bot${options.token}/getFile`,
                {
                  method: "POST",
                  redirect: "error",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ file_id: input.fileId }),
                  signal,
                },
              ),
              16384,
              signal,
            )
          ).toString(),
        ) as {
          ok?: unknown;
          result?: {
            file_id?: unknown;
            file_size?: unknown;
            file_path?: unknown;
          };
        };
        const r = meta.result,
          p = r?.file_path;
        if (
          meta.ok !== true ||
          r?.file_id !== input.fileId ||
          r.file_size !== input.size ||
          typeof p !== "string" ||
          p.length > 512 ||
          !p
            .split("/")
            .every(
              (s) =>
                /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/u.test(s) &&
                s !== "." &&
                s !== "..",
            )
        )
          return { kind: "unavailable", reason: "invalid_file" };
        const data = await bounded(
          await transport(
            `https://api.telegram.org/file/bot${options.token}/${p}`,
            { redirect: "error", signal },
          ),
          input.size,
          signal,
        );
        if (data.length !== input.size || !magic(data, input.mimeType))
          return { kind: "unavailable", reason: "invalid_file" };
        return { kind: "read", bytes: data, mimeType: input.mimeType };
      } catch {
        return { kind: "unavailable", reason: "transport_unavailable" };
      } finally {
        active = false;
      }
    },
  };
}
export interface ObjectProof {
  key: string;
  custodyId: string;
  sha256: string;
  size: number;
  mimeType: string;
}
export type ObjectResult =
  { kind: "verified" } | { kind: "unknown" } | { kind: "absent" };
export interface PrivateObjectStore {
  put(
    input: ObjectProof & { bytes: Uint8Array; signal: AbortSignal },
  ): Promise<ObjectResult>;
  head(input: ObjectProof, signal: AbortSignal): Promise<ObjectResult>;
  remove(key: string, signal: AbortSignal): Promise<"deleted" | "unknown">;
  presign(input: ObjectProof): Promise<string>;
}
export function createPrivateObjectStore(options: {
  bucket: string;
  region: string;
  endpoint: string;
  credentials: { accessKeyId: string; secretAccessKey: string };
  dedicatedNonVersionedVerified: boolean;
  localEvidence?: boolean;
  timeoutMs?: number;
}): PrivateObjectStore {
  let endpoint: URL;
  try {
    endpoint = new URL(options.endpoint);
  } catch {
    throw Error("private_store_configuration");
  }
  if (
    !options.dedicatedNonVersionedVerified ||
    !options.credentials.accessKeyId ||
    !options.credentials.secretAccessKey ||
    !options.region ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(options.bucket) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== "/" ||
    !(
      endpoint.protocol === "https:" ||
      (options.localEvidence === true &&
        endpoint.protocol === "http:" &&
        endpoint.hostname === "127.0.0.1")
    )
  )
    throw Error("private_store_configuration");
  const timeout = options.timeoutMs ?? 10000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 20000)
    throw Error("private_store_configuration");
  const client = new S3Client({
    region: options.region,
    endpoint: options.endpoint,
    credentials: { ...options.credentials },
    maxAttempts: 1,
    forcePathStyle: true,
    followRegionRedirects: false,
    requestHandler: { connectionTimeout: timeout, requestTimeout: timeout },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const valid = (p: ObjectProof) =>
    objectKey.test(p.key) &&
    p.key === `custody/${p.custodyId}` &&
    /^[0-9a-f]{64}$/u.test(p.sha256) &&
    Number.isSafeInteger(p.size) &&
    p.size > 0 &&
    p.size <= MAX_BYTES &&
    mimes.has(p.mimeType);
  const signalFor = (s: AbortSignal) =>
    AbortSignal.any([s, AbortSignal.timeout(timeout)]);
  const head = async (
    p: ObjectProof,
    signal: AbortSignal,
  ): Promise<ObjectResult> => {
    if (!valid(p)) return { kind: "unknown" };
    try {
      const h = await client.send(
        new HeadObjectCommand({
          Bucket: options.bucket,
          Key: p.key,
          ChecksumMode: "ENABLED",
        }),
        { abortSignal: signalFor(signal) },
      );
      return h.ContentLength === p.size &&
        h.ContentType === p.mimeType &&
        h.ChecksumSHA256 === Buffer.from(p.sha256, "hex").toString("base64") &&
        h.Metadata?.sha256 === p.sha256 &&
        h.Metadata?.["custody-id"] === p.custodyId &&
        h.Metadata?.schema === "1" &&
        h.VersionId === undefined
        ? { kind: "verified" }
        : { kind: "unknown" };
    } catch (e) {
      return {
        kind:
          (e as { $metadata?: { httpStatusCode?: number } })?.$metadata
            ?.httpStatusCode === 404
            ? "absent"
            : "unknown",
      };
    }
  };
  return {
    head,
    async put(p) {
      if (
        !valid(p) ||
        p.bytes.byteLength !== p.size ||
        createHash("sha256").update(p.bytes).digest("hex") !== p.sha256
      )
        return { kind: "unknown" };
      try {
        const r = await client.send(
          new PutObjectCommand({
            Bucket: options.bucket,
            Key: p.key,
            Body: p.bytes,
            ContentLength: p.size,
            ContentType: p.mimeType,
            IfNoneMatch: "*",
            ChecksumSHA256: Buffer.from(p.sha256, "hex").toString("base64"),
            Metadata: {
              sha256: p.sha256,
              "custody-id": p.custodyId,
              schema: "1",
            },
            ContentDisposition: "attachment",
            CacheControl: "no-store",
          }),
          { abortSignal: signalFor(p.signal) },
        );
        if (r.VersionId !== undefined) return { kind: "unknown" };
      } catch (e) {
        if (
          (e as { $metadata?: { httpStatusCode?: number } })?.$metadata
            ?.httpStatusCode !== 412
        )
          return { kind: "unknown" };
      }
      const proof = await head(p, p.signal);
      return proof.kind === "verified" ? proof : { kind: "unknown" };
    },
    async remove(key, signal) {
      if (!objectKey.test(key)) return "unknown";
      try {
        await client.send(
          new DeleteObjectCommand({ Bucket: options.bucket, Key: key }),
          { abortSignal: signalFor(signal) },
        );
        return "deleted";
      } catch {
        return "unknown";
      }
    },
    async presign(p) {
      if (!valid(p)) throw Error("private_object_unavailable");
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: options.bucket,
          Key: p.key,
          ResponseContentDisposition: "attachment",
          ResponseCacheControl: "no-store",
        }),
        { expiresIn: 120 },
      );
    },
  };
}
export interface SocialObservation {
  source: string;
  adapterVersion: string;
  profile: string;
  observedAt: string;
  expiresAt: string;
  coverage: "complete_latest" | "partial" | "unavailable";
  reason: string | null;
  posts: {
    id: string;
    publishedAt: string;
    hasMedia: boolean;
    comments: number | null;
  }[];
  activity: "ACTIVE" | "INACTIVE" | "UNKNOWN";
  score: null;
  scorePolicy: "not_configured";
}
export function unavailableSocial(
  profile: string,
  now: Date,
  reason: string,
): SocialObservation {
  return {
    source: "manual",
    adapterVersion: "manual-v1",
    profile,
    observedAt: now.toISOString(),
    expiresAt: new Date(+now + 86400000).toISOString(),
    coverage: "unavailable",
    reason,
    posts: [],
    activity: "UNKNOWN",
    score: null,
    scorePolicy: "not_configured",
  };
}
export function createVkWallReader(options: {
  token: string;
  tokenKind: "user" | "service";
  fetch?: typeof fetch;
  timeoutMs?: number;
}) {
  if (!options.token || !["user", "service"].includes(options.tokenKind))
    throw Error("vk_wall_configuration");
  const timeout = options.timeoutMs ?? 5000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 10000)
    throw Error("vk_wall_configuration");
  return {
    async observe(
      profile: string,
      now: Date,
      signal: AbortSignal,
    ): Promise<SocialObservation> {
      profile = canonicalPrivateProfile(profile);
      const match =
        /^https:\/\/(?:www\.)?vk\.com\/(id|club|public)([1-9]\d{0,18})\/?$/u.exec(
          profile,
        );
      if (!match) return unavailableSocial(profile, now, "unsupported_profile");
      const canonical = `https://vk.com/${match[1]}${match[2]}`;
      const unavailable = () => ({
        ...unavailableSocial(canonical, now, "vk_unavailable"),
        source: "vk_api",
        adapterVersion: "vk-wall-v1",
      });
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
      try {
        const body = new URLSearchParams({
          access_token: options.token,
          v: "5.199",
          owner_id: (match[1] === "id" ? "" : "-") + match[2],
          count: "6",
          offset: "0",
          filter: "owner",
        });
        const raw = JSON.parse(
          (
            await bounded(
              await (options.fetch ?? fetch)(
                "https://api.vk.com/method/wall.get",
                {
                  method: "POST",
                  redirect: "error",
                  headers: {
                    "content-type": "application/x-www-form-urlencoded",
                  },
                  body,
                  signal: deadline,
                },
              ),
              256000,
              deadline,
            )
          ).toString(),
        ) as {
          response?: { count?: number; items?: Record<string, unknown>[] };
        };
        const r = raw.response;
        if (
          !r ||
          !Number.isSafeInteger(r.count) ||
          r.count! < 0 ||
          !Array.isArray(r.items) ||
          r.items.length > 6 ||
          !r.items.length
        )
          return unavailable();
        const posts: SocialObservation["posts"] = [];
        for (const p of r.items) {
          if (
            !Number.isSafeInteger(p.id) ||
            !Number.isSafeInteger(p.date) ||
            Number(p.date) <= 0 ||
            Number(p.date) * 1000 > +now
          )
            return unavailable();
          const c = p.comments as { count?: unknown } | undefined;
          posts.push({
            id: String(p.id),
            publishedAt: new Date(Number(p.date) * 1000).toISOString(),
            hasMedia:
              Array.isArray(p.attachments) &&
              p.attachments.some(
                (a) =>
                  a &&
                  typeof a === "object" &&
                  ["photo", "video", "audio", "doc"].includes(
                    String((a as { type?: unknown }).type),
                  ),
              ),
            comments:
              c && Number.isSafeInteger(c.count) && Number(c.count) >= 0
                ? Number(c.count)
                : null,
          });
        }
        const latest = [...new Map(posts.map((p) => [p.id, p])).values()]
          .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
          .slice(0, 5);
        // Six observations include at most one pinned post, leaving five chronological entries.
        const complete = r.items.length === 6 || r.items.length === r.count;
        return {
          source: "vk_api",
          adapterVersion: "vk-wall-v1",
          profile: canonical,
          observedAt: now.toISOString(),
          expiresAt: new Date(+now + 86400000).toISOString(),
          coverage: complete ? "complete_latest" : "partial",
          reason: complete ? null : "incomplete_page",
          posts: latest,
          activity: complete
            ? +now - Date.parse(latest[0]!.publishedAt) > 30 * 86400000
              ? "INACTIVE"
              : "ACTIVE"
            : "UNKNOWN",
          score: null,
          scorePolicy: "not_configured",
        };
      } catch {
        return unavailable();
      }
    },
  };
}
/** Deliberately partial/unofficial; preview pages cannot prove inactivity or zero comments. */
export function createTelegramPreviewReader(
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
) {
  const timeout = options.timeoutMs ?? 5000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 10000)
    throw Error("telegram_preview_configuration");
  return {
    async observe(
      profile: string,
      now: Date,
      signal: AbortSignal,
    ): Promise<SocialObservation> {
      profile = canonicalPrivateProfile(profile);
      const match = /^https:\/\/t\.me\/([A-Za-z][A-Za-z0-9_]{4,31})\/?$/u.exec(
        profile,
      );
      if (!match) return unavailableSocial(profile, now, "unsupported_profile");
      const handle = match[1]!,
        canonical = "https://t.me/" + handle.toLowerCase();
      const unavailable = () => ({
        ...unavailableSocial(canonical, now, "telegram_preview_unavailable"),
        source: "telegram_public_preview",
        adapterVersion: "telegram-preview-v1",
      });
      try {
        const deadline = AbortSignal.any([
          signal,
          AbortSignal.timeout(timeout),
        ]);
        const html = (
          await bounded(
            await (options.fetch ?? fetch)(`https://t.me/s/${handle}`, {
              redirect: "error",
              signal: deadline,
            }),
            256000,
            deadline,
          )
        ).toString();
        const chunks = html.split(/data-post="/u).slice(1, 51),
          posts: SocialObservation["posts"] = [];
        for (const chunk of chunks) {
          const id = /^([A-Za-z0-9_]+)\/(\d{1,15})"/u.exec(chunk),
            time = /<time\b[^>]{0,500}\bdatetime="([0-9T:+.Z-]{10,40})"/u.exec(
              chunk,
            );
          if (!id || id[1]!.toLowerCase() !== handle.toLowerCase() || !time)
            continue;
          const date = Date.parse(time[1]!);
          if (!Number.isFinite(date) || date > +now) continue;
          posts.push({
            id: id[2]!,
            publishedAt: new Date(date).toISOString(),
            hasMedia:
              /class="[^"\n]{0,500}\btgme_widget_message_(?:photo_wrap|video_player)\b/u.test(
                chunk,
              ),
            comments: null,
          });
        }
        if (!posts.length) return unavailable();
        return {
          source: "telegram_public_preview",
          adapterVersion: "telegram-preview-v1",
          profile: canonical,
          observedAt: now.toISOString(),
          expiresAt: new Date(+now + 86400000).toISOString(),
          coverage: "partial",
          reason: "unofficial_preview_not_history",
          posts: [...new Map(posts.map((p) => [p.id, p])).values()]
            .sort(
              (a, b) =>
                b.publishedAt.localeCompare(a.publishedAt) ||
                Number(b.id) - Number(a.id),
            )
            .slice(0, 5),
          activity: "UNKNOWN",
          score: null,
          scorePolicy: "not_configured",
        };
      } catch {
        return unavailable();
      }
    },
  };
}
