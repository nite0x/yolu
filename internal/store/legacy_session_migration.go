package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"worktree-hub/internal/model"
	"worktree-hub/internal/platform"
)

const sessionBindingMigrationVersion = "session_project_bindings_v1"

var legacyWorkspaceTables = []struct {
	metadataTable
	older       string
	substitutes map[string]string
}{
	{metadataTable{"workspaces", "id,name,slug,description,branch,path,primary_project_id,state,created_at,has_directory"}, "requirements", map[string]string{"has_directory": "1"}},
	{metadataTable{"members", "workspace_id,project_id,path,base_commit,state,error,mode,base_ref,branch"}, "", map[string]string{
		"error": "''", "mode": "'new'", "base_ref": "'refs/heads/master'", "branch": "''",
	}},
	{metadataTable{"workspace_sessions", "workspace_id,session_id,name,cwd,created_at,updated_at,source"}, "requirement_sessions", nil},
	{metadataTable{"workspace_session_pins", "workspace_id,session_id"}, "task_session_pins", nil},
	{metadataTable{"session_create_requests", "workspace_id,request_id,session_id"}, "", nil},
}

func readLegacyMetadata(tx *sql.Tx) (map[string][][]any, error) {
	legacy := map[string][][]any{}
	for _, table := range legacyWorkspaceTables {
		name := table.Name
		columns, err := tableColumns(tx, name)
		if err != nil {
			return nil, err
		}
		if table.older != "" {
			older, err := tableColumns(tx, table.older)
			if err != nil {
				return nil, err
			}
			if len(columns) != 0 && len(older) != 0 {
				return nil, fmt.Errorf("both historical tables %s and %s exist; reconcile the saved records before upgrading", table.Name, table.older)
			}
			if len(older) != 0 {
				name, columns = table.older, older
			}
		}
		if len(columns) == 0 {
			continue
		}
		selects := selectMetadataColumns(strings.Split(table.Columns, ","), columns, table.substitutes)
		for i, col := range selects {
			switch {
			case col == "workspace_id" && !columns[col] && columns["requirement_id"]:
				selects[i] = "requirement_id"
			case col == "1" && columns["has_workspace"]:
				selects[i] = "has_workspace"
			}
		}
		rows, err := readMetadataRows(tx, name, selects)
		if err != nil {
			return nil, err
		}
		legacy[table.Name] = rows
	}
	return legacy, nil
}

func migrateSessionBindings(tx *sql.Tx) error {
	if _, err := tx.Exec(sessionBindingSchema); err != nil {
		return err
	}
	var migrated int
	if err := tx.QueryRow(`SELECT count(*) FROM schema_migrations WHERE version=?`, sessionBindingMigrationVersion).Scan(&migrated); err != nil {
		return err
	}
	if migrated > 0 {
		return nil
	}
	legacy, err := readLegacyMetadata(tx)
	if err != nil {
		return err
	}
	if err := convertLegacyBindings(tx, legacy); err != nil {
		return fmt.Errorf("migrate conversation directories: %w", err)
	}
	if _, err := tx.Exec(`DROP TABLE IF EXISTS session_create_requests;
DROP TABLE IF EXISTS workspace_session_pins;
DROP TABLE IF EXISTS task_session_pins;
DROP TABLE IF EXISTS workspace_sessions;
DROP TABLE IF EXISTS requirement_sessions;
DROP TABLE IF EXISTS members;
DROP TABLE IF EXISTS workspaces;
DROP TABLE IF EXISTS requirements;`); err != nil {
		return err
	}
	_, err = tx.Exec(`INSERT INTO schema_migrations(version) VALUES(?)`, sessionBindingMigrationVersion)
	return err
}

type legacyGroup struct {
	id, path, branch, primary string
	hasDirectory              bool
	issue                     string
	row                       []any
	members                   []model.SessionProjectBinding
	associated                bool
}

type legacyBindingMigration struct {
	tx           *sql.Tx
	legacy       map[string][][]any
	projects     map[string]string
	projectPaths map[string]string
	groups       map[string]*legacyGroup
	directories  map[string][]string
	resolved     map[string]migrationDirectory
	links        map[string][]string
}

type migrationDirectory struct{ path, issue string }

