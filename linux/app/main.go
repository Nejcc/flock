// flock-app is Flock's tray app for Linux: the panel from the tray icon, and the Mail, Logs
// and Dumps windows, like the macOS menu bar app and the Windows tray app. The pages are plain HTML in
// frontend/; they reach the daemon's API at /api/ (passed on to its unix socket, as the CLI does)
// and ask this program for what a page can't do itself at /app/.
package main

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"flock/internal/api"
	"flock/internal/paths"
)

//go:embed frontend
var frontend embed.FS

//go:embed icons
var icons embed.FS

func icon(name string) []byte {
	data, _ := icons.ReadFile("icons/" + name + ".png")
	return data
}

// Windows the pages can open by name, with their size.
var windowSizes = map[string][2]int{
	"panel":    {380, 560},
	"mail":     {1100, 700},
	"logs":     {1000, 650},
	"dumps":    {920, 620},
	"settings": {980, 680},
	"setup":    {620, 600},
}

type flockApp struct {
	app     *application.App
	root    string
	windows map[string]*application.WebviewWindow

	mu      sync.Mutex
	pending *link // a flock:// link waiting for its Settings pane to ask about it
}

func main() {
	root, err := paths.Root()
	if err != nil {
		log.Fatal(err)
	}
	f := &flockApp{root: root, windows: map[string]*application.WebviewWindow{}}

	f.app = application.New(application.Options{
		Name:        "Flock",
		Description: "Local PHP development",
		Icon:        icon("AppIcon"),
		Assets:      application.AssetOptions{Handler: f.handler()},
		// The tray keeps running when every window is closed.
		Linux: application.LinuxOptions{ProgramName: "flock-app"},
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "dev.flock.app",
			// `flock-app mail` (e.g. from the .desktop file's actions) shows that window.
			OnSecondInstanceLaunch: func(d application.SecondInstanceData) {
				f.open(d.Args)
			},
		},
	})

	tray := f.app.SystemTray.New()
	tray.SetIcon(icon("TrayStopped.Dark"))
	tray.SetTooltip("Flock")
	tray.SetLabel("Flock")
	tray.OnClick(func() { f.toggle("panel") })

	menu := f.app.NewMenu()
	menu.Add("Open Flock").OnClick(func(*application.Context) { f.show("panel") })
	menu.Add("Mail").OnClick(func(*application.Context) { f.show("mail") })
	menu.Add("Logs").OnClick(func(*application.Context) { f.show("logs") })
	menu.Add("Dumps").OnClick(func(*application.Context) { f.show("dumps") })
	menu.Add("Settings…").OnClick(func(*application.Context) { f.show("settings") })
	menu.AddSeparator()
	menu.Add("Restart Flock").OnClick(func(*application.Context) { go f.restart() })
	menu.AddSeparator()
	menu.Add("Quit").OnClick(func(*application.Context) { f.app.Quit() })
	tray.SetMenu(menu)

	go f.watch(tray)

	// Started at login (the autostart entry passes --background), it waits in the tray.
	if !hasArg("--background") {
		f.app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) {
			f.open(os.Args[1:])
		})
	}
	if err := f.app.Run(); err != nil {
		log.Fatal(err)
	}
}

// open shows the window named on the command line (the panel without one), and the part of it
// named after that, e.g. `flock-app settings sites`. A flock:// link (the .desktop entry's %u)
// opens the Settings pane that asks about it.
func (f *flockApp) open(args []string) {
	for _, a := range args {
		if l, ok := parseLink(a); ok {
			// ponytail: flock://update only opens General; on Linux the package manager or
			// install.sh updates Flock.
			f.mu.Lock()
			f.pending = &l
			f.mu.Unlock()
			f.showSection("settings", l.pane())
			return
		}
	}
	for i, a := range args {
		if _, ok := windowSizes[a]; ok {
			section := ""
			if i+1 < len(args) && !strings.HasPrefix(args[i+1], "-") {
				section = args[i+1]
			}
			f.showSection(a, section)
			return
		}
	}
	// Until Flock is set up, the app leads to the setup.
	if _, err := os.Stat(f.flock()); err != nil {
		f.show("setup")
		return
	}
	f.show("panel")
}

