export { createDb, type DrizzleDb } from "./client.js";
export {
  InboxPayloadMismatchError,
  LegacyInboxAssociationError,
  PostgresInboxRepository,
  type InboxClaimCommand,
  type InboxClaimResult,
} from "./repositories/inbox-repository.js";
export {
  BookingDataIntegrityError,
  BookingIdempotencyConflictError,
  BookingSerializationExhaustedError,
  PostgresBookingRepository,
  type BookingRepositoryOptions,
  type BookingExpertScheduleRecord,
  type BookingSlotView,
  type ReservationAction,
  type ReserveSlotCommand,
  type ReserveSlotResult,
  type TransitionReservationCommand,
  type TransitionReservationResult,
  type TransitionTelegramCallbackCommand,
} from "./repositories/booking-repository.js";
export {
  PostgresCatalogRepository,
  type CatalogEligibilityQuery,
  type CatalogExpertRecord,
} from "./repositories/catalog-repository.js";
export {
  CompensationConflictError,
  ConversationCompletionDataError,
  PostgresMessageRepository,
  type AcceptInboundCommand,
  type AcceptInboundResult,
  type CommittedInboundResult,
  type CompleteInboundCommand,
  type CompleteInboundResult,
  type CompensateDebitCommand,
  type InboundCompletionOutcome,
  type MessageRepository,
  type MessageRepositoryOptions,
  type PreparedInbound,
  type RecordOutboundDeliveryCommand,
  withSerializableRetry,
} from "./repositories/message-repository.js";
export {
  OutboxLeaseLostError,
  OutboxStateConflictError,
  PostgresOutboxRepository,
} from "./repositories/outbox-repository.js";
export {
  PostgresTelegramCallbackRepository,
  type ConsumeTelegramCallbackCommand,
  type StoredExpertCallbackClaims,
} from "./repositories/telegram-callback-repository.js";
export {
  PostgresPrivacyRepository,
  PostgresPrivacyWorkflowRepository,
  assertPrivacyWorkflowContract,
  type ErasureJob,
  type PrivacyRepository,
  type StartErasureCommand,
  type SubjectExport,
  type WithdrawConsentCommand,
  type WithdrawalReceipt,
} from "./repositories/privacy-repository.js";
export {
  AdminInvalidStateTransitionError,
  AdminTargetNotFoundError,
  AdminWorkflowConflictError,
  PostgresAdminRepository,
  type AdminWorkflowResult,
  type AlertAdminCommand,
  type ClientAdminCommand,
  type ExpertAdminCommand,
  type GrantAdminPackageCommand,
  type GrantIntroPackageCommand,
  type IntegrationErrorAdminCommand,
  type RevokeAdminPackageCommand,
  type ServiceAdminCommand,
  type WorkflowAuthorization,
} from "./repositories/admin-repository.js";
export {
  PostgresAdminApprovalRepository,
  canonicalAdminPayload,
  canonicalAdminPayloadHash,
  requiredApprovalObjectType,
  type AdminPayload,
  type AdminRole,
  type ApprovalAdminAction,
  type ApproveAdminApproval,
  type ConsumeAdminApproval,
  type ConsumedAdminApproval,
  type RequestAdminApproval,
  type ResolvedAdminPrincipal,
} from "./repositories/admin-approval-repository.js";
export {
  PostgresFeedbackRepository,
  type FeedbackTransactionResult,
  type SubmitFeedbackTransactionCommand,
} from "./repositories/feedback-repository.js";
export * from "./schema/index.js";
