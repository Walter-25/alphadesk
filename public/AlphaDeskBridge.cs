// AlphaDesk Bridge v1.2 — NinjaTrader 8 Add-On
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

        // ── Tracciamento posizioni per costruire trade completi ─────────────
        // Quando position torna flat → trade completato
        private Dictionary<string, PositionInfo> openPositions
            = new Dictionary<string, PositionInfo>();

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
                if (isConfigured) Subscribe();

                retryTimer = new System.Threading.Timer(RetryFailed, null,
                    TimeSpan.FromMinutes(5), TimeSpan.FromMinutes(5));

                Log("AlphaDesk Bridge v1.2 avviato. Endpoint: " +
                    (apiEndpoint.Length > 0 ? apiEndpoint : "NON CONFIGURATO"));
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
            lock (lockObj)
            {
                foreach (Account acc in Account.All)
                {
                    // ExecutionUpdate è l'evento corretto per AddOn in NT8
                    acc.ExecutionUpdate += OnExecutionUpdate;
                    Log("Sottoscritto a: " + acc.Name);
                }
            }
        }

        private void Unsubscribe()
        {
            try
            {
                foreach (Account acc in Account.All)
                    acc.ExecutionUpdate -= OnExecutionUpdate;
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

                Account account   = sender as Account;
                if (account == null) return;

                Execution exec = e.Execution;

                // Filtra trade simulati se richiesto
                bool isSim = account.Connection != null &&
                             account.Connection.Options != null &&
                             account.Connection.Options.Mode == Mode.Simulation;
                if (!sendSimulated && isSim) return;

                string instrument = exec.Instrument != null
                    ? exec.Instrument.FullName : "N/A";
                string key = account.Name + "|" + instrument;
                // Applica alias nome conto se configurato
                string displayName = accountAlias.ContainsKey(account.Name)
                    ? accountAlias[account.Name] : account.Name;

                if (debugMode)
                    Log("Execution: " + instrument + " " + exec.MarketPosition +
                        " qty=" + exec.Quantity + " price=" + exec.Price);

                lock (lockObj)
                {
                    if (!openPositions.ContainsKey(key))
                    {
                        // Prima execution: apre la posizione
                        openPositions[key] = new PositionInfo
                        {
                            Account       = account.Name,
                            Instrument    = instrument,
                            InstrumentBase = exec.Instrument != null
                                ? exec.Instrument.MasterInstrument.Name : instrument,
                            Direction     = exec.MarketPosition == MarketPosition.Long ? "Long" : "Short",
                            EntryPrice    = exec.Price,
                            EntryTime     = exec.Time,
                            Quantity      = exec.Quantity,
                            Commission    = exec.Commission,
                            IsSim         = isSim,
                            PointValue    = exec.Instrument != null
                                ? exec.Instrument.MasterInstrument.PointValue : 1.0,
                            TickSize      = exec.Instrument != null
                                ? exec.Instrument.MasterInstrument.TickSize : 0.25,
                        };
                    }
                    else
                    {
                        // Seconda execution (exit): chiude il trade
                        PositionInfo pos = openPositions[key];
                        openPositions.Remove(key);

                        double exitPrice = exec.Price;
                        double exitComm  = exec.Commission;
                        int    duration  = (int)(exec.Time - pos.EntryTime).TotalMinutes;

                        double profitPoints = pos.Direction == "Long"
                            ? exitPrice - pos.EntryPrice
                            : pos.EntryPrice - exitPrice;

                        double pointValue = pos.PointValue;
                        double profitGross = profitPoints * pointValue * pos.Quantity;
                        double totalComm   = pos.Commission + exitComm;
                        double profitNet   = profitGross - totalComm;

                        double tickValue   = pointValue * pos.TickSize;
                        double profitTicks = pos.TickSize > 0
                            ? profitPoints / pos.TickSize : 0;

                        // Costruisce JSON e invia
                        var json = BuildJson(
                            displayName, pos.InstrumentBase, pos.Instrument,
                            pos.Direction, pos.Quantity, pos.IsSim,
                            pos.EntryPrice, exitPrice,
                            pos.EntryTime, exec.Time, duration,
                            profitGross, profitNet, profitTicks, profitPoints,
                            totalComm, pointValue, pos.TickSize, tickValue
                        );

                        System.Threading.ThreadPool.QueueUserWorkItem(
                            _ => SendToAlphaDesk(json));
                    }
                }
            }
            catch (Exception ex) { Log("Errore OnExecutionUpdate: " + ex.Message); }
        }

        private string BuildJson(
            string account, string instrBase, string instr,
            string direction, int qty, bool isSim,
            double entryPrice, double exitPrice,
            DateTime entryTime, DateTime exitTime, int durMin,
            double profitGross, double profitNet, double profitTicks, double profitPoints,
            double commission, double pointValue, double tickSize, double tickValue)
        {
            var sb = new StringBuilder();
            sb.Append("{");
            S(sb, "source",           "AlphaDeskBridge");
            S(sb, "account",          account);
            S(sb, "instrument",       instr);
            S(sb, "instrument_base",  instrBase);
            S(sb, "market_position",  direction);
            N(sb, "quantity",         qty);
            B(sb, "is_simulated",     isSim);
            N(sb, "entry_price",      entryPrice);
            N(sb, "exit_price",       exitPrice);
            S(sb, "entry_time",       entryTime.ToString("yyyy-MM-ddTHH:mm:ss"));
            S(sb, "exit_time",        exitTime.ToString("yyyy-MM-ddTHH:mm:ss"));
            N(sb, "duration_min",     durMin);
            N(sb, "profit_gross",     Math.Round(profitGross, 2));
            N(sb, "profit_net",       Math.Round(profitNet, 2));
            N(sb, "profit_ticks",     Math.Round(profitTicks, 2));
            N(sb, "profit_points",    Math.Round(profitPoints, 4));
            N(sb, "commission",       Math.Round(commission, 2));
            N(sb, "point_value",      pointValue);
            N(sb, "tick_size",        tickSize);
            N(sb, "tick_value",       Math.Round(tickValue, 4));
            // Rimuovi ultima virgola e chiudi
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
                    req.Headers.Add("User-Agent", "AlphaDeskBridge/1.2");

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
        protected override void OnWindowCreated(Window window)
        {
            try
            {
                // NT8 ha più finestre — aggiungi la voce solo alla Control Center (finestra principale)
                // Identificata dal tipo o dal titolo
                string title = window.Title ?? "";
                bool isMain = title.Contains("NinjaTrader") || window.GetType().Name.Contains("MainWindow");
                if (!isMain) return;

                // Cerca il Menu nell'albero visuale
                var menu = FindVisualChild<Menu>(window);
                if (menu != null)
                {
                    // Aggiungi solo se non già presente
                    foreach (var item2 in menu.Items)
                        if (item2 is MenuItem mi && mi.Header?.ToString() == "AlphaDesk Bridge") return;

                    var item = new MenuItem { Header = "AlphaDesk Bridge" };
                    item.Click += (s, e) => ShowWindow();
                    menu.Items.Add(item);
                }
                else
                {
                    // Fallback: aggiungi un pulsante nella barra del titolo
                    // NT8 non espone sempre il menu — apri la finestra all'avvio
                    window.Loaded += (s, e) => ShowWindow();
                }
            }
            catch { }
        }

        private static T FindVisualChild<T>(DependencyObject parent) where T : DependencyObject
        {
            if (parent == null) return null;
            for (int i = 0; i < VisualTreeHelper.GetChildrenCount(parent); i++)
            {
                var child = VisualTreeHelper.GetChild(parent, i);
                if (child is T found) return found;
                var result = FindVisualChild<T>(child);
                if (result != null) return result;
            }
            return null;
        }

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

        private class PositionInfo
        {
            public string   Account;
            public string   Instrument;
            public string   InstrumentBase;
            public string   Direction;
            public double   EntryPrice;
            public DateTime EntryTime;
            public int      Quantity;
            public double   Commission;
            public bool     IsSim;
            public double   PointValue;
            public double   TickSize;
        }
    }

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
                tbKey.Text = new string('•', b.ApiKeyVal.Length - 6) + b.ApiKeyVal.Substring(b.ApiKeyVal.Length - 6);
                tbKey.GotFocus += (s, e) => { if (tbKey.Text.Contains('•')) tbKey.Text = b.ApiKeyVal; };
                tbKey.LostFocus += (s, e) => {
                    string val = tbKey.Text;
                    if (!val.Contains('•') && val.Length > 6)
                        tbKey.Text = new string('•', val.Length - 6) + val.Substring(val.Length - 6);
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
