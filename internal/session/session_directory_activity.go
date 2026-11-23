package session

import (
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"worktree-hub/internal/execution"
	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
	"worktree-hub/internal/platform"
	"worktree-hub/internal/project"
)

type directoryReservation struct {
	session string
	dirs    []string
}

type configuredDirectory struct {
	id        string
	access    string
	updatedAt int64
}

type fileSnapshot struct {
	files map[string]string
	err   string
	git   bool
}

func writableRoots(plan model.LaunchPlan) []string {
	if !plan.ManagedBindings {
		return uniqueDirectories(append([]string{plan.Cwd}, plan.AdditionalDirectories...))
	}
	dirs := []string{}
	for _, b := range plan.Bindings {
		if b.Access == model.SessionBindingWrite {
			dirs = append(dirs, b.Directory)
		}
	}
	return dirs
}

func (a *Service) directoryConflicts(path, own string) []directoryConflict {
	a.directoryStarts.Lock()
	defer a.directoryStarts.Unlock()
	return a.directoryConflictsLocked(path, own)
}

func (a *Service) directoryConflictsLocked(path, own string) []directoryConflict {
	items := []directoryConflict{}
	seen := map[string]bool{}
	add := func(id, name string, roots []string) {
		if id == own || seen[id] {
			return
		}
		for _, root := range roots {
			if sameOrNested(root, path) {
				seen[id] = true
				items = append(items, directoryConflict{ID: id, Name: name, Cwd: root})
				break
			}
		}
	}
	for id, next := range a.directoryReservations {
		if next.session != own || own == "" {
			add(id, "正在启动的对话", next.dirs)
		}
	}
	a.chatMu.Lock()
	for id, run := range a.chats {
		if id == own {
			continue
		}
		run.mu.Lock()
		if run.state.Busy {
			roots := run.writeRoots
			if roots == nil {
				roots = []string{run.cwd}
			}
			add(id, run.state.SessionName, roots)
		}
		run.mu.Unlock()
	}
	a.chatMu.Unlock()
	a.bridgeMu.Lock()
	for _, b := range a.bridges {
		b.mu.Lock()
		if !b.revoked {
			id := b.session
			if id == "" {
				id = b.socket
			}
			add(id, "Codex 终端", append([]string{b.cwd}, b.additionalDirectories...))
		}
		b.mu.Unlock()
	}
	a.bridgeMu.Unlock()
	// Native discovery carries actual provider-reported active states from
	// the visible session catalog. Expired metadata cannot block a new run.
	a.catalogMu.Lock()
	for _, entry := range a.catalogs {
		select {
		case <-entry.done:
			if time.Since(entry.updated) < 10*time.Second {
				for _, s := range entry.found {
					if s.Status.Type == "active" {
						add(s.ID, sessionName(s), []string{s.Cwd})
					}
				}
			}
		default:
		}
	}
	a.catalogMu.Unlock()
	sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
	return items
}

func (a *Service) reserveDirectories(id, session string, plan model.LaunchPlan) (func(), []directoryConflict) {
	a.directoryStarts.Lock()
	defer a.directoryStarts.Unlock()
	roots := writableRoots(plan)
	if !plan.AllowShared {
		for _, root := range roots {
			shared := false
			for _, path := range plan.SharedDirectories {
				shared = shared || platform.SameWorkspacePath(path, root)
			}
			if !shared {
				if conflicts := a.directoryConflictsLocked(root, session); len(conflicts) > 0 {
					return nil, conflicts
				}
			}
		}
	}
	if a.directoryReservations == nil {
		a.directoryReservations = map[string]directoryReservation{}
	}
	a.directoryReservations[id] = directoryReservation{session: session, dirs: roots}
	return func() {
		a.directoryStarts.Lock()
		delete(a.directoryReservations, id)
		a.directoryStarts.Unlock()
	}, nil
}

func writeBindingConflict(w http.ResponseWriter, conflicts []directoryConflict) {
	httpx.WriteJSON(w, 409, map[string]any{"error": "另一个 Agent 正在修改重叠的目录。请创建独立 Worktree，或确认共享当前目录。", "code": "directory_conflict", "conflicts": conflicts})
}

