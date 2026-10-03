import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const generationRoute = read("app/api/images/generate/route.ts");
const retrievalRoute = read("app/api/images/[sessionId]/[imageId]/route.ts");
const storage = read("services/server/remoteImageStorage.ts");
const commit = read("services/server/remoteImageCommit.ts");
const repository = read("services/server/imageRepository.ts");
const placeholder = read("components/ImagePlaceholder.tsx");
const workspace = read("components/ParticipantWorkspace.tsx");
const payload = read("services/server/sessionPayload.ts");
const exporter = read("services/exportService.ts");
const migration = read("supabase/migrations/20260804120000_phase1_remote_storage_foundations.sql");
const diagnostic = read("scripts/checkSupabaseConnection.mjs");

test("a successful remote request uploads and inserts exactly one two-image pair", () => {
  assert.match(commit, /Promise\.allSettled\(binaries\.map/);
  assert.match(commit, /createGeneratedImageRecords\(inserts\)/);
  assert.match(repository, /insert\(inputs\.map\(buildGeneratedImageInsert\)\)/);
  assert.match(repository, /data\.length !== inputs\.length/);
  assert.match(commit, /images: \[GeneratedImage, GeneratedImage\]/);
});

test("remote images retain stable existing IDs and session-scoped private paths", () => {
  assert.match(commit, /nextStableImageIds/);
  assert.match(commit, /existingImageId: image\.id/);
  assert.match(storage, /`\$\{studySessionUuid\}\/\$\{safePathPart\(requestId\)\}\/\$\{safePathPart\(existingImageId\)\}\.\$\{extension\}`/);
  assert.match(storage, /GENERATED_IMAGES_BUCKET = "generated-images"/);
  assert.match(storage, /upsert: false/);
});

test("the bucket remains private without anonymous policies", () => {
  assert.match(migration, /'generated-images'[\s\S]*?false/i);
  assert.match(migration, /public\s*=\s*false/i);
  assert.doesNotMatch(migration, /create\s+policy[\s\S]*?storage\.objects/i);
  assert.match(diagnostic, /storage_bucket_not_private/);
});

test("participant retrieval is cookie-bound and researcher retrieval is separately authorised", () => {
  assert.match(retrievalRoute, /verifyParticipantSessionCookie/);
  assert.match(retrievalRoute, /participantSessionId !== sessionId && !researcherAuthorised/);
  assert.match(retrievalRoute, /isResearcherRequestAuthorised\(request\)/);
  assert.match(retrievalRoute, /findGeneratedImageForSession\(session\.id, imageId\)/);
  assert.match(retrievalRoute, /status: 404/);
});

test("private retrieval streams bytes without public or signed URLs", () => {
  assert.match(retrievalRoute, /downloadPrivateGeneratedImage/);
  assert.match(retrievalRoute, /Content-Type/);
  assert.match(retrievalRoute, /X-Content-Type-Options/);
  assert.doesNotMatch(`${retrievalRoute}\n${storage}`, /createSignedUrl|getPublicUrl/);
});

test("remote images display after refresh without IndexedDB and researcher views share the resolver", () => {
  assert.match(placeholder, /\/api\/images\/\$\{encodeURIComponent\(image\.sessionId\)\}\/\$\{encodeURIComponent\(image\.id\)\}/);
  assert.match(placeholder, /!remoteImageUrl && image\.storageReference/);
  assert.match(read("components/ResearcherView.tsx"), /<ImagePlaceholder image=\{image\}/);
  assert.match(read("components/FinalReviewSummary.tsx"), /<ImagePlaceholder image=\{logo\}/);
});

test("partial failures attempt Storage and row cleanup and never complete the request", () => {
  assert.match(commit, /uploadedPaths/);
  assert.match(commit, /bestEffortCleanup\(uploadedPaths, \[\]\)/);
  assert.match(commit, /bestEffortCleanup\(paths, records\.map/);
  assert.match(commit, /throw new RemoteImageCommitError/);
  assert.match(generationRoute, /error: error\.code, diagnosticCode: "REMOTE_IMAGE_STORAGE_ERROR"/);
});

test("same-request retries resume or return the canonical pair without duplication", () => {
  assert.match(generationRoute, /listGeneratedImagesForRequest\(row\.id, payload\.requestId\)/);
  assert.match(generationRoute, /storedRequest\?\.status === "succeeded" && storedImages\.length === 2/);
  assert.match(generationRoute, /resumeRemoteImageCommit/);
  assert.match(migration, /generated_images_session_existing_image_unique unique \(session_id, existing_image_id\)/);
});

test("central records and authoritative Session state enforce five requests and ten images", () => {
  assert.match(generationRoute, /listGeneratedImagesForSession\(row\.id\)/);
  assert.match(generationRoute, /new Set\(centralImages\.map/);
  assert.match(generationRoute, /REQUEST_LIMIT = 5/);
  assert.match(generationRoute, /IMAGE_LIMIT = 10/);
  assert.doesNotMatch(generationRoute, /const ledgers|new Map<string, SessionLedger>/);
  assert.doesNotMatch(generationRoute, /successfulRequestCount|generatedImageCount|sessionStatus/);
});

test("MIME, size and path validation happen before private upload", () => {
  for (const mime of ["image/png", "image/jpeg", "image/webp"]) assert.match(storage, new RegExp(mime.replace("/", "\\/")));
  assert.match(storage, /MAX_GENERATED_IMAGE_BYTES/);
  assert.match(storage, /bytes\.byteLength > MAX_GENERATED_IMAGE_BYTES/);
  assert.match(storage, /invalid_storage_path_part/);
  assert.match(retrievalRoute, /image\.storage_path\.includes\("\.\."\)/);
});

test("Session JSON uses safe central metadata and stale drafts cannot remove it", () => {
  for (const field of ["storageBackend: \"supabase\"", "storagePath:", "byteSize:", "checksum:"]) assert.match(commit, new RegExp(field));
  assert.match(payload, /stored\.storageBackend !== "supabase"/);
  for (const field of ["storageBackend", "storagePath", "byteSize", "checksum"]) assert.match(payload, new RegExp(`${field}: stored\.${field}`));
  assert.match(payload, /centrallySucceededRequestIds/);
});

test("exports retain safe image metadata and exclude transient access material", () => {
  for (const column of ["image_ids", "image_request_ids", "image_storage_backends", "image_storage_paths", "image_mime_types", "image_byte_sizes", "image_checksums", "image_created_times"]) assert.match(exporter, new RegExp(column));
  for (const blocked of ["signedurl", "signed_url", "publicurl", "public_url"]) assert.match(exporter, new RegExp(`"${blocked}"`));
  assert.doesNotMatch(exporter, /createSignedUrl|getPublicUrl/);
});

test("legacy IndexedDB remains available but remote generation no longer writes browser blobs", () => {
  const legacy = read("services/imageStorageAdapter.ts");
  assert.match(legacy, /indexedDB\.open/);
  assert.match(legacy, /readGeneratedImageBlob/);
  assert.match(placeholder, /readGeneratedImageBlob/);
  assert.doesNotMatch(workspace, /saveGeneratedImageBlobs|base64ToBlob/);
});

test("remote success is accepted as one authoritative revision envelope", () => {
  assert.match(workspace, /onRemoteCommit\?\.\(response\.remoteSession\)/);
  assert.match(workspace, /await onCriticalChange\(next\)/);
  assert.match(commit, /updateStudySessionWithRevision/);
  assert.match(commit, /for \(let attempt = 0; attempt < 2/);
});
