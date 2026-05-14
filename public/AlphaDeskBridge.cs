// AlphaDesk Bridge v2.0 — NinjaTrader 8 Add-On
// Installazione:
//   1. Copia in: Documenti\NinjaTrader 8\bin\Custom\AddOns\
//   2. In NinjaTrader 8: NinjaScript Editor → F5 per compilare
//   3. Riavvia NinjaTrader 8
//   4. Vai in: menu Strumenti → AlphaDesk Bridge
//   5. Incolla URL e API Key da AlphaDesk → Eseguiti → Sync → NinjaTrader

#region Using declarations
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using NinjaTrader.Cbi;
using NinjaTrader.NinjaScript;
#endregion

namespace NinjaTrader.NinjaScript.AddOns
{
    public class AlphaDeskBridge : AddOnBase
    {
        // ── Configurazione ──────────────────────────────────────────────────
        private string apiEndpoint   = "";
        private string apiKey        = "";
        private bool   sendSimulated = true;
        private bool   debugMode     = false;
        private int    maxRetries    = 3;
        // Mappa nome conto NT8 → nome visualizzato in AlphaDesk
        // Esempio: "LFE05067595930005=LucidProp,Sim101=Demo"
        private Dictionary<string,string> accountAlias = new Dictionary<string,string>();

        // ── Stato ───────────────────────────────────────────────────────────
        private bool      isConfigured = false;
        private bool      isConnected  = false;
        private string    lastError    = "";
        private int       tradesSent   = 0;
        private int       tradesFailed = 0;
        private DateTime? lastTradeSent;

        // ── File ────────────────────────────────────────────────────────────
        private string configPath = "";
        private string logPath    = "";

        // ── Threading ───────────────────────────────────────────────────────
        private Queue<string>           failedQueue = new Queue<string>();
        private object                  lockObj     = new object();
        private System.Threading.Timer  retryTimer;

        // ── Tracciamento posizioni v2.0 (position-driven, FIFO signed qty) ─────
        private Dictionary<string, TradeAccumulator> accumulators
            = new Dictionary<string, TradeAccumulator>();
        private HashSet<string> sentTradeIds
            = new HashSet<string>();
        private object accLock = new object();

        // ── UI ──────────────────────────────────────────────────────────────
        private AlphaDeskWindow statusWindow;

