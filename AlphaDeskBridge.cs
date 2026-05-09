#region Using declarations
using System.Threading.Tasks;
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

// ─────────────────────────────────────────────────────────────────────────────
//  AlphaDesk Bridge — NinjaTrader 8 Add-On
//  Invia ogni trade chiuso ad AlphaDesk in tempo reale via REST API
//
//  Installazione:
//  1. Copia questo file in: Documenti\NinjaTrader 8\bin\Custom\AddOns\
//  2. In NT8: New → NinjaScript Editor → Compile (F5)
//  3. Riavvia NinjaTrader 8
//  4. Vai in AlphaDesk → Eseguiti → Sync → NinjaTrader → copia URL e API key
//  5. Inserisci URL e API key nel pannello AlphaDesk Bridge (si apre in NT8)
// ─────────────────────────────────────────────────────────────────────────────

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

        // ── Stato ───────────────────────────────────────────────────────────
        private bool   isConfigured  = false;
        private bool   isConnected   = false;
        private string lastError     = "";
        private int    tradesSent    = 0;
        private int    tradesFailed  = 0;
        private DateTime? lastTradeSent;

        // ── Percorsi file ───────────────────────────────────────────────────
        private string configPath = "";
        private string logPath    = "";

        // ── Sync ────────────────────────────────────────────────────────────
        private Queue<string>           failedQueue    = new Queue<string>();
        private object                  lockObj        = new object();
        private HashSet<string>         sentIds        = new HashSet<string>();
        private Dictionary<string,int>  tradeCounters  = new Dictionary<string,int>();
        private System.Threading.Timer  retryTimer;

        // ── UI ──────────────────────────────────────────────────────────────
        private AlphaDeskWindow statusWindow;
        private TextBlock       tbStatus, tbTrades, tbFailed, tbLast, tbError;

        // ── Versione ────────────────────────────────────────────────────────
        private string ntVersion = "";
        private string machineId = "";

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
                    "NinjaTrader 8"
                );
                configPath = Path.Combine(ntFolder, "AlphaDeskBridge.config.json");
                logPath    = Path.Combine(ntFolder, "AlphaDeskBridge.log");

                ntVersion = Assembly.GetAssembly(typeof(NinjaTrader.NinjaScript.AddOnBase))
                                    ?.GetName().Version?.ToString() ?? "N/A";
                machineId = Environment.MachineName;

                LoadConfig();
                if (isConfigured) SubscribeToAccounts();

                retryTimer = new System.Threading.Timer(RetryFailed, null,
                    TimeSpan.FromMinutes(5), TimeSpan.FromMinutes(5));

                Log("AlphaDesk Bridge avviato. Endpoint: " + (apiEndpoint.Length > 0 ? apiEndpoint : "NON CONFIGURATO"));
            }
            else if (State == State.Terminated)
            {
                retryTimer?.Dispose();
                UnsubscribeFromAccounts();
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
                lastError = "Config non trovata — inserisci URL e API key nel pannello AlphaDesk Bridge";
                return;
            }
            try
            {
                string json = File.ReadAllText(configPath, Encoding.UTF8);
                apiEndpoint   = ExtractStr(json, "Endpoint");
                apiKey        = ExtractStr(json, "ApiKey");
                sendSimulated = ExtractBool(json, "SendSimulated", true);
                debugMode     = ExtractBool(json, "Debug", false);
                maxRetries    = ExtractInt(json, "MaxRetries", 3);

                isConfigured = !string.IsNullOrWhiteSpace(apiEndpoint) &&
                               !string.IsNullOrWhiteSpace(apiKey) &&
                               apiKey != "INCOLLA_LA_TUA_CHIAVE_API";
                if (!isConfigured) lastError = "Endpoint o ApiKey mancanti";
            }
            catch (Exception ex) { lastError = ex.Message; isConfigured = false; }
        }

        private void SaveConfig()
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

        private void WriteDefaultConfig()
        {
            var sb = new StringBuilder();
            sb.AppendLine("{");
            sb.AppendLine("  \"Endpoint\": \"https://alphadesk-ecru.vercel.app/api/ingest\",");
            sb.AppendLine("  \"ApiKey\": \"INCOLLA_LA_TUA_CHIAVE_API\",");
            sb.AppendLine("  \"SendSimulated\": true,");
            sb.AppendLine("  \"Debug\": false,");
            sb.AppendLine("  \"MaxRetries\": 3");
            sb.AppendLine("}");
            File.WriteAllText(configPath, sb.ToString(), Encoding.UTF8);
        }

        // ═══════════════════════════════════════════════════════════════════
        //  GESTIONE ACCOUNT / TRADE
        // ═══════════════════════════════════════════════════════════════════
        private void SubscribeToAccounts()
        {
            foreach (var acc in Account.All)
                acc.TradeCollection.TradeAdded += OnTradeAdded;
        }

        private void UnsubscribeFromAccounts()
        {
            foreach (var acc in Account.All)
                acc.TradeCollection.TradeAdded -= OnTradeAdded;
        }

        private void OnTradeAdded(object sender, TradeEventArgs e)
        {
            try
            {
                if (!isConfigured) return;
                var trade   = e.Trade;
                var account = sender as Account;
                if (account == null) return;

                bool isSim = account.Connection.Options.Mode == Mode.Simulation;
                if (!sendSimulated && isSim) return;

                string uid = account.Name + "_" +
                             trade.Entry.Instrument.FullName + "_" +
                             trade.Entry.Time.ToString("yyyyMMddHHmmss") + "_" +
                             trade.Exit.Time.ToString("yyyyMMddHHmmss");

                lock (lockObj)
                {
                    if (sentIds.Contains(uid)) return;
                    sentIds.Add(uid);
                    if (!tradeCounters.ContainsKey(account.Name)) tradeCounters[account.Name] = 0;
                    tradeCounters[account.Name]++;
                }

                var info = new PendingInfo { Trade = trade, Account = account,
                    Num = tradeCounters[account.Name], IsSim = isSim };

                // Delay 1s per permettere a NT di completare i calcoli
                System.Threading.Timer t = null;
                t = new System.Threading.Timer(s => {
                    try { BuildAndSend((PendingInfo)s); }
                    catch (Exception ex) { Log("Errore: " + ex.Message); }
                    finally { t?.Dispose(); }
                }, info, 1000, Timeout.Infinite);
            }
            catch (Exception ex) { Log("OnTradeAdded: " + ex.Message); }
        }

        private void BuildAndSend(PendingInfo info)
        {
            var trade   = info.Trade;
            var account = info.Account;
            var mi      = trade.Entry.Instrument.MasterInstrument;

            double pointValue = mi.PointValue;
            double tickSize   = mi.TickSize;
            double tickValue  = pointValue * tickSize;
            double exitRate   = trade.Exit.Rate > 0 ? trade.Exit.Rate : 1;

            double profitGross = trade.ProfitCurrency / exitRate;
            double maeAcc      = trade.MaeCurrency;
            double mfeAcc      = trade.MfeCurrency;
            double etd         = mfeAcc > 0
                ? (profitGross >= 0 ? mfeAcc - profitGross : mfeAcc + Math.Abs(profitGross))
                : 0;
            if (etd < 0) etd = 0;

            var sb = new StringBuilder();
            sb.Append("{");
            // Identificazione
            A(sb, "trade_number",   info.Num);
            A(sb, "account",        account.Name);
            A(sb, "instrument",     trade.Entry.Instrument.FullName);
            A(sb, "instrument_base",mi.Name);
            A(sb, "market_position",trade.Entry.MarketPosition.ToString());
            A(sb, "quantity",       trade.Quantity);
            A(sb, "is_simulated",   info.IsSim);
            // Prezzi
            A(sb, "entry_price",    trade.Entry.Price);
            A(sb, "exit_price",     trade.Exit.Price);
            // Tempi
            A(sb, "entry_time",     trade.Entry.Time.ToString("yyyy-MM-ddTHH:mm:ss"));
            A(sb, "exit_time",      trade.Exit.Time.ToString("yyyy-MM-ddTHH:mm:ss"));
            A(sb, "entry_name",     trade.Entry.Name ?? "");
            A(sb, "exit_name",      trade.Exit.Name ?? "");
            // P&L
            A(sb, "profit_gross",   Math.Round(profitGross, 2));
            A(sb, "profit_net",     Math.Round(profitGross - 0, 2)); // commissioni calcolate lato server
            A(sb, "profit_ticks",   trade.ProfitTicks);
            A(sb, "profit_points",  trade.ProfitPoints);
            // MAE
            A(sb, "mae_account_currency", Math.Round(maeAcc, 2));
            A(sb, "mae_ticks",      trade.MaeTicks);
            A(sb, "mae_points",     trade.MaePoints);
            // MFE
            A(sb, "mfe_account_currency", Math.Round(mfeAcc, 2));
            A(sb, "mfe_ticks",      trade.MfeTicks);
            A(sb, "mfe_points",     trade.MfePoints);
            // ETD
            A(sb, "etd_account_currency", Math.Round(etd, 2));
            // Efficienza
            A(sb, "entry_efficiency", Math.Round(trade.EntryEfficiency, 4));
            A(sb, "exit_efficiency",  Math.Round(trade.ExitEfficiency, 4));
            A(sb, "total_efficiency", Math.Round(trade.TotalEfficiency, 4));
            // Strumento
            A(sb, "point_value",    pointValue);
            A(sb, "tick_size",      tickSize);
            A(sb, "tick_value",     tickValue);
            // Sistema
            A(sb, "nt_version",     ntVersion);
            A(sb, "machine_id",     machineId);
            A(sb, "source",         "AlphaDeskBridge");
            sb.Append("\"_v\":\"1.0\"}");

            string json = sb.ToString().Replace(",\"_v\"", ",\"_v\"");
            SendToAlphaDesk(json);
        }

        // Helper per costruire JSON
        private void A(StringBuilder sb, string k, object v)
        {
            if (v is string s)  sb.Append("\"" + k + "\":\"" + s.Replace("\"","\\\"") + "\",");
            else if (v is bool b)  sb.Append("\"" + k + "\":" + (b ? "true" : "false") + ",");
            else sb.Append("\"" + k + "\":" + v + ",");
        }

        // ═══════════════════════════════════════════════════════════════════
        //  INVIO HTTP
        // ═══════════════════════════════════════════════════════════════════
        private void SendToAlphaDesk(string json)
        {
            for (int attempt = 1; attempt <= maxRetries; attempt++)
            {
                try
                {
                    var req = (HttpWebRequest)WebRequest.Create(apiEndpoint);
                    req.Method      = "POST";
                    req.ContentType = "application/json; charset=utf-8";
                    req.Timeout     = 10000;
                    req.Headers.Add("X-API-Key", apiKey);
                    req.Headers.Add("User-Agent", "AlphaDeskBridge/1.0");

                    byte[] data = Encoding.UTF8.GetBytes(json);
                    req.ContentLength = data.Length;
                    using (var s = req.GetRequestStream()) s.Write(data, 0, data.Length);

                    using (var res = (HttpWebResponse)req.GetResponse())
                    {
                        if (res.StatusCode == HttpStatusCode.OK || res.StatusCode == HttpStatusCode.Created)
                        {
                            Interlocked.Increment(ref tradesSent);
                            lastTradeSent = DateTime.Now;
                            isConnected   = true;
                            lastError     = "";
                            UpdateUI();
                            Log("Trade inviato con successo.");
                            return;
                        }
                    }
                }
                catch (Exception ex)
                {
                    lastError = ex.Message;
                    if (attempt == maxRetries) Log("Invio fallito dopo " + maxRetries + " tentativi: " + ex.Message);
                    else Thread.Sleep(1000 * attempt);
                }
            }
            Interlocked.Increment(ref tradesFailed);
            isConnected = false;
            lock (lockObj) { failedQueue.Enqueue(json); }
            UpdateUI();
        }

        private void RetryFailed(object state)
        {
            if (!isConfigured || failedQueue.Count == 0) return;
            string json;
            lock (lockObj)
            {
                if (failedQueue.Count == 0) return;
                json = failedQueue.Dequeue();
            }
            Log("Retry trade in coda...");
            SendToAlphaDesk(json);
        }

        // ═══════════════════════════════════════════════════════════════════
        //  TEST CONNESSIONE
        // ═══════════════════════════════════════════════════════════════════
        private bool TestConnection()
        {
            if (!isConfigured) return false;
            try
            {
                string testUrl = apiEndpoint + (apiEndpoint.Contains("?") ? "&ping=1" : "?ping=1");
                var req = (HttpWebRequest)WebRequest.Create(testUrl);
                req.Method  = "GET";
                req.Timeout = 8000;
                req.Headers.Add("X-API-Key", apiKey);
                using (var res = (HttpWebResponse)req.GetResponse())
                {
                    isConnected = res.StatusCode == HttpStatusCode.OK;
                    lastError   = isConnected ? "" : "HTTP " + res.StatusCode;
                }
            }
            catch (Exception ex) { isConnected = false; lastError = ex.Message; }
            return isConnected;
        }

        // ═══════════════════════════════════════════════════════════════════
        //  UI — Pannello AlphaDesk Bridge (finestra NT8)
        // ═══════════════════════════════════════════════════════════════════
        protected override void OnWindowCreated(Window window)
        {
            // Aggiunge voce nel menu Strumenti di NT8
            var menu = window.FindName("menuStrip") as Menu;
            if (menu == null) return;
            var item = new MenuItem { Header = "AlphaDesk Bridge" };
            item.Click += (s, e) => ShowWindow();
            menu.Items.Add(item);
        }

        private void ShowWindow()
        {
            if (statusWindow != null && statusWindow.IsLoaded)
            { statusWindow.Activate(); return; }

            statusWindow = new AlphaDeskWindow(this);
            statusWindow.Show();
        }

        internal void UpdateUI()
        {
            if (statusWindow == null || !statusWindow.IsLoaded) return;
            Application.Current?.Dispatcher?.InvokeAsync(() => statusWindow.Refresh());
        }

        // Getter per la finestra
        internal string Endpoint    => apiEndpoint;
        internal string ApiKey      => apiKey;
        internal bool   SendSim     => sendSimulated;
        internal bool   Debug       => debugMode;
        internal bool   IsConn      => isConnected;
        internal bool   IsConf      => isConfigured;
        internal string LastErr     => lastError;
        internal int    Sent        => tradesSent;
        internal int    Failed      => tradesFailed;
        internal int    Queued      { get { lock(lockObj) return failedQueue.Count; } }
        internal DateTime? LastSent => lastTradeSent;

        internal void ApplySettings(string endpoint, string key, bool sim, bool dbg)
        {
            apiEndpoint   = endpoint.Trim();
            apiKey        = key.Trim();
            sendSimulated = sim;
            debugMode     = dbg;
            isConfigured  = !string.IsNullOrEmpty(apiEndpoint) && !string.IsNullOrEmpty(apiKey);
            SaveConfig();
            if (isConfigured)
            {
                UnsubscribeFromAccounts();
                SubscribeToAccounts();
            }
            Log("Configurazione aggiornata.");
        }

        internal bool RunTest() => TestConnection();

        // ═══════════════════════════════════════════════════════════════════
        //  UTILITY
        // ═══════════════════════════════════════════════════════════════════
        private void Log(string msg)
        {
            try { File.AppendAllText(logPath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + msg + "\n"); }
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

        // ─── Classi interne ────────────────────────────────────────────────
        private class PendingInfo
        {
            public Trade   Trade;
            public Account Account;
            public int     Num;
            public bool    IsSim;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  FINESTRA UI WPF
    // ═══════════════════════════════════════════════════════════════════════
    internal class AlphaDeskWindow : Window
    {
        private AlphaDeskBridge bridge;
        private TextBox  tbEndpoint, tbKey;
        private CheckBox chkSim, chkDbg;
        private TextBlock tbConn, tbSent, tbFailed, tbQueued, tbLast, tbErr;
        private Button   btnSave, btnTest;

        // Colori brand AlphaDesk
        private SolidColorBrush accent  = new SolidColorBrush(Color.FromRgb(0, 212, 170));
        private SolidColorBrush bg0     = new SolidColorBrush(Color.FromRgb(8, 11, 15));
        private SolidColorBrush bg2     = new SolidColorBrush(Color.FromRgb(18, 24, 32));
        private SolidColorBrush border  = new SolidColorBrush(Color.FromRgb(30, 42, 56));
        private SolidColorBrush text0   = new SolidColorBrush(Colors.White);
        private SolidColorBrush text2   = new SolidColorBrush(Color.FromRgb(100, 130, 160));
        private SolidColorBrush green   = new SolidColorBrush(Color.FromRgb(0, 212, 170));
        private SolidColorBrush red     = new SolidColorBrush(Color.FromRgb(255, 77, 109));

        internal AlphaDeskWindow(AlphaDeskBridge b)
        {
            bridge = b;
            Title  = "AlphaDesk Bridge";
            Width  = 480; Height = 520;
            ResizeMode    = ResizeMode.CanMinimize;
            Background    = bg0;
            Foreground    = text0;
            FontFamily    = new FontFamily("Segoe UI");

            var root = new StackPanel { Margin = new Thickness(20) };

            // Header
            root.Children.Add(new TextBlock {
                Text = "Alpha Desk Bridge",
                FontSize = 22, FontWeight = FontWeights.Bold,
                Foreground = accent, Margin = new Thickness(0,0,0,4)
            });
            root.Children.Add(new TextBlock {
                Text = "Invia ogni trade a AlphaDesk in tempo reale",
                FontSize = 12, Foreground = text2, Margin = new Thickness(0,0,0,20)
            });

            // Endpoint
            root.Children.Add(Label("Endpoint URL"));
            tbEndpoint = InputBox(b.Endpoint);
            root.Children.Add(tbEndpoint);

            // API Key
            root.Children.Add(Label("API Key"));
            tbKey = InputBox(b.ApiKey);
            root.Children.Add(tbKey);

            // Opzioni
            chkSim = new CheckBox { Content = "Invia anche trade simulati", IsChecked = b.SendSim,
                Foreground = text0, Margin = new Thickness(0,10,0,4) };
            chkDbg = new CheckBox { Content = "Debug mode (log dettagliato)", IsChecked = b.Debug,
                Foreground = text2, Margin = new Thickness(0,0,0,14) };
            root.Children.Add(chkSim);
            root.Children.Add(chkDbg);

            // Bottoni
            var btnRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0,0,0,20) };
            btnSave = Btn("Salva configurazione", accent, bg0);
            btnTest = Btn("Test connessione", bg2, text0);
            btnSave.Click += (s,e) => Save();
            btnTest.Click += (s,e) => Test();
            btnRow.Children.Add(btnSave);
            btnRow.Children.Add(new Border { Width = 10 });
            btnRow.Children.Add(btnTest);
            root.Children.Add(btnRow);

            // Separatore
            root.Children.Add(new Border { Height = 1, Background = border, Margin = new Thickness(0,0,0,16) });

            // Status
            root.Children.Add(new TextBlock { Text = "STATUS", FontSize = 10,
                Foreground = text2, Margin = new Thickness(0,0,0,10), FontWeight = FontWeights.Bold });

            tbConn   = Stat("Connessione");
            tbSent   = Stat("Trade inviati");
            tbFailed = Stat("Trade falliti");
            tbQueued = Stat("In coda");
            tbLast   = Stat("Ultimo invio");
            tbErr    = Stat("Ultimo errore");

            root.Children.Add(StatRow("Connessione", tbConn));
            root.Children.Add(StatRow("Trade inviati", tbSent));
            root.Children.Add(StatRow("Trade falliti", tbFailed));
            root.Children.Add(StatRow("In coda (retry)", tbQueued));
            root.Children.Add(StatRow("Ultimo invio", tbLast));
            root.Children.Add(StatRow("Ultimo errore", tbErr));

            // Help
            root.Children.Add(new Border { Height = 1, Background = border, Margin = new Thickness(0,16,0,12) });
            root.Children.Add(new TextBlock {
                Text = "URL endpoint e API key: AlphaDesk → Eseguiti → Sync → NinjaTrader",
                FontSize = 11, Foreground = text2, TextWrapping = TextWrapping.Wrap
            });

            Content = new ScrollViewer { Content = root, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };

            Refresh();

            // Aggiorna status ogni 5s
            var timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(5) };
            timer.Tick += (s,e) => Refresh();
            timer.Start();
        }

        private TextBlock Label(string t) => new TextBlock { Text = t, FontSize = 11,
            Foreground = text2, Margin = new Thickness(0,0,0,4) };

        private TextBox InputBox(string val) => new TextBox {
            Text = val, Background = bg2, Foreground = text0,
            BorderBrush = border, Padding = new Thickness(8,6,8,6),
            Margin = new Thickness(0,0,0,12), FontFamily = new FontFamily("Consolas"),
            FontSize = 12
        };

        private Button Btn(string label, SolidColorBrush bg, SolidColorBrush fg) => new Button {
            Content = label, Background = bg, Foreground = fg,
            Padding = new Thickness(14,8,14,8), BorderThickness = new Thickness(0),
            FontSize = 13, FontWeight = FontWeights.SemiBold, Cursor = System.Windows.Input.Cursors.Hand
        };

        private TextBlock Stat(string _) => new TextBlock { FontSize = 12, Foreground = text0 };

        private UIElement StatRow(string label, TextBlock value)
        {
            var row = new Grid { Margin = new Thickness(0,0,0,6) };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(140) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var lbl = new TextBlock { Text = label, Foreground = text2, FontSize = 12 };
            Grid.SetColumn(lbl, 0); Grid.SetColumn(value, 1);
            row.Children.Add(lbl); row.Children.Add(value);
            return row;
        }

        internal void Refresh()
        {
            bool conn = bridge.IsConn && bridge.IsConf;
            tbConn.Text = conn ? "✓ Connesso" : (bridge.IsConf ? "⚠ Disconnesso" : "Non configurato");
            tbConn.Foreground = conn ? green : red;
            tbSent.Text   = bridge.Sent.ToString();
            tbFailed.Text = bridge.Failed.ToString(); tbFailed.Foreground = bridge.Failed > 0 ? red : text0;
            tbQueued.Text = bridge.Queued.ToString(); tbQueued.Foreground = bridge.Queued > 0 ? red : text0;
            tbLast.Text   = bridge.LastSent.HasValue ? bridge.LastSent.Value.ToString("HH:mm:ss") : "—";
            tbErr.Text    = string.IsNullOrEmpty(bridge.LastErr) ? "—" : bridge.LastErr;
            tbErr.Foreground = string.IsNullOrEmpty(bridge.LastErr) ? text2 : red;
        }

        private void Save()
        {
            bridge.ApplySettings(tbEndpoint.Text, tbKey.Text,
                chkSim.IsChecked ?? true, chkDbg.IsChecked ?? false);
            btnSave.Content    = "✓ Salvato";
            btnSave.Background = green;
            var t = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };
            t.Tick += (s,e) => { btnSave.Content = "Salva configurazione"; btnSave.Background = accent; t.Stop(); };
            t.Start();
        }

        private void Test()
        {
            btnTest.Content = "Test in corso...";
            Task.Run(() => {
                bool ok = bridge.RunTest();
                Dispatcher.InvokeAsync(() => {
                    btnTest.Content    = ok ? "✓ Connesso!" : "✗ Fallito";
                    btnTest.Foreground = ok ? green : red;
                    Refresh();
                    var t = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };
                    t.Tick += (s,e) => { btnTest.Content = "Test connessione"; btnTest.Foreground = text0; t.Stop(); };
                    t.Start();
                });
            });
        }
    }
}
