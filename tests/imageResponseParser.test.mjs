import test from "node:test";
import assert from "node:assert/strict";
import {
  assertDistinctImageResults,
  classifyProviderException,
  ImageDiagnosticError,
  parseGeminiImageResponse,
  resolveVariantResults,
} from "../services/server/imageResponseParser.ts";

const responseWithImage = (data, mimeType = "image/png") => ({
  candidates: [{ content: { parts: [{ inlineData: { mimeType, data } }] } }],
});

test("accepts two valid, distinct inline images", async () => {
  const settled = await Promise.allSettled([
    Promise.resolve(parseGeminiImageResponse(responseWithImage("aGVsbG8="), 1)),
    Promise.resolve(parseGeminiImageResponse(responseWithImage("d29ybGQ="), 2)),
  ]);
  const images = resolveVariantResults(settled);
  assert.doesNotThrow(() => assertDistinctImageResults(images));
  assert.deepEqual(images.map((image) => image.imageIndex), [1, 2]);
});

test("distinguishes a response with no image part", () => {
  assert.throws(
    () => parseGeminiImageResponse({ candidates: [{ content: { parts: [{}] } }] }, 1),
    (error) => error instanceof ImageDiagnosticError && error.diagnosticCode === "NO_IMAGE_PART_RETURNED" && error.responseDiagnostic?.candidateCount === 1,
  );
});

test("rejects the logical request when only one variant succeeds", async () => {
  const settled = await Promise.allSettled([
    Promise.resolve(parseGeminiImageResponse(responseWithImage("aGVsbG8="), 1)),
    Promise.reject(new Error("variant failed")),
  ]);
  assert.throws(
    () => resolveVariantResults(settled),
    (error) => error instanceof ImageDiagnosticError && error.diagnosticCode === "ONE_VARIANT_FAILED",
  );
});

test("rejects duplicate image results", () => {
  const first = parseGeminiImageResponse(responseWithImage("aGVsbG8="), 1);
  const second = parseGeminiImageResponse(responseWithImage("aGVsbG8="), 2);
  assert.throws(
    () => assertDistinctImageResults([first, second]),
    (error) => error instanceof ImageDiagnosticError && error.diagnosticCode === "DUPLICATE_IMAGE_RESULTS",
  );
});

test("rejects malformed inline image data", () => {
  assert.throws(
    () => parseGeminiImageResponse(responseWithImage("not-valid-base64"), 1),
    (error) => error instanceof ImageDiagnosticError && error.diagnosticCode === "INVALID_INLINE_IMAGE_DATA" && error.responseDiagnostic?.inlineDataPresent === true,
  );
});

test("classifies an SDK exception without exposing provider details", () => {
  const error = classifyProviderException(new TypeError("provider transport failed"));
  assert.equal(error.diagnosticCode, "PROVIDER_SDK_ERROR");
  assert.equal(error.name, "ImageDiagnosticError");
});

test("classifies provider HTTP status separately", () => {
  const error = classifyProviderException({ status: 429, message: "rate limited" });
  assert.equal(error.diagnosticCode, "PROVIDER_HTTP_ERROR");
  assert.equal(error.providerStatus, 429);
});

test("classifies aborts as provider timeouts", () => {
  const error = classifyProviderException(new DOMException("The operation was aborted", "AbortError"));
  assert.equal(error.diagnosticCode, "PROVIDER_TIMEOUT");
});
