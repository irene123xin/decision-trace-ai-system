import { createClient } from "@supabase/supabase-js";

const primarySecret = process.env.SUPABASE_SECRET_KEY?.trim();
const legacySecret = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const required = [
  ["NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL],
  ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY],
  ["SUPABASE_SECRET_KEY", primarySecret ?? legacySecret],
];
const missing = required.filter(([, value]) => !value?.trim()).map(([name]) => name);

if (missing.length > 0) {
  console.log(JSON.stringify({ status: "error", category: "configuration_missing", missing }));
  process.exitCode = 1;
} else {
  let lastHttpStatus = null;
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    primarySecret ?? legacySecret,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: async (input, init) => {
          const response = await fetch(input, init);
          lastHttpStatus = response.status;
          return response;
        },
      },
    },
  );

  try {
    const healthResponse = await fetch(new URL("/rest/v1/", process.env.NEXT_PUBLIC_SUPABASE_URL), {
      headers: {
        apikey: primarySecret ?? legacySecret,
        Authorization: `Bearer ${primarySecret ?? legacySecret}`,
      },
    });
    if (!healthResponse.ok) {
      await healthResponse.body?.cancel();
      const category = healthResponse.status === 401 || healthResponse.status === 403
        ? "access_error"
        : healthResponse.status === 404
          ? "configuration_error"
          : healthResponse.status >= 500
            ? "provider_unavailable"
            : "connection_rejected";
      console.log(JSON.stringify({ status: "error", category }));
      process.exitCode = 1;
      process.exit();
    }
    const apiDescription = await healthResponse.json().catch(() => null);
    const assignmentFunctionReady = Boolean(
      apiDescription
      && typeof apiDescription === "object"
      && "paths" in apiDescription
      && apiDescription.paths
      && typeof apiDescription.paths === "object"
      && "/rpc/create_study_session_with_assignment" in apiDescription.paths,
    );

    const { error } = await client
      .from("study_sessions")
      .select("id", { count: "exact", head: true });

    if (!error) {
      const { error: assignmentError } = await client
        .from("condition_assignment_blocks")
        .select("study_status,block_number,allocation_order,allocated_count", { count: "exact", head: true });
      if (assignmentError) {
        console.log(JSON.stringify({ status: "error", category: "assignment_migration_missing" }));
        process.exitCode = 1;
        process.exit();
      }
      if (!assignmentFunctionReady) {
        console.log(JSON.stringify({ status: "error", category: "assignment_function_missing" }));
        process.exitCode = 1;
        process.exit();
      }
      const { data: bucket, error: bucketError } = await client.storage.getBucket("generated-images");
      if (bucketError || !bucket) {
        console.log(JSON.stringify({ status: "error", category: "storage_bucket_missing" }));
        process.exitCode = 1;
      } else if (bucket.public) {
        console.log(JSON.stringify({ status: "error", category: "storage_bucket_not_private" }));
        process.exitCode = 1;
      } else {
        console.log(JSON.stringify({ status: "ready", category: "read_succeeded", storage: "private_bucket_ready" }));
      }
    } else {
      const schemaMissing = lastHttpStatus === 404 || error.code === "42P01" || error.code === "PGRST204" || error.code === "PGRST205";
      const accessError = lastHttpStatus === 401 || lastHttpStatus === 403 || error.code === "42501" || error.code === "PGRST301";
      // after a successful authenticated health read, an unrecognised table error indicates missing Phase 1 schema
      const category = schemaMissing ? "schema_missing" : accessError ? "access_error" : "schema_missing";
      console.log(JSON.stringify({
        status: "error",
        category,
      }));
      process.exitCode = 1;
    }
  } catch {
    console.log(JSON.stringify({ status: "error", category: "network_error" }));
    process.exitCode = 1;
  }
}