func convertLegacyBindings(tx *sql.Tx, legacy map[string][][]any) error {
	m := legacyBindingMigration{
		tx: tx, legacy: legacy,
		projects: map[string]string{}, projectPaths: map[string]string{},
		groups: map[string]*legacyGroup{}, directories: map[string][]string{},
		resolved: map[string]migrationDirectory{}, links: map[string][]string{},
	}
	if err := m.loadProjects(); err != nil {
		return err
	}
	if err := m.loadGroups(); err != nil {
		return err
	}
	if err := m.loadMembers(); err != nil {
		return err
	}
	if err := m.loadLinks(); err != nil {
		return err
	}
	if err := m.migrateIndexedSessions(); err != nil {
		return err
	}
	for _, group := range m.groups {
		reason := group.issue
		if !group.associated {
			if reason != "" {
				reason += ". "
			}
			reason += "no indexed conversation matched this context"
		}
		if err := m.saveRecovery("legacy_context", []string{group.id}, reason, "workspaces", group.row); err != nil {
			return err
		}
	}
	return nil
}

func stringValue(v any) string {
	if v, ok := v.(string); ok {
		return v
	}
	return ""
}

func (m *legacyBindingMigration) resolve(raw string) migrationDirectory {
	if d, cached := m.resolved[raw]; cached {
		return d
	}
	d := migrationDirectory{}
	if !platform.AbsoluteWorkspacePath(raw) {
		d.issue = "directory is empty or relative"
	} else {
		d.path = platform.CleanWorkspacePath(raw)
		// A Linux path in a Windows-hosted database belongs to WSL. Its
		// environment agent validates the real path when the session opens.
		if runtime.GOOS != "windows" || !strings.HasPrefix(d.path, "/") {
			resolved, err := filepath.EvalSymlinks(d.path)
			if err == nil {
				if info, statErr := os.Stat(resolved); statErr == nil && info.IsDir() {
					d.path = resolved
				} else {
					d.issue = "saved path is not a directory"
				}
			} else {
				d.issue = "saved directory could not be resolved"
			}
		}
	}
	m.resolved[raw] = d
	return d
}

func (m *legacyBindingMigration) loadProjects() error {
	rows, err := m.tx.Query(`SELECT id,path FROM projects ORDER BY id`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id, path string
		if err := rows.Scan(&id, &path); err != nil {
			return err
		}
		m.projects[id] = path
		if d := m.resolve(path); d.path != "" {
			key := bindingDirectoryKey(d.path)
			if _, exists := m.projectPaths[key]; !exists {
				m.projectPaths[key] = id
			}
		}
	}
	return rows.Err()
}

func (m *legacyBindingMigration) loadGroups() error {
	for _, row := range m.legacy["workspaces"] {
		if len(row) == 9 {
			row = append(append([]any{}, row...), int64(1))
		}
		if len(row) != 10 {
			return fmt.Errorf("invalid historical context row")
		}
		group := &legacyGroup{
			id: stringValue(row[0]), branch: stringValue(row[4]),
			primary: stringValue(row[6]), hasDirectory: row[9] == true || fmt.Sprint(row[9]) == "1", row: row,
		}
		if group.hasDirectory {
			directory := m.resolve(stringValue(row[5]))
			group.path, group.issue = directory.path, directory.issue
			m.indexGroupDirectory(group.id, group.path)
		}
		m.groups[group.id] = group
	}
	return nil
}

func (m *legacyBindingMigration) indexGroupDirectory(groupID, path string) {
	if path != "" {
		key := bindingDirectoryKey(path)
		m.directories[key] = append(m.directories[key], groupID)
	}
}

func (m *legacyBindingMigration) loadMembers() error {
	for _, row := range m.legacy["members"] {
		if len(row) == 6 {
			row = append(append([]any{}, row...), "new", "refs/heads/master", "")
		}
		if len(row) != 9 {
			return fmt.Errorf("invalid historical project context row")
		}
		groupID, projectID := stringValue(row[0]), stringValue(row[1])
		directory := m.resolve(stringValue(row[2]))
		group := m.groups[groupID]
		reason := directory.issue
		switch {
		case group == nil:
			reason = "historical context is missing"
		case m.projects[projectID] == "":
			reason = "registered project is missing"
		}
		if group != nil && directory.path != "" {
			branch := stringValue(row[8])
			if branch == "" && stringValue(row[6]) == "new" {
				branch = group.branch
			}
			registered := projectID
			if _, exists := m.projects[registered]; !exists {
				registered = ""
			}
			group.members = append(group.members, model.SessionProjectBinding{ProjectID: registered, Directory: directory.path, Branch: branch})
			m.indexGroupDirectory(groupID, directory.path)
		}
		if err := m.saveRecovery("legacy_project_context", []string{groupID, projectID}, reason, "members", row); err != nil {
			return err
		}
	}
	for _, group := range m.groups {
		sort.SliceStable(group.members, func(i, j int) bool {
			a, b := group.members[i], group.members[j]
			if (a.ProjectID == group.primary) != (b.ProjectID == group.primary) {
				return a.ProjectID == group.primary
			}
			if a.ProjectID != b.ProjectID {
				return a.ProjectID < b.ProjectID
			}
			return a.Directory < b.Directory
		})
	}
	return nil
}