        // ═══════════════════════════════════════════════════════════════════
        protected override void OnStateChange()
        {
            if (State == State.SetDefaults)
            {
                Description = "AlphaDesk Bridge — invia trade a AlphaDesk in tempo reale";
                Name        = "AlphaDeskBridge";
            }
            else if (State == State.Active)
            {
                string ntFolder = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
                    "NinjaTrader 8");
                configPath = Path.Combine(ntFolder, "AlphaDeskBridge.config.json");
                logPath    = Path.Combine(ntFolder, "AlphaDeskBridge.log");

                LoadConfig();

                // Delay 2s prima di Subscribe: NT8 deve finire di inizializzare gli account
                System.Threading.Timer startTimer = null;
                startTimer = new System.Threading.Timer(_ =>
                {
                    try
                    {
                        if (isConfigured) Subscribe();
                        Log("AlphaDesk Bridge v2.0 pronto. Endpoint: " +
                            (apiEndpoint.Length > 0 ? apiEndpoint : "NON CONFIGURATO"));
                    }
                    catch (Exception ex) { Log("Errore avvio: " + ex.Message); }
                    finally { startTimer?.Dispose(); }
                }, null, 2000, Timeout.Infinite);

                retryTimer = new System.Threading.Timer(RetryFailed, null,
                    TimeSpan.FromMinutes(5), TimeSpan.FromMinutes(5));

                Log("AlphaDesk Bridge v2.0 in caricamento...");
            }
            else if (State == State.Terminated)
            {
                retryTimer?.Dispose();
                Unsubscribe();
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        //  CONFIGURAZIONE
        // ═══════════════════════════════════════════════════════════════════
        private void LoadConfig()
        {
            if (!File.Exists(configPath))
            {
                WriteDefaultConfig();
                isConfigured = false;
                lastError    = "Config non trovata. Apri Strumenti → AlphaDesk Bridge in NT8.";
                return;
            }
            try
            {
                string json  = File.ReadAllText(configPath, Encoding.UTF8);
                apiEndpoint  = ExtractStr(json, "Endpoint");
                apiKey       = ExtractStr(json, "ApiKey");
                sendSimulated = ExtractBool(json, "SendSimulated", true);
                debugMode    = ExtractBool(json, "Debug", false);
                maxRetries   = ExtractInt(json, "MaxRetries", 3);

                isConfigured = !string.IsNullOrWhiteSpace(apiEndpoint)
                            && !string.IsNullOrWhiteSpace(apiKey)
                            && apiKey != "INCOLLA_LA_TUA_CHIAVE_API";
                lastError = isConfigured ? "" : "Endpoint o ApiKey mancanti";
                // Carica alias conti
                accountAlias.Clear();
                string aliasRaw = ExtractStr(json, "AccountAlias");
                foreach (string pair in aliasRaw.Split(','))
                {
                    var parts = pair.Trim().Split('=');
                    if (parts.Length == 2 && !string.IsNullOrEmpty(parts[0].Trim()))
                        accountAlias[parts[0].Trim()] = parts[1].Trim();
                }
            }
            catch (Exception ex) { isConfigured = false; lastError = ex.Message; }
        }

        private void SaveConfig()
        {
            try
            {
                var sb = new StringBuilder();
                sb.AppendLine("{");
                sb.AppendLine("  \"Endpoint\": \"" + apiEndpoint + "\",");
                sb.AppendLine("  \"ApiKey\": \"" + apiKey + "\",");
                sb.AppendLine("  \"SendSimulated\": " + sendSimulated.ToString().ToLower() + ",");
                sb.AppendLine("  \"Debug\": " + debugMode.ToString().ToLower() + ",");
                sb.AppendLine("  \"MaxRetries\": " + maxRetries);
                sb.AppendLine("}");
                File.WriteAllText(configPath, sb.ToString(), Encoding.UTF8);
            }
            catch (Exception ex) { Log("Errore salvataggio: " + ex.Message); }
        }

        private void WriteDefaultConfig()
        {
            try
            {
                File.WriteAllText(configPath,
                    "{\n" +
                    "  \"Endpoint\": \"https://alphadesk-ecru.vercel.app/api/ingest\",\n" +
                    "  \"ApiKey\": \"INCOLLA_LA_TUA_CHIAVE_API\",\n" +
                    "  \"SendSimulated\": true,\n" +
                    "  \"Debug\": false,\n" +
                    "  \"MaxRetries\": 3\n" +
                    "}\n",
                    Encoding.UTF8);
            }
            catch { }
        }

        // ═══════════════════════════════════════════════════════════════════
        //  SOTTOSCRIZIONE EVENTI — usa ExecutionUpdate (API corretta NT8)
        // ═══════════════════════════════════════════════════════════════════
        private void Subscribe()
        {
            try
            {
                // Usa Dispatcher per accedere ad Account.All in modo thread-safe
                if (Application.Current?.Dispatcher != null)
                {
                    Application.Current.Dispatcher.InvokeAsync(() =>
                    {
                        try
                        {
                            foreach (Account acc in Account.All)
                            {
                                acc.ExecutionUpdate += OnExecutionUpdate;
                                Log("Sottoscritto a: " + acc.Name);
                            }
                        }
                        catch (Exception ex) { Log("Errore Subscribe (dispatcher): " + ex.Message); }
                    });
                }
                else
                {
                    foreach (Account acc in Account.All)
                    {
                        acc.ExecutionUpdate += OnExecutionUpdate;
                        Log("Sottoscritto a: " + acc.Name);
                    }
                }
            }
            catch (Exception ex) { Log("Errore Subscribe: " + ex.Message); }
        }

        private void Unsubscribe()
        {
            try
            {
                if (Application.Current?.Dispatcher != null && !Application.Current.Dispatcher.CheckAccess())
                {
                    Application.Current.Dispatcher.Invoke(() =>
                    {
                        foreach (Account acc in Account.All)
                            try { acc.ExecutionUpdate -= OnExecutionUpdate; } catch { }
                    });
                }
                else
                {
                    foreach (Account acc in Account.All)
                        try { acc.ExecutionUpdate -= OnExecutionUpdate; } catch { }
                }
            }
            catch { }
        }

        // ═══════════════════════════════════════════════════════════════════
        //  GESTIONE ESECUZIONI → COSTRUZIONE TRADE
        // ═══════════════════════════════════════════════════════════════════
        private void OnExecutionUpdate(object sender, ExecutionEventArgs e)
        {
            try
            {
                if (!isConfigured) return;
                if (e.Execution == null) return;

                Account account = sender as Account;
                if (account == null) return;

                Execution exec = e.Execution;

                bool isSim = account.Connection != null &&
                             account.Connection.Options != null &&
                             account.Connection.Options.Mode == Mode.Simulation;
                if (!sendSimulated && isSim) return;

                string instrument    = exec.Instrument != null ? exec.Instrument.FullName : "N/A";
                string instrBase     = exec.Instrument != null ? exec.Instrument.MasterInstrument.Name : instrument;
                string displayName   = accountAlias.ContainsKey(account.Name) ? accountAlias[account.Name] : account.Name;
                double pointValue    = exec.Instrument != null ? exec.Instrument.MasterInstrument.PointValue : 1.0;
                double tickSize      = exec.Instrument != null ? exec.Instrument.MasterInstrument.TickSize : 0.25;

                if (debugMode)
                    Log("Execution: " + instrument + " " + exec.MarketPosition +
                        " qty=" + exec.Quantity + " price=" + exec.Price +
                        " comm=" + exec.Commission + " id=" + exec.ExecutionId);

                ProcessExecution(
                    account.Name, displayName, instrument, instrBase,
                    exec, isSim, pointValue, tickSize);
            }
            catch (Exception ex) { Log("Errore OnExecutionUpdate: " + ex.Message); }
        }

        // ═══════════════════════════════════════════════════════════════════
        //  PROCESS EXECUTION v2.0 — signed quantity, scale in/out, reverse
        // ═══════════════════════════════════════════════════════════════════
        private void ProcessExecution(
            string accountName, string displayName,
            string instrument, string instrBase,
            Execution exec, bool isSim,
            double pointValue, double tickSize)
        {
            string key = accountName + "|" + instrument;

            // Signed qty: Long=positivo, Short=negativo
            int signedQty = exec.MarketPosition == MarketPosition.Long
                ? exec.Quantity : -exec.Quantity;

            lock (accLock)
            {
                // ── Caso: nessun accumulator aperto → nuova posizione ─────────
                if (!accumulators.ContainsKey(key))
                {
                    var acc = new TradeAccumulator
                    {
                        TradeUid          = accountName + "|" + instrument + "|" +
                                            exec.Time.Ticks + "|" + Guid.NewGuid().ToString("N").Substring(0, 8),
                        Account           = accountName,
                        DisplayAccount    = displayName,
                        Instrument        = instrument,
                        InstrumentBase    = instrBase,
                        Direction         = exec.MarketPosition == MarketPosition.Long ? "Long" : "Short",
                        NetQuantity       = signedQty,
                        TotalEntryQuantity = exec.Quantity,
                        TotalExitQuantity = 0,
                        EntryValue        = exec.Price * exec.Quantity,
                        ExitValue         = 0,
                        EntryAveragePrice = exec.Price,
                        ExitAveragePrice  = 0,
                        TotalCommission   = Math.Abs(exec.Commission),
                        PointValue        = pointValue,
                        TickSize          = tickSize,
                        TickValue         = pointValue * tickSize,
                        IsSimulated       = isSim,
                        EntryTime         = exec.Time,
                        LastExecutionTime = exec.Time,
                        ExitTime          = DateTime.MinValue,
                    };
                    acc.Executions.Add(new ExecutionSnapshot
                    {
                        ExecutionId = exec.ExecutionId,
                        OrderId     = exec.Order != null ? exec.Order.OrderId : "",
                        Side        = acc.Direction,
                        Quantity    = exec.Quantity,
                        Price       = exec.Price,
                        Commission  = Math.Abs(exec.Commission),
                        Time        = exec.Time,
                    });
                    accumulators[key] = acc;
                    if (debugMode) Log("Accumulator creato: " + key + " dir=" + acc.Direction + " qty=" + signedQty);
                    return;
                }

                // ── Accumulator esistente ─────────────────────────────────────
                var cur = accumulators[key];
                int prevNet = cur.NetQuantity;
                int newNet  = prevNet + signedQty;

                cur.LastExecutionTime = exec.Time;
                cur.TotalCommission  += Math.Abs(exec.Commission);
                cur.Executions.Add(new ExecutionSnapshot
                {
                    ExecutionId = exec.ExecutionId,
                    OrderId     = exec.Order != null ? exec.Order.OrderId : "",
                    Side        = exec.MarketPosition == MarketPosition.Long ? "Long" : "Short",
                    Quantity    = exec.Quantity,
                    Price       = exec.Price,
                    Commission  = Math.Abs(exec.Commission),
                    Time        = exec.Time,
                });

                bool isSameDir = (prevNet > 0 && signedQty > 0) || (prevNet < 0 && signedQty < 0);

                if (isSameDir)
                {
                    // ── Scale In: aggiunge qty nella stessa direzione ─────────
                    cur.NetQuantity       = newNet;
                    cur.TotalEntryQuantity += exec.Quantity;
                    cur.EntryValue        += exec.Price * exec.Quantity;
                    cur.EntryAveragePrice  = cur.EntryValue / cur.TotalEntryQuantity;
                    if (debugMode) Log("Scale in: " + key + " netQty=" + newNet);
                }
                else if (newNet != 0 && Math.Abs(newNet) < Math.Abs(prevNet))
                {
                    // ── Scale Out / Partial exit ──────────────────────────────
                    cur.NetQuantity        = newNet;
                    cur.TotalExitQuantity += exec.Quantity;
                    cur.ExitValue         += exec.Price * exec.Quantity;
                    cur.ExitAveragePrice   = cur.ExitValue / cur.TotalExitQuantity;
                    cur.ExitTime           = exec.Time;
                    if (debugMode) Log("Scale out parziale: " + key + " netQty=" + newNet);
                }
                else if (newNet == 0)
                {
                    // ── Posizione FLAT: trade completato ──────────────────────
                    cur.NetQuantity        = 0;
                    cur.TotalExitQuantity += exec.Quantity;
                    cur.ExitValue         += exec.Price * exec.Quantity;
                    cur.ExitAveragePrice   = cur.ExitValue / cur.TotalExitQuantity;
                    cur.ExitTime           = exec.Time;

                    if (debugMode) Log("Posizione flat: " + key + " → finalizing trade");

                    var finalAcc = cur;
                    accumulators.Remove(key);

                    System.Threading.ThreadPool.QueueUserWorkItem(_ => FinalizeTrade(finalAcc));
                }
                else
                {
                    // ── Reverse position: split in due trade ──────────────────
                    // Parte 1: chiude la posizione corrente
                    int closingQty = Math.Abs(prevNet);
                    var closingAcc = new TradeAccumulator
                    {
                        TradeUid          = cur.TradeUid,
                        Account           = cur.Account,
                        DisplayAccount    = cur.DisplayAccount,
                        Instrument        = cur.Instrument,
                        InstrumentBase    = cur.InstrumentBase,
                        Direction         = cur.Direction,
                        NetQuantity       = 0,
                        TotalEntryQuantity = cur.TotalEntryQuantity,
                        TotalExitQuantity = closingQty,
                        EntryValue        = cur.EntryValue,
                        ExitValue         = exec.Price * closingQty,
                        EntryAveragePrice = cur.EntryAveragePrice,
                        ExitAveragePrice  = exec.Price,
                        TotalCommission   = cur.TotalCommission,
                        PointValue        = cur.PointValue,
                        TickSize          = cur.TickSize,
                        TickValue         = cur.TickValue,
                        IsSimulated       = cur.IsSimulated,
                        EntryTime         = cur.EntryTime,
                        ExitTime          = exec.Time,
                        LastExecutionTime = exec.Time,
                        Executions        = cur.Executions,
                    };

                    // Parte 2: apre nuova posizione nella direzione opposta
                    int newOpenQty = Math.Abs(newNet);
                    string newDir  = newNet > 0 ? "Long" : "Short";
                    var newAcc = new TradeAccumulator
                    {
                        TradeUid          = cur.Account + "|" + cur.Instrument + "|" +
                                            exec.Time.Ticks + "|" + Guid.NewGuid().ToString("N").Substring(0, 8),
                        Account           = cur.Account,
                        DisplayAccount    = cur.DisplayAccount,
                        Instrument        = cur.Instrument,
                        InstrumentBase    = cur.InstrumentBase,
                        Direction         = newDir,
                        NetQuantity       = newNet,
                        TotalEntryQuantity = newOpenQty,
                        TotalExitQuantity = 0,
                        EntryValue        = exec.Price * newOpenQty,
                        ExitValue         = 0,
                        EntryAveragePrice = exec.Price,
                        ExitAveragePrice  = 0,
                        TotalCommission   = 0,
                        PointValue        = cur.PointValue,
                        TickSize          = cur.TickSize,
                        TickValue         = cur.TickValue,
                        IsSimulated       = cur.IsSimulated,
                        EntryTime         = exec.Time,
                        LastExecutionTime = exec.Time,
                    };
                    newAcc.Executions.Add(new ExecutionSnapshot
                    {
                        ExecutionId = exec.ExecutionId,
                        Side        = newDir,
                        Quantity    = newOpenQty,
                        Price       = exec.Price,
                        Commission  = 0,
                        Time        = exec.Time,
                    });

                    accumulators[key] = newAcc;
                    if (debugMode) Log("Reverse: chiudo " + closingAcc.Direction + " apro " + newDir);
                    System.Threading.ThreadPool.QueueUserWorkItem(_ => FinalizeTrade(closingAcc));
                }
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        //  FINALIZE TRADE
        // ═══════════════════════════════════════════════════════════════════
        private void FinalizeTrade(TradeAccumulator acc)
        {
            try
            {
                // Deduplicazione
                lock (accLock)
                {
                    if (sentTradeIds.Contains(acc.TradeUid))
                    {
                        if (debugMode) Log("Deduplicato: " + acc.TradeUid);
                        return;
                    }
                    sentTradeIds.Add(acc.TradeUid);
                }

                double profitPoints = acc.Direction == "Long"
                    ? acc.ExitAveragePrice - acc.EntryAveragePrice
                    : acc.EntryAveragePrice - acc.ExitAveragePrice;

                int exitQty = acc.TotalExitQuantity > 0 ? acc.TotalExitQuantity : acc.TotalEntryQuantity;
                double profitGross  = profitPoints * acc.PointValue * exitQty;
                double profitNet    = profitGross - acc.TotalCommission;
                double profitTicks  = acc.TickSize > 0 ? profitPoints / acc.TickSize : 0;
                int    durationMin  = acc.ExitTime > acc.EntryTime
                    ? (int)(acc.ExitTime - acc.EntryTime).TotalMinutes : 0;

                string json = BuildTradeJson(acc, profitGross, profitNet, profitPoints, profitTicks, durationMin);
                if (debugMode) Log("Trade finalizzato: " + acc.Direction + " " + acc.Instrument +
                    " netPnl=" + Math.Round(profitNet, 2) + " comm=" + Math.Round(acc.TotalCommission, 2));

                SendToAlphaDesk(json);
            }
            catch (Exception ex) { Log("Errore FinalizeTrade: " + ex.Message); }
        }

        private string BuildTradeJson(
            TradeAccumulator acc,
            double profitGross, double profitNet,
            double profitPoints, double profitTicks, int durationMin)
        {
            var sb = new StringBuilder();
            sb.Append("{");
            S(sb, "trade_uid",        acc.TradeUid);
            S(sb, "source",           "AlphaDeskBridge");
            S(sb, "account",          acc.DisplayAccount);
            S(sb, "instrument",       acc.Instrument);
            S(sb, "instrument_base",  acc.InstrumentBase);
            S(sb, "direction",        acc.Direction);
            B(sb, "is_simulated",     acc.IsSimulated);
            N(sb, "entry_avg_price",  Math.Round(acc.EntryAveragePrice, 4));
            N(sb, "exit_avg_price",   Math.Round(acc.ExitAveragePrice, 4));
            N(sb, "entry_quantity",   acc.TotalEntryQuantity);
            N(sb, "exit_quantity",    acc.TotalExitQuantity > 0 ? acc.TotalExitQuantity : acc.TotalEntryQuantity);
            S(sb, "entry_time",       acc.EntryTime.ToString("yyyy-MM-ddTHH:mm:ss"));
            S(sb, "exit_time",        acc.ExitTime.ToString("yyyy-MM-ddTHH:mm:ss"));
            N(sb, "duration_min",     durationMin);
            N(sb, "gross_pnl",        Math.Round(profitGross, 2));
            N(sb, "net_pnl",          Math.Round(profitNet, 2));
            N(sb, "profit_ticks",     Math.Round(profitTicks, 2));
            N(sb, "profit_points",    Math.Round(profitPoints, 4));
            N(sb, "commission_total", Math.Round(acc.TotalCommission, 4));
            N(sb, "point_value",      acc.PointValue);
            N(sb, "tick_size",        acc.TickSize);
            N(sb, "tick_value",       Math.Round(acc.TickValue, 4));
            N(sb, "executions_count", acc.Executions.Count);
            string result = sb.ToString().TrimEnd(',') + "}";
            if (debugMode) Log("JSON: " + result);
            return result;
        }

        // Helper JSON
        private void S(StringBuilder sb, string k, string v)
            => sb.Append("\"" + k + "\":\"" + (v ?? "").Replace("\\","\\\\").Replace("\"","\\\"") + "\",");
        private void N(StringBuilder sb, string k, double v)
            => sb.Append("\"" + k + "\":" + v.ToString("G", System.Globalization.CultureInfo.InvariantCulture) + ",");
        private void B(StringBuilder sb, string k, bool v)
            => sb.Append("\"" + k + "\":" + (v ? "true" : "false") + ",");

        // ═══════════════════════════════════════════════════════════════════
        //  INVIO HTTP
        // ═══════════════════════════════════════════════════════════════════
        private void SendToAlphaDesk(string json)
        {
            for (int attempt = 1; attempt <= maxRetries; attempt++)
            {
                try
                {
                    byte[]         data = Encoding.UTF8.GetBytes(json);
                    HttpWebRequest req  = (HttpWebRequest)WebRequest.Create(apiEndpoint);
                    req.Method        = "POST";
                    req.ContentType   = "application/json; charset=utf-8";
                    req.ContentLength = data.Length;
                    req.Timeout       = 10000;
                    req.Headers.Add("X-API-Key", apiKey);
                    req.UserAgent = "AlphaDeskBridge/2.0";

                    using (Stream s = req.GetRequestStream())
                        s.Write(data, 0, data.Length);

                    using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                    {
                        if (res.StatusCode == HttpStatusCode.OK ||
                            res.StatusCode == HttpStatusCode.Created)
                        {
                            Interlocked.Increment(ref tradesSent);
                            lastTradeSent = DateTime.Now;
                            isConnected   = true;
                            lastError     = "";
                            UpdateUI();
                            Log("Trade inviato (tentativo " + attempt + ")");
                            return;
                        }
                    }
                }
                catch (Exception ex)
                {
                    lastError = ex.Message;
                    if (attempt == maxRetries)
                        Log("Invio fallito dopo " + maxRetries + " tentativi: " + ex.Message);
                    else
                        Thread.Sleep(1000 * attempt);
                }
            }

            Interlocked.Increment(ref tradesFailed);
            isConnected = false;
            lock (lockObj) failedQueue.Enqueue(json);
            UpdateUI();
        }

        private void RetryFailed(object state)
        {
            string json = null;
            lock (lockObj)
            {
                if (failedQueue.Count == 0) return;
                json = failedQueue.Dequeue();
            }
            if (json != null) { Log("Retry..."); SendToAlphaDesk(json); }
        }

        // ═══════════════════════════════════════════════════════════════════
        //  TEST CONNESSIONE
        // ═══════════════════════════════════════════════════════════════════
        internal bool TestConnection()
        {
            if (!isConfigured) return false;
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(apiEndpoint + "?ping=1");
                req.Method  = "GET";
                req.Timeout = 8000;
                req.Headers.Add("X-API-Key", apiKey);
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                {
                    isConnected = res.StatusCode == HttpStatusCode.OK;
                    lastError   = isConnected ? "" : "HTTP " + res.StatusCode;
                }
            }
            catch (Exception ex) { isConnected = false; lastError = ex.Message; }
            return isConnected;
        }

        // ═══════════════════════════════════════════════════════════════════
        //  UI
        // ═══════════════════════════════════════════════════════════════════
        // Nota: la finestra AlphaDesk Bridge si apre con F5 nel NinjaScript Editor
        // oppure ricompilando il plugin. Non usa OnWindowCreated per evitare
        // di aprirsi su ogni finestra NT8.

        private void ShowWindow()
        {
            if (statusWindow != null && statusWindow.IsLoaded) { statusWindow.Activate(); return; }
            statusWindow = new AlphaDeskWindow(this);
            statusWindow.Show();
        }

        internal void UpdateUI()
        {
            try
            {
                if (statusWindow == null || !statusWindow.IsLoaded) return;
                Application.Current?.Dispatcher?.InvokeAsync(() => statusWindow.Refresh());
            }
            catch { }
        }

        // Getter
        internal string   Endpoint   => apiEndpoint;
        internal string   ApiKeyVal  => apiKey;
        internal bool     SendSim    => sendSimulated;
        internal bool     DbgMode    => debugMode;
        internal bool     IsConn     => isConnected;
        internal bool     IsConf     => isConfigured;
        internal string   LastErr    => lastError;
        internal int      Sent       => tradesSent;
        internal int      Failed     => tradesFailed;
        internal int      Queued     { get { lock(lockObj) return failedQueue.Count; } }
        internal DateTime? LastSent  => lastTradeSent;

        internal Dictionary<string,string> AliasMap => accountAlias;

        internal void ApplySettings(string ep, string key, string alias, bool sim, bool dbg)
        {
            apiEndpoint   = ep.Trim();
            apiKey        = key.Trim();
            sendSimulated = sim;
            debugMode     = dbg;
            // Parsing alias
            accountAlias.Clear();
            foreach (string pair in alias.Split(','))
            {
                var parts = pair.Trim().Split('=');
                if (parts.Length == 2 && !string.IsNullOrEmpty(parts[0].Trim()))
                    accountAlias[parts[0].Trim()] = parts[1].Trim();
            }
            isConfigured  = !string.IsNullOrEmpty(apiEndpoint)
                         && !string.IsNullOrEmpty(apiKey)
                         && apiKey != "INCOLLA_LA_TUA_CHIAVE_API";
            SaveConfig();
            Unsubscribe();
            if (isConfigured) Subscribe();
            Log("Configurazione aggiornata.");
            UpdateUI();
        }

        // ═══════════════════════════════════════════════════════════════════
        //  UTILITY
        // ═══════════════════════════════════════════════════════════════════
        private void Log(string msg)
        {
            try { File.AppendAllText(logPath,
                DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + msg + "\n",
                Encoding.UTF8); }
            catch { }
        }

        private string ExtractStr(string json, string key)
        {
            var m = System.Text.RegularExpressions.Regex.Match(json,
                "\"" + key + "\"\\s*:\\s*\"([^\"]*)\"");
            return m.Success ? m.Groups[1].Value : "";
        }
        private bool ExtractBool(string json, string key, bool def)
        {
            var m = System.Text.RegularExpressions.Regex.Match(json,
                "\"" + key + "\"\\s*:\\s*(true|false)",
                System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            return m.Success ? m.Groups[1].Value.ToLower() == "true" : def;
        }
        private int ExtractInt(string json, string key, int def)
        {
            var m = System.Text.RegularExpressions.Regex.Match(json,
                "\"" + key + "\"\\s*:\\s*(\\d+)");
            return m.Success ? int.Parse(m.Groups[1].Value) : def;
        }

    } // fine AlphaDeskBridge

    // ═══════════════════════════════════════════════════════════════════════
    //  DATA CLASSES v2.0
    // ═══════════════════════════════════════════════════════════════════════
    internal class TradeAccumulator
    {
        public string   TradeUid;
        public string   Account;
        public string   DisplayAccount;
        public string   Instrument;
        public string   InstrumentBase;
        public string   Direction;

        public int      NetQuantity;
        public int      TotalEntryQuantity;
        public int      TotalExitQuantity;

        public double   EntryValue;
        public double   ExitValue;
        public double   EntryAveragePrice;
        public double   ExitAveragePrice;

        public double   TotalCommission;

        public double   PointValue;
        public double   TickSize;
        public double   TickValue;

        public bool     IsSimulated;

        public DateTime EntryTime;
        public DateTime ExitTime;
        public DateTime LastExecutionTime;

        public List<ExecutionSnapshot> Executions = new List<ExecutionSnapshot>();
    }

    internal class ExecutionSnapshot
    {
        public string   ExecutionId;
        public string   OrderId;
        public string   Side;
        public int      Quantity;
        public double   Price;
        public double   Commission;
        public DateTime Time;
    }
    // (chiusura namespace rimossa — già chiusa sotto con AlphaDeskWindow)

    // ═══════════════════════════════════════════════════════════════════════
    //  FINESTRA UI WPF
    // ═══════════════════════════════════════════════════════════════════════
    internal class AlphaDeskWindow : Window
    {
        private AlphaDeskBridge b;
        private TextBox   tbUrl, tbKey, tbAlias;
        private CheckBox  chkSim, chkDbg;
        private TextBlock tbConn, tbSent, tbFailed, tbQueued, tbLast, tbErr;

        private static SolidColorBrush C(byte r, byte g, byte bl)
            => new SolidColorBrush(Color.FromRgb(r, g, bl));

        private static readonly SolidColorBrush accent = C(0, 212, 170);
        private static readonly SolidColorBrush bg0    = C(8, 11, 15);
        private static readonly SolidColorBrush bg2    = C(18, 24, 32);
        private static readonly SolidColorBrush brd    = C(30, 42, 56);
        private static readonly SolidColorBrush t0     = new SolidColorBrush(Colors.White);
        private static readonly SolidColorBrush t2     = C(100, 130, 160);
        private static readonly SolidColorBrush grn    = C(0, 212, 170);
        private static readonly SolidColorBrush red    = C(255, 77, 109);

        internal AlphaDeskWindow(AlphaDeskBridge bridge)
        {
            b = bridge;
            Title = "AlphaDesk Bridge"; Width = 500; Height = 560;
            ResizeMode = ResizeMode.CanMinimize;
            Background = bg0; Foreground = t0;
            FontFamily = new FontFamily("Segoe UI");

            var root = new StackPanel { Margin = new Thickness(20) };

            Add(root, new TextBlock { Text = "Alpha Desk  Bridge",
                FontSize = 20, FontWeight = FontWeights.Bold,
                Foreground = accent, Margin = new Thickness(0,0,0,4) });
            Add(root, new TextBlock { Text = "Invia ogni trade ad AlphaDesk in tempo reale",
                FontSize = 12, Foreground = t2, Margin = new Thickness(0,0,0,20) });

            Add(root, Lbl("Endpoint URL"));
            tbUrl = Inp(b.Endpoint); Add(root, tbUrl);

            Add(root, Lbl("API Key  (generala su AlphaDesk → Eseguiti → Sync → NinjaTrader → Step 3)"));
            tbKey = Inp(b.ApiKeyVal);
            tbKey.IsReadOnly = false;
            // Mostra versione mascherata nell'input (gli ultimi 6 char visibili)
            if (b.ApiKeyVal != null && b.ApiKeyVal.Length > 6 && b.ApiKeyVal != "INCOLLA_LA_TUA_CHIAVE_API")
            {
                tbKey.Text = new string('*', b.ApiKeyVal.Length - 6) + b.ApiKeyVal.Substring(b.ApiKeyVal.Length - 6);
                tbKey.GotFocus += (s, e) => { if (tbKey.Text.Contains("*")) tbKey.Text = b.ApiKeyVal; };
                tbKey.LostFocus += (s, e) => {
                    string val = tbKey.Text;
                    if (!val.Contains("*") && val.Length > 6)
                        tbKey.Text = new string('*', val.Length - 6) + val.Substring(val.Length - 6);
                };
            }
            Add(root, tbKey);

            Add(root, Lbl("Nome conto in AlphaDesk — separa più conti con la virgola\nEs: LFE05067595930005=LucidProp, Sim101=Demo, ALTRO=NomeScelto"));
            var aliasList2 = new System.Collections.Generic.List<string>();
            foreach (var kv in bridge.AliasMap) aliasList2.Add(kv.Key + "=" + kv.Value);
            tbAlias = Inp(string.Join(",", aliasList2));
            Add(root, tbAlias);

            chkSim = new CheckBox { Content = "Invia anche trade su conto simulato (Sim101 ecc.)",
                IsChecked = b.SendSim, Foreground = t0, Margin = new Thickness(0,8,0,4) };
            chkDbg = new CheckBox { Content = "Debug (log dettagliato in AlphaDeskBridge.log)",
                IsChecked = b.DbgMode, Foreground = t2, Margin = new Thickness(0,0,0,16) };
            Add(root, chkSim); Add(root, chkDbg);

            var btnRow = new StackPanel { Orientation = Orientation.Horizontal,
                Margin = new Thickness(0,0,0,20) };
            var bSave = Btn("Salva configurazione", accent, bg0, true);
            var bTest = Btn("Test connessione", bg2, t0, false);
            bSave.Click += (s,e) => Save(bSave);
            bTest.Click += (s,e) => Test(bTest);
            btnRow.Children.Add(bSave);
            btnRow.Children.Add(new Border { Width = 10 });
            btnRow.Children.Add(bTest);
            Add(root, btnRow);

            Add(root, new TextBlock {
                Text = "ℹ Lo stato 'Non verificato' dopo il riavvio di NT8 è normale. I trade vengono inviati automaticamente — il Test serve solo per confermare la connessione.",
                FontSize = 11, Foreground = t2, TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 0, 0, 16)
            });
            Add(root, new TextBlock {
                Text = "ℹ Lo stato 'Non verificato' dopo il riavvio è normale. I trade vengono inviati automaticamente al primo trade chiuso.",
                FontSize = 11, Foreground = t2, TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 0, 0, 16)
            });
            Add(root, new Border { Height=1, Background=brd, Margin=new Thickness(0,0,0,16) });
            Add(root, new TextBlock { Text="STATUS", FontSize=10, Foreground=t2,
                Margin=new Thickness(0,0,0,10), FontWeight=FontWeights.Bold });

            tbConn   = new TextBlock { FontSize=12 };
            tbSent   = new TextBlock { FontSize=12, Foreground=t0 };
            tbFailed = new TextBlock { FontSize=12 };
            tbQueued = new TextBlock { FontSize=12 };
            tbLast   = new TextBlock { FontSize=12, Foreground=t0 };
            tbErr    = new TextBlock { FontSize=12, TextWrapping=TextWrapping.Wrap };

            Add(root, Row("Connessione",     tbConn));
            Add(root, Row("Trade inviati",   tbSent));
            Add(root, Row("Trade falliti",   tbFailed));
            Add(root, Row("In coda (retry)", tbQueued));
            Add(root, Row("Ultimo invio",    tbLast));
            Add(root, Row("Ultimo errore",   tbErr));

            Add(root, new Border { Height=1, Background=brd, Margin=new Thickness(0,16,0,12) });
            Add(root, new TextBlock { Text="File config: Documenti\\NinjaTrader 8\\AlphaDeskBridge.config.json",
                FontSize=11, Foreground=t2, TextWrapping=TextWrapping.Wrap });

            Content = new ScrollViewer { Content=root,
                VerticalScrollBarVisibility=ScrollBarVisibility.Auto };

            Refresh();

            var timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(5) };
            timer.Tick += (s,e) => Refresh();
            timer.Start();
        }

