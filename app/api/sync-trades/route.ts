import { NextRequest, NextResponse } from 'next/server'
export async function POST(req: NextRequest) {
  const { broker } = await req.json()
  if (broker === 'ibkr') return NextResponse.json({ success: false, error: 'Configura Flex Token nelle impostazioni conto IBKR' })
  if (broker === 'rithmic') return NextResponse.json({ success: false, error: 'Rithmic R API: contatta AMP per abilitare R Protocol sul tuo account' })
  if (broker === 'tradovate') return NextResponse.json({ success: false, error: 'Tradovate: inserisci credenziali nella configurazione conto' })
  return NextResponse.json({ error: 'Broker non supportato' }, { status: 400 })
}
