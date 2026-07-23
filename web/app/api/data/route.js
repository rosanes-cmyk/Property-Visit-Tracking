import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions';
import { fetchData } from '@/lib/appsScript';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return Response.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  try {
    return Response.json(await fetchData());
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
