package web

import "embed"

// Assets contains the complete browser UI, including feature subdirectories.
//
//go:embed index.html app.html terminal.html browser-login.html *.ico *.png *.svg core features chat ui
var Assets embed.FS
