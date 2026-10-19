// The Linux app, in a module of its own so its GUI dependencies (Wails, cgo with WebKitGTK) stay out
// of the CLI's module. It imports the CLI's packages through the replace below.
module flock/linux

go 1.27.2

require (
	flock v0.0.0
	github.com/wailsapp/wails/v3 v3.0.0-beta.32
)

require (
	github.com/adrg/xdg v0.5.3 // indirect
	github.com/coder/websocket v1.8.14 // indirect
	github.com/emersion/go-sasl v0.0.0-20241020182733-b788ff22d5a6 // indirect
	github.com/emersion/go-smtp v0.25.0 // indirect
	github.com/go-ole/go-ole v1.3.0 // indirect
	github.com/godbus/dbus/v5 v5.2.2 // indirect
	github.com/mattn/go-colorable v0.1.15 // indirect
	github.com/mattn/go-isatty v0.0.24 // indirect
	golang.org/x/sys v0.48.0 // indirect
)

replace flock => ../