func (m *legacyBindingMigration) link(groupID, id string) string {
	if m.groups[groupID] == nil {
		return "historical context is missing"
	}
	if id == "" {
		return "conversation was never indexed"
	}
	m.links[id] = append(m.links[id], groupID)
	return ""
}

func (m *legacyBindingMigration) loadLinks() error {
	sessions := append([][]any{}, m.legacy["workspace_sessions"]...)
	for _, row := range sessions {
		if len(row) != 7 {
			return fmt.Errorf("invalid historical conversation row")
		}
	}
	// The same provider conversation may have been indexed several times.
	// Keep its latest saved metadata when the independent index is missing.
	sort.SliceStable(sessions, func(i, j int) bool {
		if legacyTimestamp(sessions[i][5]) != legacyTimestamp(sessions[j][5]) {
			return legacyTimestamp(sessions[i][5]) > legacyTimestamp(sessions[j][5])
		}
		return stringValue(sessions[i][0]) < stringValue(sessions[j][0])
	})
	for _, row := range sessions {
		groupID, id, name := stringValue(row[0]), stringValue(row[1]), stringValue(row[2])
		reason := m.link(groupID, id)
		if id != "" {
			titleSource := ""
			if name != "" {
				titleSource = "legacy"
			}
			if _, err := m.tx.Exec(`INSERT INTO sessions(id,name,cwd,created_at,updated_at,source,title_source)
 VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`, id, name, stringValue(row[3]), legacyTimestamp(row[4]), legacyTimestamp(row[5]), stringValue(row[6]), titleSource); err != nil {
				return err
			}
		}
		if err := m.saveRecovery("legacy_conversation", []string{groupID, id}, reason, "workspace_sessions", row); err != nil {
			return err
		}
	}
	for _, row := range m.legacy["workspace_session_pins"] {
		if len(row) != 2 {
			return fmt.Errorf("invalid historical conversation link")
		}
		groupID, id := stringValue(row[0]), stringValue(row[1])
		if err := m.saveLegacyLink("legacy_conversation_link", "workspace_session_pins", groupID, id, id, row); err != nil {
			return err
		}
	}
	for _, row := range m.legacy["session_create_requests"] {
		if len(row) != 3 {
			return fmt.Errorf("invalid historical conversation creation request")
		}
		groupID, requestID, id := stringValue(row[0]), stringValue(row[1]), stringValue(row[2])
		if err := m.saveLegacyLink("legacy_conversation_request", "session_create_requests", groupID, requestID, id, row); err != nil {
			return err
		}
	}
	return nil
}

func legacyTimestamp(v any) int64 {
	switch v := v.(type) {
	case int64:
		return v
	case int:
		return int64(v)
	case float64:
		return int64(v)
	default:
		return 0
	}
}

