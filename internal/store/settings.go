package store

import (
	"context"
	"database/sql"
	"errors"
)

func (s *Store) Setting(ctx context.Context, key string) (string, error) {
	return readSetting(ctx, s.DB, key)
}

func readSetting(ctx context.Context, db interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, key string) (value string, err error) {
	err = db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key=?`, key).Scan(&value)
	return
}

func (s *Store) SaveSetting(ctx context.Context, key, value string) error {
	return saveSetting(ctx, s.DB, key, value)
}

func saveSetting(ctx context.Context, db interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}, key, value string) error {
	_, err := db.ExecContext(ctx, `INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value)
	return err
}

// UpdateSetting reads, transforms and writes one preference in a local
// transaction. The callback only transforms the supplied value.
func (s *Store) UpdateSetting(ctx context.Context, key, fallback string, update func(string) (string, error)) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	value, err := readSetting(ctx, tx, key)
	if errors.Is(err, sql.ErrNoRows) && fallback != "" {
		value, err = readSetting(ctx, tx, fallback)
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	value, err = update(value)
	if err != nil {
		return err
	}
	if err := saveSetting(ctx, tx, key, value); err != nil {
		return err
	}
	return tx.Commit()
}
