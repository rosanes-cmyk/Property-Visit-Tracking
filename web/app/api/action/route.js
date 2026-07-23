import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions';
import { postAction } from '@/lib/appsScript';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session) return Response.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  let body = {};
  try { body = await req.json(); } catch (e) { return Response.json({ ok: false, error: 'bad JSON' }, { status: 400 }); }
  if (!body.action) return Response.json({ ok: false, error: 'action required' }, { status: 400 });
  try {
    return Response.json(await postAction(body.action, body.id, body.params));
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
