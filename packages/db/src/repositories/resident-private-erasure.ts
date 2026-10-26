import { createHash } from "node:crypto";
/** Transient pseudonymous linkage until a formal privacy job exists; never a Telegram identifier. */
export const privateObjectErasureSubjectKey = (userId: string) =>
  createHash("sha256")
    .update("resident-private:" + userId.toLowerCase())
    .digest("hex");
