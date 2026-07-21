import { NextRequest, NextResponse } from 'next/server'
import { adminClient as admin, getAuthedUser, canAccess } from '../../lib/supabase-server'

const BUCKET = 'trade-screenshots'
const MAX_IMAGE_BYTES = 4 * 1024 * 1024 // 4MB — limite payload Vercel

// POST — carica uno screenshot e lo aggancia a un trade.
// Due flussi:
//  - via apiKey (AlphaDesk Screenshot utility): aggancia all'ultimo trade dell'utente/conto
//  - via sessione browser + tradeId (upload manuale da import CSV): aggancia al trade specificato
export async function POST(req: NextRequest) {
  try {
    return await handlePost(req)
  } catch (e: any) {
    console.error('screenshot POST error:', e)
    return NextResponse.json({ error: `internal: ${e?.message || String(e)}` }, { status: 500 })
  }
}

async function handlePost(req: NextRequest) {
  let body: any = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON non valido' }, { status: 400 })
  }

  const { apiKey, account, slot, imageBase64, tradeId } = body

  const slotNum = Number(slot)
  if (slotNum !== 1 && slotNum !== 2) {
    return NextResponse.json({ error: 'slot deve essere 1 o 2' }, { status: 400 })
  }
  if (!imageBase64) {
    return NextResponse.json({ error: 'imageBase64 è obbligatorio' }, { status: 400 })
  }

  const sb = admin()
  let userId: string
  let trade: { id: string; instrument: string; account: string; entry_time: string; screenshot_1_url?: string | null; screenshot_2_url?: string | null }

  if (tradeId) {
    const authedUser = await getAuthedUser(req)
    if (!authedUser) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })

    const { data: targetTrade } = await sb
      .from('trades')
      .select('id, user_id, instrument, account, entry_time, exit_time, screenshot_1_url, screenshot_2_url')
      .eq('id', tradeId)
      .single()

    if (!targetTrade) {
      return NextResponse.json({ error: 'Trade non trovato' }, { status: 404 })
    }
    if (!canAccess(authedUser, (targetTrade as any).user_id)) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    }

    userId = (targetTrade as any).user_id
    trade = targetTrade
  } else {
    if (!apiKey) {
      return NextResponse.json({ error: 'apiKey e imageBase64 sono obbligatori' }, { status: 400 })
    }

    const { data: keyData } = await sb
      .from('api_keys')
      .select('user_id')
      .eq('key', apiKey)
      .single()

    if (!keyData) {
      return NextResponse.json({ error: 'API key non valida' }, { status: 401 })
    }
    userId = keyData.user_id

    let tradeQuery = sb
      .from('trades')
      .select('id, instrument, account, entry_time, exit_time, screenshot_1_url, screenshot_2_url')
      .eq('user_id', userId)
    if (account) tradeQuery = tradeQuery.eq('account', account)

    const { data: lastTrade } = await tradeQuery
      .order('exit_time', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!lastTrade) {
      return NextResponse.json({ error: 'Nessun trade trovato a cui agganciare lo screenshot' }, { status: 404 })
    }
    trade = lastTrade
  }

  let buffer: Buffer
  try {
    buffer = Buffer.from(imageBase64, 'base64')
  } catch {
    return NextResponse.json({ error: 'imageBase64 non valido' }, { status: 400 })
  }
  if (!buffer.length) {
    return NextResponse.json({ error: 'imageBase64 non valido' }, { status: 400 })
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: 'immagine troppo grande (max 4MB)' }, { status: 400 })
  }

  const columnName = slotNum === 1 ? 'screenshot_1_url' : 'screenshot_2_url'
  const oldPath: string | null = (trade as any)[columnName]

  const path = `${userId}/${trade.id}_slot${slotNum}_${Date.now()}.jpg`
  const { error: uploadError } = await sb.storage.from(BUCKET).upload(path, buffer, {
    contentType: 'image/jpeg',
    upsert: true,
  })
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 400 })
  }

  const { error: updateError } = await sb.from('trades').update({ [columnName]: path }).eq('id', trade.id)
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 })
  }

  if (oldPath) {
    await sb.storage.from(BUCKET).remove([oldPath])
  }

  return NextResponse.json({
    success: true,
    trade: { instrument: trade.instrument, account: trade.account, entry_time: trade.entry_time },
    slot: slotNum,
    screenshotPath: path,
  })
}

// GET — genera un URL firmato temporaneo per visualizzare uno screenshot (autenticazione utente)
export async function GET(req: NextRequest) {
  try {
    return await handleGet(req)
  } catch (e: any) {
    console.error('screenshot GET error:', e)
    return NextResponse.json({ error: `internal: ${e?.message || String(e)}` }, { status: 500 })
  }
}

async function handleGet(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const path = searchParams.get('path')
  if (!path) return NextResponse.json({ error: 'path richiesto' }, { status: 400 })

  const authedUser = await getAuthedUser(req)
  const ownerId = path.split('/')[0]
  if (!canAccess(authedUser, ownerId)) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const sb = admin()
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600)
  if (error || !data) {
    return NextResponse.json({ error: error?.message || 'Impossibile generare URL' }, { status: 400 })
  }

  return NextResponse.json({ url: data.signedUrl })
}

// DELETE — rimuove uno screenshot (autenticazione utente)
export async function DELETE(req: NextRequest) {
  try {
    return await handleDelete(req)
  } catch (e: any) {
    console.error('screenshot DELETE error:', e)
    return NextResponse.json({ error: `internal: ${e?.message || String(e)}` }, { status: 500 })
  }
}

async function handleDelete(req: NextRequest) {
  let body: any = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON non valido' }, { status: 400 })
  }

  const { tradeId, slot } = body
  const slotNum = Number(slot)
  if (!tradeId || (slotNum !== 1 && slotNum !== 2)) {
    return NextResponse.json({ error: 'tradeId e slot (1 o 2) sono obbligatori' }, { status: 400 })
  }

  const authedUser = await getAuthedUser(req)
  if (!authedUser) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })

  const sb = admin()
  const columnName = slotNum === 1 ? 'screenshot_1_url' : 'screenshot_2_url'
  const { data: trade } = await sb
    .from('trades')
    .select(`id, user_id, ${columnName}`)
    .eq('id', tradeId)
    .single()

  if (!trade) return NextResponse.json({ error: 'Trade non trovato' }, { status: 404 })
  if (!canAccess(authedUser, (trade as any).user_id)) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const path: string | null = (trade as any)[columnName]
  if (path) {
    await sb.storage.from(BUCKET).remove([path])
  }

  const { error } = await sb.from('trades').update({ [columnName]: null }).eq('id', tradeId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ success: true })
}
