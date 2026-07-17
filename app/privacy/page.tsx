'use client'

const S = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section style={{ marginBottom: 28 }}>
    <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-0)', marginBottom: 10 }}>{title}</h2>
    <div style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.8 }}>{children}</div>
  </section>
)

export default function PrivacyPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-0)', padding: '48px 24px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <div style={{ marginBottom: 32 }}>
          <a href="/" style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>← Torna ad AlphaDesk</a>
          <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 28, marginTop: 12, color: 'var(--text-0)' }}>Informativa sulla privacy</h1>
          <div style={{ fontSize: 12, color: 'var(--text-2)', fontFamily: "'DM Mono',monospace", marginTop: 6 }}>Ultimo aggiornamento: luglio 2026</div>
        </div>

        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 14, padding: '28px 26px' }}>
          <S title="Titolare del trattamento">
            AlphaDesk è una piattaforma privata di diario e analisi di trading, ad accesso riservato.
            Titolare del trattamento: <strong>Walter Ferrero</strong> — contatto: <strong>walter.ferrero.93@gmail.com</strong>.
            Per qualsiasi richiesta relativa ai tuoi dati puoi scrivere a questo indirizzo.
          </S>

          <S title="Quali dati trattiamo">
            <strong>Dati dell'account</strong>: indirizzo email, nome e ruolo, forniti al momento dell'invito. Gli account sono creati esclusivamente dall'amministratore: non esiste registrazione pubblica.<br /><br />
            <strong>Dati di trading</strong>: le operazioni che importi o sincronizzi (strumento, orari, prezzi, quantità, profitti/perdite, commissioni), i nomi o alias dei tuoi conti e le statistiche che ne derivano.<br /><br />
            <strong>Annotazioni facoltative</strong>: note sui trade, etichette sullo stato emotivo, valutazioni di disciplina e qualità del setup, nomi delle strategie. Sono inserite liberamente da te e restano visibili solo a te e all'amministratore della piattaforma.<br /><br />
            <strong>Screenshot</strong>: se scegli di caricare immagini dei grafici, vengono conservate e associate ai relativi trade.<br /><br />
            <strong>Chiavi API</strong>: se utilizzi il plugin AlphaDesk Bridge, viene generata una chiave che identifica il tuo account per l'invio automatico dei trade. La chiave dà accesso solo a questa piattaforma, non ai tuoi conti di trading.
          </S>

          <S title="Cosa NON trattiamo">
            Il sito non utilizza cookie di profilazione, sistemi di analytics o tracciamento di terze parti, né pubblicità. Non conserviamo le credenziali dei tuoi conti di trading o broker. L'unica memorizzazione nel browser (localStorage) serve alla sessione di accesso e alla cache dei tuoi dati sul tuo dispositivo.
          </S>

          <S title="Finalità e base giuridica">
            I dati sono trattati al solo scopo di fornirti il servizio di diario e analisi di trading che hai richiesto (esecuzione del servizio). Le annotazioni facoltative sono trattate in quanto le inserisci volontariamente per tuo uso. Nessun dato è usato per finalità di marketing né ceduto a terzi.
          </S>

          <S title="Dove sono conservati i dati">
            Database, autenticazione e file sono ospitati su <strong>Supabase</strong> (regione: Unione Europea, eu-west-1). L'applicazione è distribuita tramite <strong>Vercel</strong>. Se utilizzi la funzione facoltativa di analisi AI degli screenshot, l'immagine viene inviata alle API di <strong>Anthropic</strong> per la sola generazione dell'analisi. Questi fornitori trattano i dati come responsabili del trattamento secondo i propri termini di servizio.
          </S>

          <S title="Per quanto tempo">
            I dati sono conservati finché il tuo account è attivo. Alla cancellazione dell'account, i dati associati vengono eliminati. Puoi inoltre eliminare in autonomia i dati di un singolo conto di trading dalla sezione Eseguiti.
          </S>

          <S title="Sicurezza">
            L'accesso richiede autenticazione. Ogni richiesta ai server verifica l'identità di chi la effettua: ciascun utente può accedere esclusivamente ai propri dati. Le comunicazioni avvengono su connessione cifrata (HTTPS) e il database applica regole di isolamento per utente.
          </S>

          <S title="I tuoi diritti">
            Puoi chiedere in ogni momento l'accesso ai tuoi dati, la rettifica, la cancellazione, la limitazione del trattamento o la portabilità, scrivendo al contatto indicato sopra. Hai inoltre il diritto di proporre reclamo all'autorità di controllo (per l'Italia: Garante per la protezione dei dati personali).
          </S>

          <S title="Modifiche a questa informativa">
            Eventuali modifiche sostanziali saranno comunicate tramite la piattaforma. La data di ultimo aggiornamento è indicata in alto.
          </S>
        </div>

        <div style={{ textAlign: 'center', marginTop: 24, fontSize: 11, color: 'var(--text-2)', fontFamily: "'DM Mono',monospace" }}>© 2026 AlphaDesk — Accesso riservato</div>
      </div>
    </div>
  )
}
