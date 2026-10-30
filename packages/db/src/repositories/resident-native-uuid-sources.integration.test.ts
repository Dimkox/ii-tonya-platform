import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../testkit/expert-referral.js";
import {
  createCorrectionOnboardingFixture,
  correctionEvent,
} from "../../../../tests/support/residency-correction-fixture.js";
import { PostgresExpertCardRepository } from "./expert-card-repository.js";

let database: ExpertReferralTestDatabase;
beforeAll(async () => {
  database = await startExpertReferralTestDatabase(undefined, {
    forceDisposableCluster: true,
  });
  expect(
    (await database.db.execute(sql`show server_version_num`)).rows[0]
      ?.server_version_num,
  ).toBe("170005");
}, 120000);
afterAll(async () => {
  await database?.stop();
}, 120000);

async function richOwner(serviceId: string) {
  const f = await createCorrectionOnboardingFixture(database);
  const repo = new PostgresExpertCardRepository(database.db, {
    richOnboarding: true,
    workBotId: f.workScope.botId,
    workBotKey: f.workScope.botKey,
    messagingConsentPolicyVersion: "client-messaging-v1",
    photoCustody: {
      read: async () => new Uint8Array([1]),
      put: async () => true,
      presign: async (input) => `https://example.com/photos/${input.custodyId}`,
    },
  });
  const handoff = await repo.issueWorkHandoff(correctionEvent(f.scope));
  if (handoff.kind !== "issued") throw Error("uuid_source_handoff_missing");
  await repo.redeemWorkHandoff({
    ...correctionEvent(f.workScope),
    token: handoff.token,
  });
  const revision = async () => (await repo.getWorkflow(f.workScope))!.revision;
  const photos: string[] = [];
  for (let index = 0; index < 3; index++) {
    const event = correctionEvent(f.workScope);
    const reference = `telegram:file:uuid_source_${randomUUID()}`;
    const entry = await repo.addEntry({
      ...event,
      expectedRevision: await revision(),
      entry: { kind: "photo", reference },
    });
    photos.push(
      (
        await repo.ingestRichPhoto({
          ...event,
          expectedRevision: entry.revision,
          reference,
          size: 1,
          mimeType: "image/jpeg",
        })
      ).id,
    );
  }
  const bio =
    "Помогаю разобраться в жизненных задачах и выбрать собственные следующие шаги без обещаний результата.";
  await repo.richAction({
    ...correctionEvent(f.workScope),
    expectedRevision: await revision(),
    action: "patch",
    value: {
      fullName: "Анна",
      specialization: "Консультант",
      bio,
      socialLinks: ["https://example.com/profile"],
      photos,
      onlineRoomType: "STATIC_LINK",
      staticRoomLink: "https://example.com/room",
      services: [
        {
          id: serviceId,
          title: "Консультация",
          format: "ONLINE",
          eventDelivery: null,
          durationMinutes: 60,
          price: { kind: "exact", minRub: "1000.00", maxRub: null },
          description: bio,
          audience: "Взрослые",
          result: "План",
          expiryDate: null,
          detailsUrl: null,
          tags: ["#тревожность"],
        },
      ],
    },
  });
  // Current input parsing canonicalizes new UUIDs. Model an accepted historical
  // collecting source without changing an approved/immutable card version.
  await database.db.execute(
    sql`update expert_card_drafts set rich_profile=jsonb_set(rich_profile,'{services,0,id}',to_jsonb(${serviceId}::text)),revision=revision+1 where user_id=${f.userId}::uuid and status='collecting' and owner_confirmed_digest is null`,
  );
  const send = async (text: string) =>
    (await repo.scheduleAction({ ...correctionEvent(f.workScope), text }))
      .pageText;
  const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  await send("/slots_setup");
  for (const answer of [
    "Europe/Moscow",
    `${date} ${date}`,
    "1 2 3 4 5 6 7",
    "09:00-12:00",
    "нет",
    "15",
  ])
    await send("/slots_answer " + answer);
  let schedule = await send("/slots_preview");
  while (schedule.split("\n").at(-1)!.startsWith("/slots_page"))
    schedule = await send(schedule.split("\n").at(-1)!);
  await send(schedule.split("\n").at(-1)!);
  // The initial-schedule producer admits exact canonical JSON, even though its
  // UUID has an equivalent uppercase spelling. That source must stay immutable.
  const previewSource = (
    await database.db.$client.query(
      "select d.initial_schedule source,upper(d.initial_schedule->>'previewId')::uuid=p.id same_uuid,jsonb_set(d.initial_schedule,'{previewId}',to_jsonb(upper(d.initial_schedule->>'previewId')))=jsonb_build_object('previewId',p.id,'rules',p.rules,'entries',p.entries,'omissions',p.omissions) exact_source from expert_card_drafts d join resident_schedule_previews p on p.id=(d.initial_schedule->>'previewId')::uuid where d.user_id=$1",
      [f.userId],
    )
  ).rows[0]!;
  expect(previewSource).toMatchObject({ same_uuid: true, exact_source: false });
  await expect(
    database.db.$client.query(
      "update expert_card_drafts set initial_schedule=jsonb_set(initial_schedule,'{previewId}',to_jsonb(upper(initial_schedule->>'previewId'))),revision=revision+1 where user_id=$1",
      [f.userId],
    ),
  ).rejects.toMatchObject({ message: "native_initial_schedule_source" });
  expect(
    (
      await database.db.$client.query(
        "select initial_schedule source from expert_card_drafts where user_id=$1",
        [f.userId],
      )
    ).rows[0]!.source,
  ).toEqual(previewSource.source);
  const edit = await repo.editPublicCard({
    sessionHash: f.sessionHash,
    applicationId: f.applicationId,
    expectedRevision: await revision(),
    idempotencyKey: randomUUID(),
    publicCard: {
      displayName: "Анна",
      profession: "Консультант",
      city: "Казань",
      summary: bio,
    },
  });
  let preview = await repo.richAction({
    ...correctionEvent(f.workScope),
    expectedRevision: edit.revision,
    action: "preview",
  });
  while (preview.pageText!.split("\n").at(-1)!.startsWith("/card_preview")) {
    const parts = preview.pageText!.split("\n").at(-1)!.split(" ");
    preview = await repo.richAction({
      ...correctionEvent(f.workScope),
      expectedRevision: edit.revision,
      action: "preview",
      page: Number(parts[2]),
      token: parts[3]!,
    });
  }
  await repo.richAction({
    ...correctionEvent(f.workScope),
    expectedRevision: edit.revision,
    action: "confirm",
    token: preview.pageText!.split(" ").at(-1)!,
  });
  await repo.submitDraft({
    ...correctionEvent(f.workScope),
    expectedRevision: edit.revision,
  });
  const detail = (await repo.readDraft(f.sessionHash, f.applicationId))!;
  return {
    ...f,
    repo,
    draftId: (await repo.getWorkflow(f.workScope))!.draftId!,
    revision: edit.revision,
    warningAcknowledgment: detail.safety.digest,
  };
}