func collectDirectorySnapshot(ctx context.Context, dir string) fileSnapshot {
	snapshot := fileSnapshot{files: map[string]string{}}
	top, err := execution.Git(ctx, dir, "rev-parse", "--show-toplevel")
	if err == nil && platform.SameWorkspacePath(dir, strings.TrimSpace(top)) {
		snapshot.git = true
		files, err := project.ReadDirectoryChanges(ctx, dir)
		if err != nil {
			snapshot.err = err.Error()
			return snapshot
		}
		if len(files) > 512 {
			snapshot.err = "目录中有超过 512 个待处理文件，仅监测其中一部分"
			files = files[:512]
		}
		index := map[string]string{}
		if len(files) != 0 {
			args := []string{"--literal-pathspecs", "ls-files", "--stage", "-z", "--"}
			for _, f := range files {
				args = append(args, f.Path)
			}
			raw, err := execution.Git(ctx, dir, args...)
			if err != nil {
				snapshot.err = err.Error()
				return snapshot
			}
			for _, row := range strings.Split(raw, "\x00") {
				entry, path, ok := strings.Cut(row, "\t")
				if ok {
					index[path] += entry
				}
			}
		}
		for _, f := range files {
			if ctx.Err() != nil {
				snapshot.err = ctx.Err().Error()
				return snapshot
			}
			signature := f.Index + f.Working + f.Previous + index[f.Path]
			if info, err := execution.Stat(ctx, platform.JoinWorkspacePath(dir, f.Path), false); err == nil {
				signature += fmt.Sprintf(":%d:%d", info.Size(), info.ModTime().UnixNano())
				if info.Mode().IsRegular() && info.Size() < 64<<10 {
					if preview, err := execution.BrowseWorkspace(ctx, dir, f.Path, true); err == nil {
						signature += fmt.Sprintf(":%x", sha256.Sum256([]byte(fmt.Sprint(preview))))
					}
				}
			}
			snapshot.files[f.Path] = signature
		}

		return snapshot
	}
	if execution.RemoteClient(ctx) != nil {
		snapshot.err = "远程非 Git 目录仅显示 Agent 原生事件"
		return snapshot
	}
	count := 0
	err = filepath.WalkDir(dir, func(path string, entry os.DirEntry, err error) error {
		if err != nil || ctx.Err() != nil {
			if err == nil {
				err = ctx.Err()
			}
			return err
		}
		if entry.IsDir() {
			if path != dir && (entry.Name() == ".git" || entry.Name() == "node_modules") {
				return filepath.SkipDir
			}
			return nil
		}
		count++
		if count > 4000 {
			return fmt.Errorf("非 Git 目录已达到监测上限（4000 个文件）")
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		value := fmt.Sprintf("%d:%d", info.Size(), info.ModTime().UnixNano())
		if info.Size() < 64<<10 {
			file, err := os.Open(path)
			if err == nil {
				digest := sha256.New()
				_, err = io.Copy(digest, io.LimitReader(file, 64<<10))
				_ = file.Close()
				if err == nil {
					value += fmt.Sprintf(":%x", digest.Sum(nil))
				}
			}
		}
		snapshot.files[filepath.ToSlash(rel)] = value
		return nil
	})
	if err != nil {
		snapshot.err = err.Error()
	}
	return snapshot
}

func (a *Service) captureRunDirectories(ctx context.Context, run *ChatRun, bindings []model.SessionProjectBinding) {
	ctx = execution.WithClient(ctx, a.Execution.Remote)
	baseline := map[string]fileSnapshot{}
	for _, binding := range bindings {
		baseline[binding.Directory] = collectDirectorySnapshot(ctx, binding.Directory)
	}
	run.mu.Lock()
	run.baseline = baseline
	run.mu.Unlock()
}

func (a *Service) freezeRunDirectories(run *ChatRun) {
	run.mu.Lock()
	paths := make([]string, 0, len(run.baseline))
	for dir := range run.baseline {
		paths = append(paths, dir)
	}
	run.mu.Unlock()
	if len(paths) == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(execution.WithClient(context.Background(), a.Execution.Remote), 2*time.Second)
	defer cancel()
	final := map[string]fileSnapshot{}
	for _, dir := range paths {
		final[dir] = collectDirectorySnapshot(ctx, dir)
	}
	run.mu.Lock()
	run.finalSnapshots = final
	run.mu.Unlock()
}

func changedSince(before, after fileSnapshot) []string {
	files := []string{}
	for path, value := range after.files {
		if original, ok := before.files[path]; !ok || original != value {
			files = append(files, path)
		}
	}
	for path := range before.files {
		if _, ok := after.files[path]; !ok {
			files = append(files, path)
		}
	}
	sort.Strings(files)
	return files
}

func (a *Service) decorateBindingRuntime(ctx context.Context, record model.Session, v *bindingView) {
	provider := model.NormalizeProvider(record.Provider)
	if provider == model.ProviderAgy {
		v.Status = "unsupported"
		v.Warning = "Antigravity 无法强制独立目录权限。请使用 Codex 执行多目录操作。"
	}
	run := a.ChatFor(record.ID)
	if run == nil {
		return
	}
	run.mu.Lock()
	state := run.state
	entries := append([]HistoryEntry(nil), state.Entries...)
	configured := run.configured[v.Directory]
	configError := run.directoryError
	baseline, baselineOK := run.baseline[v.Directory]
	after, final := run.finalSnapshots[v.Directory]
	starting := state.Busy && state.Status == "starting"
	configuring := false
	if starting {
		for _, dir := range run.directoryRoots {
			configuring = configuring || platform.SameWorkspacePath(dir, v.Directory)
		}
	}
	if state.Busy {
		for _, grant := range run.pendingDirectoryGrants {
			configuring = configuring || grant.ID == v.ID
		}
	}
	run.mu.Unlock()
	if configured.id == v.ID && configured.access == v.Access && configured.updatedAt == v.UpdatedAt {
		v.Status = "ready"
	} else if configError != "" && provider == model.ProviderCodex {
		v.Status, v.Error = "error", configError
	} else if configuring && provider == model.ProviderCodex {
		v.Status = "configuring"
	}
	if baselineOK && (state.Busy || final) {
		if !final {
			after = collectDirectorySnapshot(ctx, v.Directory)
		}
		if baseline.err != "" || after.err != "" {
			v.Warning = strings.TrimSpace(strings.Join([]string{v.Warning, baseline.err, after.err}, " "))
		} else {
			v.Observed = changedSince(baseline, after)
		}
	}
	attributed := map[string]bool{}
	for _, e := range entries {
		if e.Cwd != "" && (platform.SameWorkspacePath(v.Directory, e.Cwd) || platform.Within(v.Directory, e.Cwd)) {
			v.Activities = append(v.Activities, e)
		}
		if e.Kind != "change" || e.Status != "completed" {
			continue
		}
		for _, f := range e.FileChanges {
			if path := f.Path; platform.AbsoluteWorkspacePath(path) && platform.Within(v.Directory, path) {
				attributed[path] = true
			}
		}
	}
	for path := range attributed {
		v.Attributed = append(v.Attributed, path)
	}
	sort.Strings(v.Attributed)
}