func (m *legacyBindingMigration) saveLegacyLink(kind, table, groupID, key, id string, row []any) error {
	var exists bool
	if err := m.tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM sessions WHERE id=?)`, id).Scan(&exists); err != nil {
		return err
	}
	reason := "conversation was never indexed"
	if exists {
		reason = m.link(groupID, id)
	}
	return m.saveRecovery(kind, []string{groupID, key}, reason, table, row)
}

func (m *legacyBindingMigration) migrateIndexedSessions() error {
	rows, err := m.tx.Query(`SELECT id,cwd,additional_directories,created_at,updated_at FROM sessions WHERE bindings_managed=0 ORDER BY id`)
	if err != nil {
		return err
	}
	type indexedSession struct {
		id, cwd, directories string
		createdAt, updatedAt int64
	}
	var sessions []indexedSession
	for rows.Next() {
		var v indexedSession
		if err := rows.Scan(&v.id, &v.cwd, &v.directories, &v.createdAt, &v.updatedAt); err != nil {
			rows.Close()
			return err
		}
		sessions = append(sessions, v)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, v := range sessions {
		bindings, err := m.bindingsForSession(v.id, v.cwd, v.directories)
		if err != nil {
			return err
		}
		if len(bindings) == 0 {
			continue
		}
		for _, b := range bindings {
			b.ID, b.SessionID, b.CreatedAt, b.UpdatedAt = model.NewID(), v.id, legacyMillis(v.createdAt), legacyMillis(v.updatedAt)
			if err := insertSessionBinding(m.tx, b); err != nil {
				return err
			}
		}
		if err := markSessionBindingsManaged(m.tx, v.id); err != nil {
			return err
		}
	}
	return nil
}

func legacyMillis(v int64) int64 {
	// Provider timestamps were seconds. Preserve milliseconds if a provider
	// already recorded timestamps at that precision.
	if v > 0 && v < 100000000000 {
		return v * 1000
	}
	return v
}

func (m *legacyBindingMigration) bindingsForSession(id, originalCWD, savedDirectories string) ([]model.SessionProjectBinding, error) {
	cwd := m.resolve(originalCWD)
	cwdKey := bindingDirectoryKey(cwd.path)
	var rawDirectories []string
	if err := json.Unmarshal([]byte(savedDirectories), &rawDirectories); err != nil {
		// The legacy directory column is provider metadata. Its invalid value
		// must not prevent the session index or history from opening.
		if err := m.saveRecovery("legacy_provider_directories", []string{id}, "directory list could not be decoded", "", []any{id, savedDirectories}); err != nil {
			return nil, err
		}
		if _, err := m.tx.Exec(`UPDATE sessions SET additional_directories='[]' WHERE id=?`, id); err != nil {
			return nil, err
		}
		rawDirectories = nil
	}
	writable := map[string]bool{}
	directories := []string{}
	hasRelativeDirectory := false
	for _, raw := range rawDirectories {
		d := m.resolve(raw)
		if d.issue != "" {
			if err := m.saveRecovery("legacy_provider_directory", []string{id, raw}, d.issue, "", []any{id, raw}); err != nil {
				return nil, err
			}
		}
		if d.path != "" {
			writable[bindingDirectoryKey(d.path)] = true
			directories = append(directories, d.path)
		} else {
			hasRelativeDirectory = true
		}
	}
	if hasRelativeDirectory {
		cleaned, err := json.Marshal(directories)
		if err != nil {
			return nil, err
		}
		if _, err := m.tx.Exec(`UPDATE sessions SET additional_directories=? WHERE id=?`, string(cleaned), id); err != nil {
			return nil, err
		}
	}
	groupIDs := append(append([]string{}, m.links[id]...), m.directories[cwdKey]...)
	// Use explicit links first, then stable directory-derived matches.
	sort.Strings(groupIDs[:len(m.links[id])])
	sort.Strings(groupIDs[len(m.links[id]):])
	groupsSeen := map[string]bool{}
	seen := map[string]bool{}
	var choices []model.SessionProjectBinding
	container := false
	add := func(b model.SessionProjectBinding) {
		key := bindingDirectoryKey(b.Directory)
		if seen[key] {
			return
		}
		seen[key] = true
		b.Role, b.Access = model.SessionBindingAdditional, model.SessionBindingRead
		if key == cwdKey || writable[key] {
			b.Access = model.SessionBindingWrite
		}
		choices = append(choices, b)
	}
	for _, groupID := range groupIDs {
		if groupsSeen[groupID] {
			continue
		}
		groupsSeen[groupID] = true
		group := m.groups[groupID]
		group.associated = true
		container = container || (group.hasDirectory && group.path != "" && bindingDirectoryKey(group.path) == cwdKey)
		for _, b := range group.members {
			add(b)
		}
	}
	if projectID := m.projectPaths[cwdKey]; projectID != "" {
		add(model.SessionProjectBinding{ProjectID: projectID, Directory: cwd.path})
	}
	if cwd.path != "" && !container && (len(groupsSeen) > 0 || len(directories) > 0) {
		add(model.SessionProjectBinding{Directory: cwd.path})
	}
	// A former shared parent stores its native CWD for history. Its member
	// directories are the conversation's individual access boundaries.
	for _, path := range directories {
		key := bindingDirectoryKey(path)
		if !container || key != cwdKey {
			add(model.SessionProjectBinding{ProjectID: m.projectPaths[key], Directory: path})
		}
	}
	if len(choices) > 0 {
		primary := 0
		for i, b := range choices {
			if bindingDirectoryKey(b.Directory) == cwdKey && b.ProjectID != "" {
				primary = i
				break
			}
		}
		choices[primary].Role = model.SessionBindingPrimary
	}
	return choices, nil
}

func (m *legacyBindingMigration) saveRecovery(kind string, ids []string, reason, table string, row []any) error {
	key, err := json.Marshal(ids)
	if err != nil {
		return err
	}
	var payload any = row
	for _, t := range legacyWorkspaceTables {
		if t.Name == table {
			record := map[string]any{}
			for i, column := range strings.Split(t.Columns, ",") {
				record[column] = row[i]
			}
			payload = record
			break
		}
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = m.tx.Exec(`INSERT INTO migration_recovery(id,kind,record_key,reason,payload) VALUES(?,?,?,?,?)
 ON CONFLICT(kind,record_key) DO NOTHING`, model.NewID(), kind, string(key), reason, string(raw))
	return err
}
