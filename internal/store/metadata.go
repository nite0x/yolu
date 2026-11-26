package store

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"worktree-hub/internal/platform"
)

type metadataTable struct{ Name, Columns string }

// Explicit columns make import independent of platform and future additive
// schema migrations. No SQL identifiers supplied by a client are executed.
var metadataTables = []metadataTable{
	{"assistant_conversations", "id,title,created_at,updated_at"},
	{"assistant_runs", "id,conversation_id,input,status,error_code"},
	{"assistant_messages", "id,conversation_id,run_id,role,text"},
	{"assistant_action_plans", "id,conversation_id,run_id,status,payload,created_at,updated_at"},
	{"assistant_decisions", "conversation_id,request_id,plan_id,fingerprint"},
	{"assistant_tool_calls", "id,conversation_id,run_id,capability,status,result,created_at"},
	{"assistant_run_contexts", "conversation_id,run_id,context"},
	{"projects", "id,name,path,common_dir,folder,created_at"},
	{"settings", "key,value"},
	{"sessions", "id,name,cwd,created_at,updated_at,source,last_synced_at,additional_directories,title_source,title_changed_at,provider,bindings_managed,yolu_assistant"},
	{"session_project_bindings", "id,session_id,project_id,directory,directory_key,branch,role,access,created_at,updated_at"},
	{"migration_recovery", "id,kind,record_key,reason,payload"},
	{"session_organization", "session_id,pinned,archived,updated_at"},
	{"conversation_input_requests", "session_id,request_id,fingerprint,status"},
	{"conversation_async_answers", "session_id,item_id,turn_id,fingerprint,status,request_id"},
	{"conversation_drafts", "key,payload,updated_at"},
	{"conversation_create_requests", "request_id,fingerprint,session_id"},
}

type MetadataSnapshot struct {
	Tables map[string][][]any `json:"tables"`
}

func ExportMetadata(ctx context.Context, file string) (MetadataSnapshot, error) {
	snapshot := MetadataSnapshot{Tables: map[string][][]any{}}
	if file == "" {
		file = filepath.Join(platform.DefaultDataDir(), "worktree-hub.db")
	}
	if _, err := os.Stat(file); os.IsNotExist(err) {
		return snapshot, nil
	} else if err != nil {
		return snapshot, err
	}
	p := filepath.ToSlash(file)
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	u := &url.URL{Scheme: "file", Path: p}
	db, err := sql.Open("sqlite", u.String()+"?mode=ro")
	if err != nil {
		return snapshot, err
	}
	defer db.Close()
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return snapshot, err
	}
	defer tx.Rollback()
	for _, table := range metadataTables {
		columns, err := tableColumns(tx, table.Name)
		if err != nil {
			return snapshot, err
		}
		if len(columns) == 0 {
			continue
		}
		selects := strings.Split(table.Columns, ",")
		if table.Name == "sessions" {
			selects = selectMetadataColumns(selects, columns, map[string]string{
				"last_synced_at": "0", "additional_directories": "'[]'",
				"title_source":     "CASE WHEN name='' THEN '' ELSE 'legacy' END",
				"title_changed_at": "0", "provider": "'codex'", "bindings_managed": "0", "yolu_assistant": "0",
			})
		}
		rows, err := readMetadataRows(tx, table.Name, selects)
		if err != nil {
			return snapshot, err
		}
		snapshot.Tables[table.Name] = rows
	}
	legacy, err := readLegacyMetadata(tx)
	if err != nil {
		return snapshot, err
	}
	for name, rows := range legacy {
		snapshot.Tables[name] = rows
	}
	return snapshot, tx.Commit()
}

func selectMetadataColumns(wanted []string, available map[string]bool, substitutes map[string]string) []string {
	selects := make([]string, 0, len(wanted))
	for _, column := range wanted {
		if substitute := substitutes[column]; !available[column] && substitute != "" {
			column = substitute
		}
		selects = append(selects, column)
	}
	return selects
}

func readMetadataRows(tx *sql.Tx, table string, columns []string) ([][]any, error) {
	rows, err := tx.Query("SELECT " + strings.Join(columns, ",") + " FROM " + table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := [][]any{}
	for rows.Next() {
		values := make([]any, len(columns))
		dest := make([]any, len(columns))
		for i := range dest {
			dest[i] = &values[i]
		}
		if err := rows.Scan(dest...); err != nil {
			return nil, err
		}
		for i, v := range values {
			if b, ok := v.([]byte); ok {
				values[i] = string(b)
			}
		}
		out = append(out, values)
	}
	return out, rows.Err()
}

func (s *Store) ImportMetadata(snapshot MetadataSnapshot) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, name := range []string{"projects", "sessions", "assistant_conversations", "migration_recovery"} {
		var count int
		if err := tx.QueryRow("SELECT count(*) FROM " + name).Scan(&count); err != nil {
			return err
		}
		if count > 0 {
			return fmt.Errorf("目标环境已有项目或对话数据，不能覆盖导入")
		}
	}
	for _, table := range metadataTables {
		count := len(strings.Split(table.Columns, ","))
		placeholders := strings.TrimSuffix(strings.Repeat("?,", count), ",")
		for _, row := range snapshot.Tables[table.Name] {
			if table.Name == "sessions" {
				row = normalizeSessionMetadata(row)
			}
			if len(row) != count {
				return fmt.Errorf("导入数据结构不匹配：%s", table.Name)
			}
			if table.Name == "session_project_bindings" {
				directory := stringValue(row[3])
				if !platform.AbsoluteWorkspacePath(directory) {
					return fmt.Errorf("绑定目录必须是绝对路径：%s", directory)
				}
				row = append([]any{}, row...)
				row[4] = bindingDirectoryKey(directory)
			}
			if _, err := tx.Exec("INSERT INTO "+table.Name+"("+table.Columns+") VALUES("+placeholders+")", row...); err != nil {
				return fmt.Errorf("导入 %s 失败：%w", table.Name, err)
			}
		}
	}
	if _, err := tx.Exec(`UPDATE assistant_runs SET status='interrupted',error_code='interrupted' WHERE status='running'`); err != nil {
		return err
	}
	if err := interruptAssistantPlans(tx); err != nil {
		return err
	}
	// Older exports contain the session index but no directory bindings.
	// New exports contain the bindings table even when it is empty.
	if _, current := snapshot.Tables["session_project_bindings"]; !current {
		if err := convertLegacyBindings(tx, snapshot.Tables); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func normalizeSessionMetadata(row []any) []any {
	switch len(row) {
	case 8:
		source := "legacy"
		if row[1] == "" {
			source = ""
		}
		return append(append([]any{}, row...), source, int64(0), "codex", int64(0), int64(0))
	case 10:
		return append(append([]any{}, row...), "codex", int64(0), int64(0))
	case 11:
		return append(append([]any{}, row...), int64(0), int64(0))
	case 12:
		return append(append([]any{}, row...), int64(0))
	default:
		return row
	}
}
