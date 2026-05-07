import { NextRequest, NextResponse } from 'next/server'
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ message: 'Cron sync daily — in arrivo nella prossima fase', timestamp: new Date().toISOString() })
}