        private void Add(Panel p, UIElement e) => p.Children.Add(e);

        private TextBlock Lbl(string t) => new TextBlock { Text=t, FontSize=11,
            Foreground=t2, Margin=new Thickness(0,0,0,4), TextWrapping=TextWrapping.Wrap };

        private TextBox Inp(string v) => new TextBox { Text=v??"", Background=bg2, Foreground=t0,
            BorderBrush=brd, Padding=new Thickness(8,6,8,6), Margin=new Thickness(0,0,0,12),
            FontFamily=new FontFamily("Consolas"), FontSize=12 };

        private Button Btn(string label, SolidColorBrush bg, SolidColorBrush fg, bool bold) =>
            new Button { Content=label, Background=bg, Foreground=fg,
                Padding=new Thickness(14,8,14,8), BorderThickness=new Thickness(0),
                FontSize=13, FontWeight=bold?FontWeights.SemiBold:FontWeights.Normal,
                Cursor=System.Windows.Input.Cursors.Hand };

        private UIElement Row(string label, TextBlock val)
        {
            var g = new Grid { Margin=new Thickness(0,0,0,6) };
            g.ColumnDefinitions.Add(new ColumnDefinition { Width=new GridLength(140) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width=new GridLength(1, GridUnitType.Star) });
            var l = new TextBlock { Text=label, Foreground=t2, FontSize=12 };
            Grid.SetColumn(l,0); Grid.SetColumn(val,1);
            g.Children.Add(l); g.Children.Add(val);
            return g;
        }

