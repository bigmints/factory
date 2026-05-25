/**
 * Debug endpoint — tests isDependencyCompleted directly inside the Next.js process.
 */
import { NextResponse } from 'next/server';
import { isDependencyCompleted } from '@engine/queue';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get('slug') || 'login-screen';

  const result = isDependencyCompleted(slug);

  return NextResponse.json({ slug, completed: result, timestamp: new Date().toISOString() });
}
