//go:build yolu_engram_core

// This entry point is compiled inside the pinned upstream Engram module.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/Gentleman-Programming/engram/v3/internal/store"
)

const (
	protocolVersion = 1
	maxRequestBytes = 1 << 20
	maxSearchLimit  = 20
)

var upstreamVersion string // Set by the packaging script.

type request struct {
	Version     int    `json:"version"`
	Operation   string `json:"operation"`
	Project     string `json:"project"`
	Query       string `json:"query,omitempty"`
	Limit       int    `json:"limit,omitempty"`
	SessionID   string `json:"session_id,omitempty"`
	OperationID string `json:"operation_id,omitempty"`
	Title       string `json:"title,omitempty"`
	Content     string `json:"content,omitempty"`
	Type        string `json:"type,omitempty"`
}

type failure struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type response struct {
	Version int      `json:"version"`
	Result  any      `json:"result,omitempty"`
	Error   *failure `json:"error,omitempty"`
}

type preview struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	Type      string `json:"type"`
	Preview   string `json:"preview"`
	Truncated bool   `json:"truncated"`
}

type searchResult struct {
	Matches []preview `json:"matches"`
}

type saveResult struct {
	ID       int64 `json:"id"`
	Replayed bool  `json:"replayed"`
}

func main() {
	flags := flag.NewFlagSet("engram-core", flag.ContinueOnError)
	dataDir := flags.String("data-dir", "", "absolute path to the memory store")
	version := flags.Bool("version", false, "print the protocol and upstream versions")
	if err := flags.Parse(os.Args[1:]); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return
		}
		os.Exit(2)
	}
	if flags.NArg() != 0 {
		fmt.Fprintln(os.Stderr, "engram-core expects one JSON request on stdin")
		os.Exit(2)
	}
	if *version {
		fmt.Printf("engram-core protocol %d (Engram %s)\n", protocolVersion, upstreamVersion)
		return
	}
	result, problem := handleRequest(context.Background(), *dataDir, os.Stdin)
	if err := json.NewEncoder(os.Stdout).Encode(response{Version: protocolVersion, Result: result, Error: problem}); err != nil {
		os.Exit(1)
	}
}

func readRequest(input io.Reader) (request, error) {
	var req request
	body, err := io.ReadAll(io.LimitReader(input, maxRequestBytes+1))
	if err != nil || len(body) > maxRequestBytes {
		return req, errors.New("request exceeds the input limit or could not be read")
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil || decoder.Decode(new(any)) != io.EOF {
		return req, errors.New("expected one valid JSON request")
	}
	if req.Version != protocolVersion {
		return req, errors.New("unsupported protocol version")
	}
	req.Project, err = store.ValidateExpectedProject(req.Project)
	if err != nil {
		return req, errors.New("a valid project is required")
	}
	switch req.Operation {
	case "search":
		if strings.TrimSpace(req.Query) == "" || req.Limit < 0 || req.Limit > maxSearchLimit {
			return req, errors.New("search requires a query and a limit between 0 and 20")
		}
	case "save":
		if strings.TrimSpace(req.SessionID) == "" || strings.TrimSpace(req.OperationID) == "" || strings.TrimSpace(req.Title) == "" || strings.TrimSpace(req.Content) == "" {
			return req, errors.New("save requires a session ID, operation ID, title and content")
		}
		if req.Type == "" {
			req.Type = "learning"
		}
	default:
		return req, errors.New("unknown memory operation")
	}
	return req, nil
}

func handleRequest(ctx context.Context, dataDir string, input io.Reader) (any, *failure) {
	req, err := readRequest(input)
	if err != nil {
		return nil, &failure{"invalid_request", err.Error()}
	}
	if !filepath.IsAbs(dataDir) {
		return nil, &failure{"invalid_request", "an absolute data directory is required"}
	}
	config, err := store.DefaultConfig()
	if err != nil {
		return nil, &failure{"store_unavailable", "Could not configure the memory store"}
	}
	config.DataDir = dataDir
	if req.Operation == "save" && len(req.Content) > config.MaxObservationLength {
		return nil, &failure{"invalid_request", "memory content exceeds the storage limit"}
	}
	if err := prepareSQLiteTemp(dataDir); err != nil {
		return nil, &failure{"store_unavailable", "Could not prepare the memory store directory"}
	}
	engine, err := store.NewWithContext(ctx, config)
	if err != nil {
		return nil, &failure{"store_unavailable", "Could not open the memory store"}
	}
	result, err := execute(ctx, engine, req)
	if closeErr := engine.Close(); err == nil {
		err = closeErr
	}
	switch {
	case err == nil:
		return result, nil
	case errors.Is(err, store.ErrObservationOperationConflict):
		return nil, &failure{"operation_conflict", "This operation ID already saved a different observation"}
	case errors.Is(err, store.ErrObservationOperationExpired):
		return nil, &failure{"operation_expired", "The original observation cannot be replayed"}
	case errors.Is(err, store.ErrObservationTitleRequired), errors.Is(err, store.ErrObservationContentRequired), errors.Is(err, store.ErrFTSQueryTooLarge):
		return nil, &failure{"invalid_request", "The query, title or content is invalid"}
	default:
		return nil, &failure{"store_error", "The memory operation failed"}
	}
}

func execute(ctx context.Context, engine *store.Store, req request) (any, error) {
	if req.Operation == "search" {
		results, err := engine.SearchPreviewsContext(ctx, req.Query, store.SearchOptions{
			Project: req.Project, Scope: "project", Limit: req.Limit,
		})
		if err != nil {
			return nil, err
		}
		matches := make([]preview, 0, len(results))
		for _, item := range results {
			matches = append(matches, preview{item.ID, item.Title, item.Type, item.Preview, item.Truncated})
		}
		return searchResult{Matches: matches}, nil
	}
	// Engram session identities and replay receipts are global to one store.
	// Project-qualified keys keep independent callers from sharing either.
	sessionKey := fmt.Sprintf("yolu-%x", sha256.Sum256([]byte(req.Project+"\x00"+req.SessionID)))
	operationKey := fmt.Sprintf("yolu-%x", sha256.Sum256([]byte(req.Project+"\x00"+req.OperationID)))
	sessionID, err := engine.RegisterIsolatedSession(sessionKey, req.Project, false)
	if err != nil {
		return nil, err
	}
	saved, err := engine.AddObservationWithResult(store.AddObservationParams{
		Project: req.Project, Scope: "project", SessionID: sessionID, OperationID: operationKey,
		Title: req.Title, Content: req.Content, Type: req.Type,
	})
	if err != nil {
		return nil, err
	}
	return saveResult{ID: saved.ID, Replayed: saved.Replayed}, nil
}

func prepareSQLiteTemp(dataDir string) error {
	if runtime.GOOS != "windows" {
		return nil
	}
	if err := store.ValidateDataDirectory(dataDir); err != nil {
		return err
	}
	dir := filepath.Join(dataDir, "tmp", "sqlite")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	// The short-lived worker sets SQLite's temp path for its own process only.
	return errors.Join(os.Setenv("TEMP", dir), os.Setenv("TMP", dir))
}