        internal void Refresh()
        {
            bool ok = b.IsConn && b.IsConf;
            tbConn.Text      = ok ? "✓ Connesso ad AlphaDesk"
                             : b.IsConf ? "⚠ Stato non verificato — premi Test connessione (i trade vengono inviati ugualmente)"
                             : "✗ Non configurato — inserisci URL e API Key e salva";
            tbConn.Foreground = ok ? grn : red;
            tbSent.Text      = b.Sent + " trade inviati con successo";
            tbFailed.Text    = b.Failed > 0 ? b.Failed + " falliti" : "0";
            tbFailed.Foreground = b.Failed > 0 ? red : t2;
            tbQueued.Text    = b.Queued > 0 ? b.Queued + " in attesa di retry" : "0";
            tbQueued.Foreground = b.Queued > 0 ? red : t2;
            tbLast.Text      = b.LastSent.HasValue
                ? b.LastSent.Value.ToString("dd/MM/yyyy HH:mm:ss") : "— nessun trade ancora";
            tbErr.Text       = string.IsNullOrEmpty(b.LastErr) ? "—" : b.LastErr;
            tbErr.Foreground = string.IsNullOrEmpty(b.LastErr) ? t2 : red;
        }

        private void Save(Button btn)
        {
            b.ApplySettings(tbUrl.Text, tbKey.Text, tbAlias.Text,
                chkSim.IsChecked ?? true, chkDbg.IsChecked ?? false);
            btn.Content = "✓ Salvato!"; btn.Background = grn;
            var t = new DispatcherTimer { Interval=TimeSpan.FromSeconds(2) };
            t.Tick += (s,e) => { btn.Content="Salva configurazione"; btn.Background=accent; t.Stop(); };
            t.Start(); Refresh();
        }

        private void Test(Button btn)
        {
            btn.Content = "Test in corso...";
            btn.IsEnabled = false;
            ThreadPool.QueueUserWorkItem(_ => {
                bool ok = b.TestConnection();
                Dispatcher.InvokeAsync(() => {
                    btn.Content    = ok ? "✓ Connesso ad AlphaDesk!" : "✗ Connessione fallita — verifica URL e API Key";
                    btn.Foreground = ok ? grn : red;
                    btn.IsEnabled  = true;
                    Refresh();
                    var t = new DispatcherTimer { Interval=TimeSpan.FromSeconds(4) };
                    t.Tick += (s,e) => { btn.Content="Test connessione"; btn.Foreground=t0; t.Stop(); };
                    t.Start();
                });
            });
        }
    }
}
