import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  const origin = Deno.env.get("APP_ORIGIN");
  const headers = {
    "Access-Control-Allow-Origin": origin ?? "",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "DELETE, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json"
  };
  if (!origin) return new Response('{"error":"Deployment origin is not configured"}', { status: 503, headers });
  if (req.headers.get("Origin") !== origin)
    return new Response('{"error":"Origin denied"}', { status: 403, headers });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "DELETE") return new Response('{"error":"Method denied"}', { status: 405, headers });

  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return new Response('{"error":"Unauthorized"}', { status: 401, headers });
  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  // getUser verifies the token with Auth. Never trust a decoded, unverified JWT.
  const { data: { user }, error } = await client.auth.getUser(token);
  if (error || !user) return new Response('{"error":"Unauthorized"}', { status: 401, headers });
  const result = await client.auth.admin.deleteUser(user.id);
  if (result.error) return new Response('{"error":"Deletion failed; retry later"}', { status: 500, headers });
  return new Response('{"deleted":true}', { status: 200, headers });
});
