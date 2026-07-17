/**
 * End-to-end integration test for the AI transcriber / meeting-minutes pipeline.
 *
 * It provisions a 3-member group, starts a group meeting, has all three members
 * join, then uploads one audio track per speaker (with a manifest) to the
 * "end with summary" endpoint and asserts that the async pipeline produces
 * speaker-labeled transcripts, an AI title, and retrievable minutes — including
 * the host-only and group-membership authorization rules and the Ask-AI endpoint.
 *
 * The external Groq calls (Whisper transcription, Llama summarization/title/QA)
 * are stubbed via AI_STUB=1 so the test is deterministic, free, and offline.
 * It DOES use the real database (same DATABASE_URL as the app) and the real
 * Redis-backed BullMQ pipeline (REDIS_URL — run `docker-compose up -d redis`
 * first), and cleans up after itself.
 *
 * Run:  npm test                       (from apps/server)
 *       SHOW_MINUTES=1 npm test        also prints the stored transcript+summary
 *       KEEP_TEST_DATA=1 npm test      leaves rows in the DB for inspection
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

// Must be set BEFORE importing the app: keeps it from binding the default port
// and routes the AI calls to their deterministic stubs.
process.env.NODE_ENV = 'test';
process.env.AI_STUB = '1';

const { app } = (await import('../src/index.ts')) as { app: import('express').Express };
const db = (await import('../db.ts')).default;
// Same module instances the app uses (ESM cache) — needed for teardown: the
// worker/queue hold open Redis connections that would keep node --test alive.
const { stopMinutesWorker } = await import('../src/queue/minutesWorker.ts');
const { minutesQueue } = await import('../src/queue/minutesQueue.ts');
const { closeAllRedisConnections } = await import('../src/queue/connection.ts');

// Never send real emails from the test suite: dotenv has loaded .env by now,
// so drop the SMTP config — the mailer then logs previews instead of sending.
delete process.env.SMTP_HOST;
delete process.env.SMTP_PORT;

const STUB_AI_TITLE = 'Weekly sync — release planning';

let server: Server;
let base = '';

const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

type TestUser = { email: string; password: string; displayName: string; token: string; id: string };

function makeUser(tag: string, displayName: string): TestUser {
  return { email: `t-${tag}-${suffix}@example.test`, password: 'Passw0rd!23', displayName, token: '', id: '' };
}

const owner = makeUser('owner', 'Test Owner');
const memberA = makeUser('a', 'Member A');
const memberB = makeUser('b', 'Member B');
const outsider = makeUser('out', 'Outsider');
const everyone = [owner, memberA, memberB, outsider];

let groupId = '';
let roomCode = '';
let secondGroupId = '';
let standaloneRoomCode = '';

/** Minimal JSON HTTP helper against the running app. */
async function api(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {};
  const init: RequestInit = { method, headers };

  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  if (opts.token) {
    headers.Authorization = `Bearer ${opts.token}`;
  }

  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

/**
 * Uploads dummy audio to the "end with summary" endpoint. With `tracks` it
 * sends one file per speaker plus the manifest (the multi-speaker path);
 * without, it sends a single bare file (the legacy/back-compat path).
 */
async function uploadMeetingTracks(
  token: string,
  code: string,
  tracks?: Array<{ speaker: string; offsetMs: number }>,
): Promise<{ status: number; data: any }> {
  const form = new FormData();
  const count = tracks?.length ?? 1;

  for (let i = 0; i < count; i += 1) {
    form.append('audio', new Blob([Buffer.from(`stub-audio-${i}`)], { type: 'audio/webm' }), `track-${i}.webm`);
  }

  if (tracks) {
    form.append(
      'manifest',
      JSON.stringify({ tracks: tracks.map((track, index) => ({ index, ...track })) }),
    );
  }

  const res = await fetch(`${base}/rooms/${code}/end-with-summary`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

/** Polls the group's minutes list until `expected` rows exist (async pipeline). */
async function waitForMinutes(token: string, expected: number, timeoutMs = 15_000): Promise<any[]> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const res = await api('GET', `/groups/${groupId}/minutes`, { token });
    if (res.status === 200 && Array.isArray(res.data) && res.data.length >= expected) {
      return res.data;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for ${expected} minutes row(s)`);
}

before(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;

  // Register all four accounts (owner + 2 members + 1 outsider).
  for (const user of everyone) {
    const res = await api('POST', '/auth/register', {
      body: { email: user.email, password: user.password, display_name: user.displayName },
    });
    assert.equal(res.status, 201, `register ${user.email} failed: ${JSON.stringify(res.data)}`);
    user.token = res.data.accessToken;
    user.id = res.data.user.id;
    assert.ok(user.token && user.id, 'register should return an access token and user id');
  }
});

after(async () => {
  try {
    // Run `KEEP_TEST_DATA=1 npm test` to leave the group/room/minutes in the DB
    // so you can inspect the stored transcript in Supabase or the app afterward.
    if (process.env.KEEP_TEST_DATA === '1') {
      console.log('\n[KEEP_TEST_DATA=1] Test data left in the database for inspection:');
      console.log(`  group id:    ${groupId}`);
      console.log(`  room code:   ${roomCode}`);
      console.log(`  owner login: ${owner.email}  /  ${owner.password}`);
      console.log(`  SQL: select title, raw_transcript, summary_markdown from meeting_minutes where group_id = '${groupId}';`);
      return;
    }

    for (const gid of [groupId, secondGroupId]) {
      if (!gid) continue;
      // meeting_minute_chunks cascade from minutes/group deletion.
      await db.meetingMinute.deleteMany({ where: { groupId: gid } });
      // Deleting rooms cascades participants and messages.
      await db.room.deleteMany({ where: { groupId: gid } });
      await db.groupMember.deleteMany({ where: { groupId: gid } });
      await db.group.deleteMany({ where: { id: gid } });
    }
    // Standalone (group-less) room + its cascaded minutes.
    if (standaloneRoomCode) {
      await db.room.deleteMany({ where: { roomCode: standaloneRoomCode } });
    }
    const ids = everyone.map((u) => u.id).filter(Boolean);
    if (ids.length) {
      await db.user.deleteMany({ where: { id: { in: ids } } });
    }
  } finally {
    await stopMinutesWorker().catch(() => { });
    await minutesQueue.close().catch(() => { });
    // BullMQ never closes externally-provided connections — do it here or the
    // open sockets keep the node --test event loop alive forever.
    await closeAllRedisConnections().catch(() => { });
    await db.$disconnect().catch(() => { });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('AI transcriber pipeline for a 3-member group meeting', async (t) => {
  await t.test('owner creates a group and enables the AI summarizer', async () => {
    const create = await api('POST', '/groups', {
      token: owner.token,
      body: { name: `Test Group ${suffix}`, description: 'automated transcriber test' },
    });
    assert.equal(create.status, 201, JSON.stringify(create.data));
    groupId = create.data.id;
    assert.ok(groupId, 'group should have an id');

    const patch = await api('PATCH', `/groups/${groupId}`, {
      token: owner.token,
      body: { summarizer_enabled: true },
    });
    assert.equal(patch.status, 200, JSON.stringify(patch.data));

    const detail = await api('GET', `/groups/${groupId}`, { token: owner.token });
    assert.equal(detail.status, 200);
    assert.equal(detail.data.summarizer_enabled, true, 'summarizer should be enabled');
  });

  await t.test('owner adds two members (3 in the group)', async () => {
    for (const member of [memberA, memberB]) {
      const add = await api('POST', `/groups/${groupId}/members`, {
        token: owner.token,
        body: { email: member.email },
      });
      assert.ok(add.status === 200 || add.status === 201, `add ${member.email}: ${add.status} ${JSON.stringify(add.data)}`);
    }

    const detail = await api('GET', `/groups/${groupId}`, { token: owner.token });
    assert.equal(detail.status, 200);
    assert.equal(detail.data.members.length, 3, 'group should have exactly 3 members');
  });

  await t.test('owner starts the group meeting', async () => {
    // Mark the members online so the endpoint doesn't fire "meeting started"
    // emails at offline members (which would need SMTP/APP_URL config).
    await db.user.updateMany({
      where: { id: { in: [memberA.id, memberB.id] } },
      data: { isOnline: true },
    });

    const start = await api('POST', `/groups/${groupId}/meetings`, { token: owner.token });
    assert.equal(start.status, 201, JSON.stringify(start.data));
    roomCode = start.data.room.room_code;
    assert.ok(roomCode, 'meeting should return a room code');
  });

  await t.test('all three members join the room', async () => {
    for (const user of [owner, memberA, memberB]) {
      const join = await api('POST', `/rooms/${roomCode}/join`, { token: user.token });
      assert.equal(join.status, 200, `join by ${user.email}: ${JSON.stringify(join.data)}`);
    }
  });

  await t.test('a non-host member cannot end the meeting for everyone (403)', async () => {
    const res = await uploadMeetingTracks(memberA.token, roomCode);
    assert.equal(res.status, 403, `expected 403, got ${res.status}: ${JSON.stringify(res.data)}`);
  });

  let minutesId = '';

  await t.test('host uploads one track per speaker → 202, minutes appear', async () => {
    const res = await uploadMeetingTracks(owner.token, roomCode, [
      { speaker: owner.displayName, offsetMs: 0 },
      { speaker: memberA.displayName, offsetMs: 2000 },
      { speaker: memberB.displayName, offsetMs: 4000 },
    ]);
    assert.equal(res.status, 202, JSON.stringify(res.data));
    assert.equal(res.data.processing, true, 'should report background processing');

    const minutes = await waitForMinutes(owner.token, 1);
    assert.equal(minutes.length, 1, 'exactly one set of minutes');
    minutesId = minutes[0].id;
    assert.ok(minutesId, 'minutes row should have an id');
  });

  await t.test('the room is marked inactive after ending', async () => {
    const res = await api('GET', `/rooms/${roomCode}`, { token: owner.token });
    assert.equal(res.status, 404, 'ended room should no longer be fetchable as active');
  });

  await t.test('minutes get an AI title and count all 3 speakers', async () => {
    const list = await api('GET', `/groups/${groupId}/minutes`, { token: owner.token });
    assert.equal(list.status, 200);
    assert.equal(list.data[0].id, minutesId);
    assert.ok(
      String(list.data[0].title).startsWith(STUB_AI_TITLE),
      `title should start with the AI title, got: ${list.data[0].title}`,
    );
    assert.equal(list.data[0].participant_count, 3, 'all 3 speakers should be counted');
  });

  await t.test('any group member can open the full minutes (speaker-labeled transcript + summary)', async () => {
    const res = await api('GET', `/groups/${groupId}/minutes/${minutesId}`, { token: memberB.token });
    assert.equal(res.status, 200, JSON.stringify(res.data));

    assert.match(res.data.raw_transcript, /\[00:00\] Test Owner: Welcome everyone/, 'host speech should be labeled');
    assert.match(res.data.raw_transcript, /Member A: Alex will send the report/, 'member speech should be labeled');
    assert.match(res.data.raw_transcript, /Member B: /, 'all speakers should appear');
    assert.match(res.data.summary_markdown, /## Summary/, 'summary should be structured markdown');
    assert.match(res.data.summary_markdown, /## Action items/, 'summary should include an action items section');
    assert.match(res.data.summary_markdown, /\[ACTION\]/, 'summary should flag action items');
    assert.equal(res.data.participant_count, 3);

    // Run `SHOW_MINUTES=1 npm test` to print the stored transcript + summary.
    if (process.env.SHOW_MINUTES === '1') {
      console.log('\n===== stored raw_transcript =====\n' + res.data.raw_transcript);
      console.log('\n===== stored summary_markdown =====\n' + res.data.summary_markdown + '\n');
    }
  });

  await t.test('minutes include extracted action items', async () => {
    const res = await api('GET', `/groups/${groupId}/minutes/${minutesId}`, { token: owner.token });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.ok(Array.isArray(res.data.action_items), 'action_items should be an array');
    assert.ok(res.data.action_items.length >= 1, 'at least one action item should be extracted');

    const first = res.data.action_items[0];
    assert.ok(typeof first.id === 'string' && first.id, 'each item has an id');
    assert.ok(typeof first.task === 'string' && first.task, 'each item has a task');
    assert.equal(first.done, false, 'items start not done');
  });

  await t.test('toggling an action item persists (and requires membership)', async () => {
    const detail = await api('GET', `/groups/${groupId}/minutes/${minutesId}`, { token: memberA.token });
    const itemId = detail.data.action_items[0].id as string;

    // Non-member cannot toggle.
    const forbidden = await api('PATCH', `/groups/${groupId}/minutes/${minutesId}/action-items/${itemId}`, {
      token: outsider.token,
      body: { done: true },
    });
    assert.equal(forbidden.status, 403, `expected 403, got ${forbidden.status}`);

    // Member toggles it done.
    const toggled = await api('PATCH', `/groups/${groupId}/minutes/${minutesId}/action-items/${itemId}`, {
      token: memberA.token,
      body: { done: true },
    });
    assert.equal(toggled.status, 200, JSON.stringify(toggled.data));
    const updatedItem = toggled.data.actionItems.find((item: { id: string }) => item.id === itemId);
    assert.equal(updatedItem.done, true, 'item should now be done');

    // The change is persisted for the next reader.
    const reread = await api('GET', `/groups/${groupId}/minutes/${minutesId}`, { token: memberB.token });
    const persisted = reread.data.action_items.find((item: { id: string }) => item.id === itemId);
    assert.equal(persisted.done, true, 'toggle should persist across requests');

    // Invalid item id → 404.
    const missing = await api('PATCH', `/groups/${groupId}/minutes/${minutesId}/action-items/does-not-exist`, {
      token: memberA.token,
      body: { done: true },
    });
    assert.equal(missing.status, 404, `expected 404 for unknown item, got ${missing.status}`);
  });

  await t.test('Ask-AI answers a member, grounded in the minutes', async () => {
    const res = await api('POST', `/groups/${groupId}/minutes/${minutesId}/ask`, {
      token: memberA.token,
      body: { question: 'What did we decide about the release?' },
    });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.match(res.data.answer, /ship on Friday/, 'answer should come from the (stubbed) minutes QA');
  });

  await t.test('Ask-AI rejects an empty question (400) and a non-member (403)', async () => {
    const empty = await api('POST', `/groups/${groupId}/minutes/${minutesId}/ask`, {
      token: memberA.token,
      body: { question: '   ' },
    });
    assert.equal(empty.status, 400, `expected 400, got ${empty.status}`);

    const forbidden = await api('POST', `/groups/${groupId}/minutes/${minutesId}/ask`, {
      token: outsider.token,
      body: { question: 'What did we decide?' },
    });
    assert.equal(forbidden.status, 403, `expected 403, got ${forbidden.status}`);
  });

  await t.test('a non-member cannot read the minutes (403)', async () => {
    const res = await api('GET', `/groups/${groupId}/minutes`, { token: outsider.token });
    assert.equal(res.status, 403, `expected 403 for non-member, got ${res.status}`);
  });

  await t.test('back-compat: a single bare audio upload (no manifest) still produces minutes', async () => {
    const start = await api('POST', `/groups/${groupId}/meetings`, { token: owner.token });
    assert.equal(start.status, 201, JSON.stringify(start.data));
    const secondRoomCode = start.data.room.room_code;

    const res = await uploadMeetingTracks(owner.token, secondRoomCode);
    assert.equal(res.status, 202, JSON.stringify(res.data));

    const minutes = await waitForMinutes(owner.token, 2);
    const newest = minutes[0];
    assert.notEqual(newest.id, minutesId, 'a second minutes row should exist');
    assert.equal(newest.participant_count, 1, 'single track counts one speaker');

    const detail = await api('GET', `/groups/${groupId}/minutes/${newest.id}`, { token: owner.token });
    assert.equal(detail.status, 200);
    assert.match(detail.data.raw_transcript, /Test Owner: Welcome everyone/, 'host is the labeled speaker');
  });

  await t.test('RAG: cross-meeting Ask answers with citations to this group\'s meetings', async () => {
    // Both meetings were embedded by the worker during ingestion, so retrieval
    // has chunks to find. (AI_STUB uses deterministic vectors + a stub answer.)
    const res = await api('POST', `/groups/${groupId}/ask`, {
      token: memberA.token,
      body: { question: 'What did we decide about the release across our meetings?' },
    });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.match(res.data.answer, /ship on Friday/, 'answer should come from the (stubbed) group QA');
    assert.ok(Array.isArray(res.data.sources) && res.data.sources.length > 0, 'should cite at least one source');

    // Every cited source must be a real meeting in THIS group.
    const list = await api('GET', `/groups/${groupId}/minutes`, { token: owner.token });
    const groupMinuteIds = new Set(list.data.map((minute: { id: string }) => minute.id));
    for (const source of res.data.sources) {
      assert.ok(typeof source.minutesId === 'string' && source.minutesId, 'source has a minutesId');
      assert.ok(typeof source.title === 'string' && source.title, 'source has a title');
      assert.ok(groupMinuteIds.has(source.minutesId), `cited source ${source.minutesId} belongs to this group`);
    }
  });

  await t.test('RAG: retrieval is tenant-isolated — another group sees none of these chunks', async () => {
    // The outsider spins up their OWN group with no meetings. If the retrieval
    // query were missing its `WHERE group_id = ...` filter, this group's Ask
    // would surface the first group's chunks. It must return zero sources.
    const create = await api('POST', '/groups', {
      token: outsider.token,
      body: { name: `Second Group ${suffix}`, description: 'isolation test' },
    });
    assert.equal(create.status, 201, JSON.stringify(create.data));
    secondGroupId = create.data.id;

    const res = await api('POST', `/groups/${secondGroupId}/ask`, {
      token: outsider.token,
      body: { question: 'What did we decide about the release across our meetings?' },
    });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.deepEqual(res.data.sources, [], 'an empty group must retrieve none of another group\'s chunks');
  });

  await t.test('RAG: cross-meeting Ask rejects an empty question (400) and a non-member (403)', async () => {
    const empty = await api('POST', `/groups/${groupId}/ask`, {
      token: memberA.token,
      body: { question: '   ' },
    });
    assert.equal(empty.status, 400, `expected 400, got ${empty.status}`);

    const forbidden = await api('POST', `/groups/${groupId}/ask`, {
      token: outsider.token,
      body: { question: 'What did we decide?' },
    });
    assert.equal(forbidden.status, 403, `expected 403, got ${forbidden.status}`);
  });

  await t.test('normal (non-group) meeting: opt-in generates minutes with a null group', async () => {
    const create = await api('POST', '/rooms/create', {
      token: owner.token,
      body: { summarizerEnabled: true, name: 'Solo standup' },
    });
    assert.equal(create.status, 200, JSON.stringify(create.data));
    standaloneRoomCode = create.data.room.roomCode;
    assert.ok(standaloneRoomCode, 'standalone room should have a code');
    assert.equal(create.data.room.summarizerEnabled, true, 'opt-in flag should persist');

    const end = await uploadMeetingTracks(owner.token, standaloneRoomCode);
    assert.equal(end.status, 202, JSON.stringify(end.data));

    // Poll the new room-scoped route until the worker finishes the job.
    let detail: any = null;
    const startedAt = Date.now();
    while (Date.now() - startedAt < 15_000) {
      const res = await api('GET', `/rooms/${standaloneRoomCode}/minutes`, { token: owner.token });
      if (res.status === 200) { detail = res.data; break; }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(detail, 'minutes should be generated for the standalone meeting');
    assert.equal(detail.group_id, null, 'standalone minutes have no group');
    assert.match(detail.raw_transcript, /Test Owner: Welcome everyone/, 'host speech is transcribed');
    assert.equal(detail.participant_count, 1, 'single bare track counts one speaker');
  });

  await t.test('normal meeting minutes are host-scoped + Ask-AI works; opt-out is refused', async () => {
    // A user with no relationship to the room can't read it.
    const forbidden = await api('GET', `/rooms/${standaloneRoomCode}/minutes`, { token: outsider.token });
    assert.equal(forbidden.status, 403, `expected 403, got ${forbidden.status}`);

    // Single-meeting Ask-AI works without any group.
    const ask = await api('POST', `/rooms/${standaloneRoomCode}/minutes/ask`, {
      token: owner.token,
      body: { question: 'What did we decide?' },
    });
    assert.equal(ask.status, 200, JSON.stringify(ask.data));
    assert.match(ask.data.answer, /ship on Friday/, 'answer from the stubbed QA');

    // A normal meeting that did NOT opt in cannot generate a summary.
    const plain = await api('POST', '/rooms/create', { token: owner.token, body: {} });
    const plainCode = plain.data.room.roomCode;
    const refused = await uploadMeetingTracks(owner.token, plainCode);
    assert.equal(refused.status, 400, 'summaries must be opted in');
    await db.room.deleteMany({ where: { roomCode: plainCode } });
  });
});
