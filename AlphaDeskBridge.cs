// AlphaDesk Bridge v1.1 — NinjaTrader 8 Add-On
// Copia in: Documenti\NinjaTrader 8\bin\Custom\AddOns\
// Compila con F5 nel NinjaScript Editor, poi riavvia NT8.
// In NT8 trovi "AlphaDesk Bridge" nel menu Strumenti.

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
        private string apiEndpoint   = "";
        private string apiKey        = "";
        private bool   sendSimulated = true;
        private bool   debugMode     = false;
        private int    maxRetries    = 3;

        private bool   isConfigured  = false;
        private bool   isConnected   = false;
        private string lastError     = "";
        private int    tradesSent    = 0;
        private int    tradesFailed  = 0;
        private DateTime? lastTradeSent;

        private string configPath = "";
        private string logPath    = "";

        private Queue<string>          failedQueue   = new Queue<string>();
        private object                 lockObj       = new object();
        private HashSet<string>        sentIds       = new HashSet<string>();
        private Dictionary<string,int> tradeCounters = new Dictionary<string,int>();
        private System.Threading.Timer retryTimer;

        private AlphaDeskWindow statusWindow;

        protected override void OnStateChange()
        {
            if (State == State.SetDefaults)
            {
                Description = "AlphaDesk Bridge — invia trade a AlphaDesk in tempo reale";
                Name        = "AlphaDeskBridge";
            }
            else if (State == State.Active)
            {
                string ntFolder = System.IO.Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
                    "NinjaTrader 8"
                );
                configPath = System.IO.Path.Combine(ntFolder, "AlphaDeskBridge.config.json");
                logPath    = System.IO.Path.Combine(ntFolder, "AlphaDeskBridge.log");

                LoadConfig();
                if (isConfigured) SubscribeToAccounts();

                retryTimer = new System.Threading.Timer(RetryFailed, null,
                    TimeSpan.FromMinutes(5), TimeSpan.FromMinutes(5));

                Log("AlphaDesk Bridge avviato. Endpoint: " +
                    (apiEndpoint.Length > 0 ? apiEndpoint : "NON CONFIGURATO"));
            }
            else if (State == State.Terminated)
            {
                retryTimer?.Dispose();
                UnsubscribeFromAccounts();
            }
        }

        // ── Configurazione ──────────────────────────────────────────────────
        private void LoadConfig()
        {
            if (!File.Exists(configPath))
            {
                WriteDefaultConfig();
                isConfigured = false;
                lastError = "Inserisci URL e API key nel pannello AlphaDesk Bridge (menu Strumenti di NT8)";
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

                if (!isConfigured) lastError = "Endpoint o ApiKey mancanti nel file di configurazione";
                else lastError = "";
            }
            catch (Exception ex) { lastError = ex.Message; isConfigured = false; }
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
            catch (Exception ex) { Log("Errore salvataggio config: " + ex.Message); }
        }

        private void WriteDefaultConfig()
        {
            try
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
            catch { }
        }

        // ── Gestione account e trade ────────────────────────────────────────
        private void SubscribeToAccounts()
        {
            lock (lockObj)
            {
                foreach (Account acc in Account.All)
                {
                    acc.TradeCollection.TradeAdded += OnTradeAdded;
                }
            }
        }

        private void UnsubscribeFromAccounts()
        {
            try
            {
                foreach (Account acc in Account.All)
                {
                    acc.TradeCollection.TradeAdded -= OnTradeAdded;
                }
            }
            catch { }
        }

        private void OnTradeAdded(object sender, TradeCollectionEventArgs e)
        {
            try
            {
                if (!isConfigured) return;

                Trade   trade   = e.Trade;
                Account account = sender as Account;
                if (account == null || trade == null) return;

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
                    if (!tradeCounters.ContainsKey(account.Name))
                        tradeCounters[account.Name] = 0;
                    tradeCounters[account.Name]++;
                }

                var info = new PendingInfo
                {
                    Trade  = trade,
                    Account = account,
                    Num    = tradeCounters[account.Name],
                    IsSim  = isSim
                };

                // Delay 1s per permettere a NT8 di completare i calcoli
                System.Threading.Timer t = null;
                t = new System.Threading.Timer(state =>
                {
                    try { BuildAndSend((PendingInfo)state); }
                    catch (Exception ex) { Log("Errore BuildAndSend: " + ex.Message); }
                    finally { t?.Dispose(); }
                }, info, 1000, Timeout.Infinite);
            }
            catch (Exception ex) { Log("Errore OnTradeAdded: " + ex.Message); }
        }

        private void BuildAndSend(PendingInfo info)
        {
            Trade   trade   = info.Trade;
            Account account = info.Account;

            MasterInstrument mi        = trade.Entry.Instrument.MasterInstrument;
            double           pointValue = mi.PointValue;
            double           tickSize   = mi.TickSize;
            double           tickValue  = pointValue * tickSize;
            double           exitRate   = trade.Exit.Rate > 0 ? trade.Exit.Rate : 1.0;

            double profitGross = trade.ProfitCurrency / exitRate;
            double maeAcc      = trade.MaeCurrency;
            double mfeAcc      = trade.MfeCurrency;

            double etd = 0;
            if (mfeAcc > 0)
            {
                etd = profitGross >= 0
                    ? mfeAcc - profitGross
                    : mfeAcc + Math.Abs(profitGross);
                if (etd < 0) etd = 0;
            }

            var sb = new StringBuilder();
            sb.Append("{");
            AppendStr(sb, "source",           "AlphaDeskBridge");
            AppendNum(sb, "trade_number",     info.Num);
            AppendStr(sb, "account",          account.Name);
            AppendStr(sb, "instrument",       trade.Entry.Instrument.FullName);
            AppendStr(sb, "instrument_base",  mi.Name);
            AppendStr(sb, "market_position",  trade.Entry.MarketPosition.ToString());
            AppendNum(sb, "quantity",         trade.Quantity);
            AppendBool(sb,"is_simulated",     info.IsSim);
            AppendNum(sb, "entry_price",      trade.Entry.Price);
            AppendNum(sb, "exit_price",       trade.Exit.Price);
            AppendStr(sb, "entry_time",       trade.Entry.Time.ToString("yyyy-MM-ddTHH:mm:ss"));
            AppendStr(sb, "exit_time",        trade.Exit.Time.ToString("yyyy-MM-ddTHH:mm:ss"));
            AppendStr(sb, "entry_name",       trade.Entry.Name ?? "");
            AppendStr(sb, "exit_name",        trade.Exit.Name ?? "");
            AppendNum(sb, "profit_gross",     Math.Round(profitGross, 2));
            AppendNum(sb, "profit_net",       Math.Round(profitGross, 2));
            AppendNum(sb, "profit_ticks",     trade.ProfitTicks);
            AppendNum(sb, "profit_points",    trade.ProfitPoints);
            AppendNum(sb, "mae_account_currency", Math.Round(maeAcc, 2));
            AppendNum(sb, "mae_ticks",        trade.MaeTicks);
            AppendNum(sb, "mfe_account_currency", Math.Round(mfeAcc, 2));
            AppendNum(sb, "mfe_ticks",        trade.MfeTicks);
            AppendNum(sb, "etd_account_currency", Math.Round(etd, 2));
            AppendNum(sb, "entry_efficiency", Math.Round(trade.EntryEfficiency, 4));
            AppendNum(sb, "exit_efficiency",  Math.Round(trade.ExitEfficiency, 4));
            AppendNum(sb, "total_efficiency", Math.Round(trade.TotalEfficiency, 4));
            AppendNum(sb, "point_value",      pointValue);
            AppendNum(sb, "tick_size",        tickSize);
            AppendNum(sb, "tick_value",       tickValue);
            AppendStr(sb, "nt_version",       NinjaTrader.Core.Globals.NinjaTraderVersion.ToString());
            // Rimuovi ultima virgola e chiudi
            string json = sb.ToString().TrimEnd(',') + "}";

            if (debugMode) Log("JSON: " + json);
            SendToAlphaDesk(json);
        }

        private void AppendStr(StringBuilder sb, string key, string val)
        {
            sb.Append("\"" + key + "\":\"" + (val ?? "").Replace("\"","\\\"") + "\",");
        }
        private void AppendNum(StringBuilder sb, string key, double val)
        {
            sb.Append("\"" + key + "\":" + val.ToString("G", System.Globalization.CultureInfo.InvariantCulture) + ",");
        }
        private void AppendBool(StringBuilder sb, string key, bool val)
        {
            sb.Append("\"" + key + "\":" + (val ? "true" : "false") + ",");
        }

        // ── Invio HTTP ──────────────────────────────────────────────────────
        private void SendToAlphaDesk(string json)
        {
            for (int attempt = 1; attempt <= maxRetries; attempt++)
            {
                try
                {
                    byte[]         data = Encoding.UTF8.GetBytes(json);
                    HttpWebRequest req  = (HttpWebRequest)WebRequest.Create(apiEndpoint);
                    req.Method          = "POST";
                    req.ContentType     = "application/json; charset=utf-8";
                    req.ContentLength   = data.Length;
                    req.Timeout         = 10000;
                    req.Headers.Add("X-API-Key", apiKey);
                    req.Headers.Add("User-Agent", "AlphaDeskBridge/1.1 NT8");

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
                            Log("Trade inviato con successo (tentativo " + attempt + ")");
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

        // ── Test connessione ────────────────────────────────────────────────
        internal bool TestConnection()
        {
            if (!isConfigured) return false;
            try
            {
                string         testUrl = apiEndpoint + "?ping=1";
                HttpWebRequest req     = (HttpWebRequest)WebRequest.Create(testUrl);
                req.Method  = "GET";
                req.Timeout = 8000;
                req.Headers.Add("X-API-Key", apiKey);
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                {
                    isConnected = (res.StatusCode == HttpStatusCode.OK);
                    lastError   = isConnected ? "" : "HTTP " + res.StatusCode;
                }
            }
            catch (Exception ex) { isConnected = false; lastError = ex.Message; }
            return isConnected;
        }

        // ── UI ──────────────────────────────────────────────────────────────
        protected override void OnWindowCreated(Window window)
        {
            try
            {
                var menuStrip = FindMenu(window);
                if (menuStrip == null) return;

                var item = new MenuItem { Header = "AlphaDesk Bridge" };
                item.Click += (s, e) => ShowWindow();
                menuStrip.Items.Add(item);
            }
            catch { }
        }

        private Menu FindMenu(DependencyObject parent)
        {
            if (parent == null) return null;
            if (parent is Menu m) return m;
            for (int i = 0; i < System.Windows.Media.VisualTreeHelper.GetChildrenCount(parent); i++)
            {
                var child = System.Windows.Media.VisualTreeHelper.GetChild(parent, i);
                var result = FindMenu(child);
                if (result != null) return result;
            }
            return null;
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
            try
            {
                if (statusWindow == null || !statusWindow.IsLoaded) return;
                Application.Current?.Dispatcher?.InvokeAsync(() => statusWindow.Refresh());
            }
            catch { }
        }

        // Getter per la finestra
        internal string  Endpoint    => apiEndpoint;
        internal string  ApiKeyVal   => apiKey;
        internal bool    SendSim     => sendSimulated;
        internal bool    DbgMode     => debugMode;
        internal bool    IsConn      => isConnected;
        internal bool    IsConf      => isConfigured;
        internal string  LastErr     => lastError;
        internal int     Sent        => tradesSent;
        internal int     Failed      => tradesFailed;
        internal int     Queued      { get { lock(lockObj) return failedQueue.Count; } }
        internal DateTime? LastSent  => lastTradeSent;

        internal void ApplySettings(string endpoint, string key, bool sim, bool dbg)
        {
            apiEndpoint   = endpoint.Trim();
            apiKey        = key.Trim();
            sendSimulated = sim;
            debugMode     = dbg;
            isConfigured  = !string.IsNullOrEmpty(apiEndpoint) &&
                            !string.IsNullOrEmpty(apiKey) &&
                            apiKey != "INCOLLA_LA_TUA_CHIAVE_API";
            SaveConfig();
            if (isConfigured)
            {
                UnsubscribeFromAccounts();
                SubscribeToAccounts();
            }
            Log("Configurazione aggiornata.");
            UpdateUI();
        }

        // ── Utility ─────────────────────────────────────────────────────────
        private void Log(string msg)
        {
            try
            {
                File.AppendAllText(logPath,
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + msg + "\n",
                    Encoding.UTF8);
            }
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

        private class PendingInfo
        {
            public Trade   Trade;
            public Account Account;
            public int     Num;
            public bool    IsSim;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Finestra UI
    // ═══════════════════════════════════════════════════════════════════════
    internal class AlphaDeskWindow : Window
    {
        private AlphaDeskBridge bridge;
        private TextBox   tbEndpoint, tbKey;
        private CheckBox  chkSim, chkDbg;
        private TextBlock tbConn, tbSent, tbFailed, tbQueued, tbLast, tbErr;

        private static SolidColorBrush accent = new SolidColorBrush(Color.FromRgb(0, 212, 170));
        private static SolidColorBrush bg0    = new SolidColorBrush(Color.FromRgb(8, 11, 15));
        private static SolidColorBrush bg2    = new SolidColorBrush(Color.FromRgb(18, 24, 32));
        private static SolidColorBrush bord   = new SolidColorBrush(Color.FromRgb(30, 42, 56));
        private static SolidColorBrush txt0   = new SolidColorBrush(Colors.White);
        private static SolidColorBrush txt2   = new SolidColorBrush(Color.FromRgb(100, 130, 160));
        private static SolidColorBrush green  = new SolidColorBrush(Color.FromRgb(0, 212, 170));
        private static SolidColorBrush red    = new SolidColorBrush(Color.FromRgb(255, 77, 109));

        internal AlphaDeskWindow(AlphaDeskBridge b)
        {
            bridge         = b;
            Title          = "AlphaDesk Bridge";
            Width          = 480;
            Height         = 540;
            ResizeMode     = ResizeMode.CanMinimize;
            Background     = bg0;
            Foreground     = txt0;
            FontFamily     = new System.Windows.Media.FontFamily("Segoe UI");

            var root = new StackPanel { Margin = new Thickness(20) };

            // Titolo
            root.Children.Add(new TextBlock
            {
                Text = "Alpha Desk  Bridge",
                FontSize = 20, FontWeight = FontWeights.Bold,
                Foreground = accent, Margin = new Thickness(0, 0, 0, 4)
            });
            root.Children.Add(new TextBlock
            {
                Text = "Invia ogni trade a AlphaDesk in tempo reale",
                FontSize = 12, Foreground = txt2, Margin = new Thickness(0, 0, 0, 20)
            });

            // Endpoint
            root.Children.Add(Lbl("Endpoint URL (da AlphaDesk → Eseguiti → Sync → NinjaTrader)"));
            tbEndpoint = Inp(b.Endpoint);
            root.Children.Add(tbEndpoint);

            // API Key
            root.Children.Add(Lbl("API Key (genera su AlphaDesk → Eseguiti → Sync → NinjaTrader → Step 3)"));
            tbKey = Inp(b.ApiKeyVal);
            root.Children.Add(tbKey);

            // Opzioni
            chkSim = new CheckBox
            {
                Content = "Invia anche trade simulati (Sim101 ecc.)",
                IsChecked = b.SendSim, Foreground = txt0,
                Margin = new Thickness(0, 8, 0, 4)
            };
            chkDbg = new CheckBox
            {
                Content = "Debug mode (log dettagliato in AlphaDeskBridge.log)",
                IsChecked = b.DbgMode, Foreground = txt2,
                Margin = new Thickness(0, 0, 0, 16)
            };
            root.Children.Add(chkSim);
            root.Children.Add(chkDbg);

            // Bottoni
            var btnRow = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Margin = new Thickness(0, 0, 0, 20)
            };
            var btnSave = MakeBtn("Salva configurazione", accent, bg0, true);
            var btnTest = MakeBtn("Test connessione", bg2, txt0, false);
            btnSave.Click += (s, e) => Save(btnSave);
            btnTest.Click += (s, e) => Test(btnTest);
            btnRow.Children.Add(btnSave);
            btnRow.Children.Add(new Border { Width = 10 });
            btnRow.Children.Add(btnTest);
            root.Children.Add(btnRow);

            // Separatore
            root.Children.Add(new Border
            {
                Height = 1, Background = bord,
                Margin = new Thickness(0, 0, 0, 16)
            });

            // Status
            root.Children.Add(new TextBlock
            {
                Text = "STATUS IN TEMPO REALE",
                FontSize = 10, Foreground = txt2,
                Margin = new Thickness(0, 0, 0, 10),
                FontWeight = FontWeights.Bold
            });

            tbConn   = new TextBlock { FontSize = 12 };
            tbSent   = new TextBlock { FontSize = 12, Foreground = txt0 };
            tbFailed = new TextBlock { FontSize = 12 };
            tbQueued = new TextBlock { FontSize = 12 };
            tbLast   = new TextBlock { FontSize = 12, Foreground = txt0 };
            tbErr    = new TextBlock { FontSize = 12, TextWrapping = TextWrapping.Wrap };

            root.Children.Add(Row("Connessione",     tbConn));
            root.Children.Add(Row("Trade inviati",   tbSent));
            root.Children.Add(Row("Trade falliti",   tbFailed));
            root.Children.Add(Row("In coda (retry)", tbQueued));
            root.Children.Add(Row("Ultimo invio",    tbLast));
            root.Children.Add(Row("Ultimo errore",   tbErr));

            // Note
            root.Children.Add(new Border { Height = 1, Background = bord, Margin = new Thickness(0, 16, 0, 12) });
            root.Children.Add(new TextBlock
            {
                Text = "Il file di configurazione viene salvato in:\nDocumenti\\NinjaTrader 8\\AlphaDeskBridge.config.json",
                FontSize = 11, Foreground = txt2, TextWrapping = TextWrapping.Wrap
            });

            Content = new ScrollViewer
            {
                Content = root,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto
            };

            Refresh();

            var timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(5) };
            timer.Tick += (s, e) => Refresh();
            timer.Start();
        }

        private TextBlock Lbl(string t) => new TextBlock
        {
            Text = t, FontSize = 11, Foreground = txt2,
            Margin = new Thickness(0, 0, 0, 4), TextWrapping = TextWrapping.Wrap
        };

        private TextBox Inp(string val) => new TextBox
        {
            Text = val ?? "", Background = bg2, Foreground = txt0,
            BorderBrush = bord, Padding = new Thickness(8, 6, 8, 6),
            Margin = new Thickness(0, 0, 0, 12),
            FontFamily = new System.Windows.Media.FontFamily("Consolas"),
            FontSize = 12
        };

        private Button MakeBtn(string label, SolidColorBrush bg, SolidColorBrush fg, bool bold) => new Button
        {
            Content = label, Background = bg, Foreground = fg,
            Padding = new Thickness(14, 8, 14, 8),
            BorderThickness = new Thickness(0),
            FontSize = 13,
            FontWeight = bold ? FontWeights.SemiBold : FontWeights.Normal,
            Cursor = System.Windows.Input.Cursors.Hand
        };

        private UIElement Row(string label, TextBlock value)
        {
            var g = new Grid { Margin = new Thickness(0, 0, 0, 6) };
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(140) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var lbl = new TextBlock { Text = label, Foreground = txt2, FontSize = 12 };
            Grid.SetColumn(lbl, 0);
            Grid.SetColumn(value, 1);
            g.Children.Add(lbl);
            g.Children.Add(value);
            return g;
        }

        internal void Refresh()
        {
            bool conn = bridge.IsConn && bridge.IsConf;
            tbConn.Text       = conn ? "✓ Connesso ad AlphaDesk"
                              : bridge.IsConf ? "⚠ Non connesso (usa Test connessione)"
                              : "✗ Non configurato — inserisci URL e API Key";
            tbConn.Foreground = conn ? green : red;

            tbSent.Text = bridge.Sent.ToString() + " trade inviati con successo";

            tbFailed.Text      = bridge.Failed > 0 ? bridge.Failed + " falliti" : "0";
            tbFailed.Foreground = bridge.Failed > 0 ? red : txt2;

            tbQueued.Text      = bridge.Queued > 0 ? bridge.Queued + " in attesa di retry" : "0";
            tbQueued.Foreground = bridge.Queued > 0 ? red : txt2;

            tbLast.Text = bridge.LastSent.HasValue
                ? bridge.LastSent.Value.ToString("dd/MM/yyyy HH:mm:ss")
                : "— nessun trade inviato ancora";

            tbErr.Text       = string.IsNullOrEmpty(bridge.LastErr) ? "—" : bridge.LastErr;
            tbErr.Foreground = string.IsNullOrEmpty(bridge.LastErr) ? txt2 : red;
        }

        private void Save(Button btn)
        {
            bridge.ApplySettings(
                tbEndpoint.Text,
                tbKey.Text,
                chkSim.IsChecked ?? true,
                chkDbg.IsChecked ?? false
            );
            btn.Content    = "✓ Configurazione salvata!";
            btn.Background = green;
            var t = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };
            t.Tick += (s, e) =>
            {
                btn.Content    = "Salva configurazione";
                btn.Background = accent;
                t.Stop();
            };
            t.Start();
            Refresh();
        }

        private void Test(Button btn)
        {
            btn.Content = "Test in corso...";
            System.Threading.ThreadPool.QueueUserWorkItem(_ =>
            {
                bool ok = bridge.TestConnection();
                Dispatcher.InvokeAsync(() =>
                {
                    btn.Content    = ok ? "✓ Connesso!" : "✗ Connessione fallita";
                    btn.Foreground = ok ? green : red;
                    Refresh();
                    var t = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
                    t.Tick += (s, e) =>
                    {
                        btn.Content    = "Test connessione";
                        btn.Foreground = txt0;
                        t.Stop();
                    };
                    t.Start();
                });
            });
        }
    }
}