func hasArg(arg string) bool {
	for _, a := range os.Args[1:] {
		if a == arg {
			return true
		}
	}
	return false
}

// window returns the named window, creating it hidden the first time. Closing a window hides it.
func (f *flockApp) window(name string) *application.WebviewWindow {
	if w := f.windows[name]; w != nil {
		return w
	}
	size := windowSizes[name]
	w := f.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:   name,
		Title:  title(name),
		Width:  size[0],
		Height: size[1],
		URL:    "/" + name + ".html",
		Hidden: true,
		// A fixed size makes tiling window managers (Hyprland, Sway) float the panel like a popup.
		DisableResize: name == "panel",
	})
	w.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		w.Hide()
		e.Cancel()
	})
	f.windows[name] = w
	return w
}

func title(name string) string {
	if name == "panel" {
		return "Flock"
	}
	return "Flock " + strings.ToUpper(name[:1]) + name[1:]
}

func (f *flockApp) show(name string) { f.showSection(name, "") }

// showSection shows a window at a part of its page (its URL's fragment, e.g. a Settings pane).
func (f *flockApp) showSection(name, section string) {
	created := f.windows[name] == nil
	w := f.window(name)
	if section != "" {
		if created {
			w.SetURL("/" + name + ".html#" + url.PathEscape(section))
		} else {
			w.ExecJS("location.hash = " + strconv.Quote(section))
		}
	}
	w.Show()
	w.Focus()
}

func (f *flockApp) toggle(name string) {
	if w := f.window(name); w.IsVisible() {
		w.Hide()
	} else {
		f.show(name)
	}
}

// watch keeps the tray icon and tooltip in step with the daemon, like the apps' status poll.
func (f *flockApp) watch(tray *application.SystemTray) {
	client := api.NewClient(paths.Socket(f.root))
	last := ""
	for {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		st, err := client.Status(ctx)
		cancel()

		state, tip := "Tray", "Flock — running · "+st.Version
		switch {
		case err != nil:
			state, tip = "TrayStopped", "Flock — not running"
		case len(st.Warnings) > 0:
			state, tip = "TrayWarning", "Flock — "+st.Warnings[0]
		}
		if state+tip != last {
			last = state + tip
			application.InvokeSync(func() {
				tray.SetIcon(icon(state + ".Dark"))
				tray.SetTooltip(tip)
				// ponytail: Wails ignores the tooltip on Linux (its StatusNotifierItem ToolTip is
				// fixed); the label is the item's Title, which some bars show instead.
				tray.SetLabel(tip)
			})
		}
		time.Sleep(2 * time.Second)
	}
}

// flock is the installed CLI, which `flock-php install` copies into Flock's folder. On Linux it is
// named flock-php: util-linux owns flock(1).
func (f *flockApp) flock() string { return filepath.Join(f.root, "bin", "flock-php") }

func (f *flockApp) restart() error {
	out, err := exec.Command(f.flock(), "restart").CombinedOutput()
	if err != nil {
		return errors.New(strings.TrimSpace(string(out)))
	}
	return nil
}

