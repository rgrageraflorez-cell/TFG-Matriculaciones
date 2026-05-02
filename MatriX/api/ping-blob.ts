import { head } from '@vercel/blob';

export default async function handler(req: Request): Promise<Response> {
  console.log('[ping-blob] inicio', Date.now());

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const secret = process.env.SUBSCRIBERS_SECRET;
  const blobBase = process.env.BLOB_BASE_URL;

  console.log('[ping-blob] vars', {
    hasToken: !!token,
    hasSecret: !!secret,
    hasBlobBase: !!blobBase,
  });

  try {
    console.log('[ping-blob] antes head');
    const result = await Promise.race([
      head('test-ping.json'),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout manual 5s')), 5000)
      )
    ]);
    console.log('[ping-blob] head OK', result);
    return new Response(
      JSON.stringify({ ok: true, result }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.log('[ping-blob] error', String(err));
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