it.each([
  ["uppercase", "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE"],
  ["lowercase", "abcdef01-2345-4678-89ab-cdef01234567"],
])(
  "approves immutable %s service UUID sources and keeps native schedule ownership",
  async (_label, serviceId) => {
    const f = await richOwner(serviceId);
    const source = (
      await database.db.execute<{ profile: unknown; schedule: unknown }>(
        sql`select rich_profile profile,initial_schedule schedule from expert_card_drafts where id=${f.draftId}::uuid`,
      )
    ).rows[0]!;
    expect(source.profile).toMatchObject({ services: [{ id: serviceId }] });
    expect(source.schedule).toMatchObject({
      entries: expect.arrayContaining([expect.objectContaining({ serviceId })]),
    });
    const approved = await f.repo.reviewCard({
      sessionHash: f.sessionHash,
      applicationId: f.applicationId,
      expectedRevision: f.revision,
      idempotencyKey: randomUUID(),
      action: "approve",
      warningAcknowledgment: f.warningAcknowledgment,
    });
    expect(approved.reviewId).toEqual(expect.any(String));
    const version = (
      await database.db.execute<{ profile: unknown; schedule: unknown }>(
        sql`select profile,initial_schedule schedule from resident_card_versions where review_id=${approved.reviewId!}::uuid`,
      )
    ).rows[0]!;
    expect(version).toEqual(source);
    const materialized = (
      await database.db.execute<{
        id: string;
        expertServiceId: string;
        richId: string;
        active: boolean;
      }>(
        sql`select v.id,v.expert_service_id as "expertServiceId",v.rich_service_id::text as "richId",es.active from resident_service_versions v join expert_services es on es.id=v.expert_service_id where v.review_id=${approved.reviewId!}::uuid`,
      )
    ).rows;
    expect(materialized).toHaveLength(1);
    expect(materialized[0]).toMatchObject({
      richId: serviceId.toLowerCase(),
      active: true,
    });
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from resident_native_slots n join resident_schedule_versions s on s.id=n.schedule_id where s.review_id=${approved.reviewId!}::uuid`,
        )
      ).rows[0]?.n,
    ).toBeGreaterThan(0);
    const rewrittenId =
      serviceId === serviceId.toUpperCase()
        ? serviceId.toLowerCase()
        : serviceId.toUpperCase();
    await expect(
      database.db.execute(
        sql`update resident_card_versions set profile=jsonb_set(profile,'{services,0,id}',to_jsonb(${rewrittenId}::text)) where review_id=${approved.reviewId!}::uuid`,
      ),
    ).rejects.toThrow();
    expect(
      (
        await database.db.execute(
          sql`select profile,initial_schedule schedule from resident_card_versions where review_id=${approved.reviewId!}::uuid`,
        )
      ).rows[0],
    ).toEqual(source);
    const foreign = await database.createExpertIdentity();
    const foreignService = (
      await database.db.execute<{ id: string }>(
        sql`insert into expert_services(expert_id,name,code,language,duration_minutes,active) values(${foreign.expertId}::uuid,'Foreign fixture',${randomUUID()},'ru',60,true) returning id`,
      )
    ).rows[0]!.id;
    await expect(
      database.db.$client.query(
        "insert into resident_service_mappings(draft_id,rich_service_id,expert_service_id) values($1,$2,$3)",
        [f.draftId, randomUUID(), foreignService],
      ),
    ).rejects.toMatchObject({ message: "native_mapping_owner" });
    await expect(
      database.db.$client.query(
        "insert into resident_service_versions(review_id,rich_service_id,expert_service_id,title,duration_minutes,format,logistics) select $1,$2,$3,'Консультация',60,'ONLINE',logistics from resident_service_versions where id=$4",
        [
          approved.reviewId!,
          randomUUID(),
          materialized[0]!.expertServiceId,
          materialized[0]!.id,
        ],
      ),
    ).rejects.toMatchObject({ message: "native_service_source" });
    await expect(
      database.db.$client.query(
        "insert into resident_schedule_versions(preview_id,review_id,expert_id,confirmed_at,valid_until) select preview_id,review_id,$2,confirmed_at,valid_until from resident_schedule_versions where review_id=$1",
        [approved.reviewId!, foreign.expertId],
      ),
    ).rejects.toMatchObject({ message: "native_schedule_source" });
    const foreignSlot = (
      await database.db.$client.query(
        "insert into slots(expert_service_id,provider,external_slot_id,starts_at,ends_at,capacity) select $2,'resident_native',$3,s.starts_at,s.ends_at,1 from resident_native_slots n join slots s on s.id=n.slot_id join resident_schedule_versions v on v.id=n.schedule_id where v.review_id=$1 limit 1 returning id",
        [approved.reviewId!, foreignService, randomUUID()],
      )
    ).rows[0]!.id as string;
    await expect(
      database.db.$client.query(
        "insert into resident_native_slots(slot_id,schedule_id,service_version_id,local_start,timezone,buffer_minutes,occupied_until) select $2,n.schedule_id,n.service_version_id,n.local_start,n.timezone,n.buffer_minutes,n.occupied_until from resident_native_slots n join resident_schedule_versions v on v.id=n.schedule_id where v.review_id=$1 limit 1",
        [approved.reviewId!, foreignSlot],
      ),
    ).rejects.toMatchObject({ message: "native_slot_source" });
  },
  120000,
);