func (f *flockApp) handler() http.Handler {
	mux := http.NewServeMux()

	pages, _ := fs.Sub(frontend, "frontend")
	mux.Handle("/", http.FileServerFS(pages))

	// The daemon's API, through its unix socket (no token needed: only this user can reach it).
	socket := paths.Socket(f.root)
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", socket)
		},
	}
	daemon := &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(&url.URL{Scheme: "http", Host: "flockd"})
			r.Out.URL.Path = strings.TrimPrefix(r.In.URL.Path, "/api")
		},
		Transport: transport,
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, err error) {
			http.Error(w, `{"error":"Flock isn't running"}`, http.StatusBadGateway)
		},
	}
	mux.Handle("/api/", daemon)

	mux.HandleFunc("GET /app/installed", func(w http.ResponseWriter, _ *http.Request) {
		if _, err := os.Stat(f.flock()); err != nil {
			w.WriteHeader(http.StatusNotFound)
		}
	})
	mux.HandleFunc("POST /app/open", func(w http.ResponseWriter, r *http.Request) {
		u := r.URL.Query().Get("url")
		// Web and mail links, and the editor links of the Dumps window (xdg-open hands them on).
		scheme, _, _ := strings.Cut(u, ":")
		switch strings.ToLower(scheme) {
		case "http", "https", "mailto", "phpstorm", "vscode", "cursor", "zed":
		default:
			http.Error(w, "only web and editor links open", http.StatusBadRequest)
			return
		}
		_ = f.app.Browser.OpenURL(u)
	})
	mux.HandleFunc("POST /app/folder", func(w http.ResponseWriter, r *http.Request) {
		_ = exec.Command("xdg-open", r.URL.Query().Get("path")).Start()
	})
	// A mail attachment, saved where the user picks.
	mux.HandleFunc("POST /app/save-attachment", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		var dest string
		var err error
		application.InvokeSync(func() {
			dest, err = f.app.Dialog.SaveFile().SetFilename(filepath.Base(q.Get("name"))).PromptForSingleSelection()
		})
		if err != nil || dest == "" {
			return
		}
		resp, err := (&http.Client{Transport: transport}).Get("http://flockd/v1/mail/" +
			url.PathEscape(q.Get("id")) + "/attachments/" + url.PathEscape(q.Get("index")))
		if err == nil && resp.StatusCode != http.StatusOK {
			err = errors.New(resp.Status)
		}
		if err == nil {
			defer resp.Body.Close()
			var out *os.File
			if out, err = os.Create(dest); err == nil {
				_, err = io.Copy(out, resp.Body)
				if cerr := out.Close(); err == nil {
					err = cerr
				}
			}
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
	})
	// A folder the user picks (Add Site, project folders); the response is its path, or empty.
	mux.HandleFunc("POST /app/pick-folder", func(w http.ResponseWriter, r *http.Request) {
		var dir string
		application.InvokeSync(func() {
			dir, _ = f.app.Dialog.OpenFile().CanChooseDirectories(true).CanChooseFiles(false).
				SetTitle(r.URL.Query().Get("title")).PromptForSingleSelection()
		})
		_, _ = w.Write([]byte(dir))
	})
	// Open at login: an XDG autostart entry that starts the app in the tray.
	mux.HandleFunc("GET /app/autostart", func(w http.ResponseWriter, _ *http.Request) {
		if _, err := os.Stat(autostartFile()); err != nil {
			w.WriteHeader(http.StatusNotFound)
		}
	})
	mux.HandleFunc("POST /app/autostart", func(w http.ResponseWriter, r *http.Request) {
		var err error
		if r.URL.Query().Get("on") == "1" {
			err = writeAutostart()
		} else if err = os.Remove(autostartFile()); errors.Is(err, os.ErrNotExist) {
			err = nil
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
	})
	mux.HandleFunc("POST /app/window/{name}", func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		if _, ok := windowSizes[name]; !ok {
			http.NotFound(w, r)
			return
		}
		application.InvokeSync(func() { f.show(name) })
	})
	mux.HandleFunc("POST /app/restart", func(w http.ResponseWriter, _ *http.Request) {
		if err := f.restart(); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
	})
	mux.HandleFunc("POST /app/quit", func(http.ResponseWriter, *http.Request) { f.app.Quit() })
	f.setupRoutes(mux)
	// The pending flock:// link, taken by the pane that asks about it (?pane=services, ...).
	mux.HandleFunc("POST /app/pending-link", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		l := f.pending
		if l == nil || l.pane() != r.URL.Query().Get("pane") {
			f.mu.Unlock()
			w.WriteHeader(http.StatusNoContent)
			return
		}
		f.pending = nil
		f.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(l)
	})
	return mux
}

func autostartFile() string {
	dir, _ := os.UserConfigDir()
	return filepath.Join(dir, "autostart", "flock-app.desktop")
}

func writeAutostart() error {
	self, err := os.Executable()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(autostartFile()), 0o755); err != nil {
		return err
	}
	entry := "[Desktop Entry]\nType=Application\nName=Flock\nComment=Local PHP development\n" +
		"Exec=\"" + self + "\" --background\nIcon=flock-app\nX-GNOME-Autostart-enabled=true\n"
	return os.WriteFile(autostartFile(), []byte(entry), 0o644)
}
