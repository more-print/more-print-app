// Edge Function: b2-upload — ตัวกลางออก "ตั๋วอัปโหลดไฟล์ใหญ่" ขึ้นคลัง Backblaze B2
// วางในหน้า Edge Functions ของ Supabase (สร้างฟังก์ชันชื่อ b2-upload, ปิด Verify JWT)
// ต้องตั้ง Secrets 4 ตัว: B2_KEY_ID, B2_APP_KEY, B2_BUCKET_ID, B2_BUCKET_NAME
// เรียกครั้งแรกด้วย ?action=setup-cors หนึ่งครั้ง เพื่อเปิดทางให้เบราว์เซอร์อัปโหลดตรงได้

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'upload-url';
    const keyId = Deno.env.get('B2_KEY_ID') || '';
    const appKey = Deno.env.get('B2_APP_KEY') || '';
    const bucketId = Deno.env.get('B2_BUCKET_ID') || '';
    const bucketName = Deno.env.get('B2_BUCKET_NAME') || '';
    if (!keyId || !appKey || !bucketId || !bucketName) {
      return new Response(JSON.stringify({ error: 'missing-secrets' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // ยืนยันตัวกับ B2
    const authRes = await fetch('https://api.backblazeb2.com/b2api/v3/b2_authorize_account', {
      headers: { Authorization: 'Basic ' + btoa(keyId + ':' + appKey) },
    });
    const auth = await authRes.json();
    const storage = (auth.apiInfo && auth.apiInfo.storageApi) || auth;
    const apiUrl = storage.apiUrl;
    const downloadUrl = storage.downloadUrl;
    if (!apiUrl) return new Response(JSON.stringify({ error: 'auth-failed', detail: auth }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });

    if (action === 'setup-cors') {
      // ตั้งกติกา CORS ของถังครั้งเดียว: อนุญาตให้หน้าเว็บอัปโหลด/ดาวน์โหลดตรง
      const r = await fetch(apiUrl + '/b2api/v3/b2_update_bucket', {
        method: 'POST',
        headers: { Authorization: auth.authorizationToken },
        body: JSON.stringify({
          accountId: auth.accountId,
          bucketId,
          corsRules: [{
            corsRuleName: 'moreprint',
            allowedOrigins: ['*'],
            allowedOperations: ['b2_upload_file', 'b2_download_file_by_name', 'b2_upload_part'],
            allowedHeaders: ['*'],
            exposeHeaders: ['x-bz-content-sha1'],
            maxAgeSeconds: 3600,
          }],
        }),
      });
      const j = await r.json();
      return new Response(JSON.stringify({ ok: !j.code, detail: j }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // ออกตั๋วอัปโหลด (ค่าเริ่มต้น)
    const upRes = await fetch(apiUrl + '/b2api/v3/b2_get_upload_url', {
      method: 'POST',
      headers: { Authorization: auth.authorizationToken },
      body: JSON.stringify({ bucketId }),
    });
    const up = await upRes.json();
    if (!up.uploadUrl) return new Response(JSON.stringify({ error: 'upload-url-failed', detail: up }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({
      uploadUrl: up.uploadUrl,
      token: up.authorizationToken,
      downloadBase: downloadUrl + '/file/' + bucketName + '/',
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
