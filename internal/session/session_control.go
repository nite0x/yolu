package session

import "sync"

type sessionControlLock struct {
	mu   sync.Mutex
	refs int
}

// Control operations share the cleanup gate, but only serialize with operations
// on the same session or creation receipt. Worktree removal takes the gate's
// exclusive side before checking occupancy and keeps it until removal ends.
// Lock order: cleanup gate -> control key -> workspace metadata -> runtime state.
func (a *Service) lockControl(key string) func() {
	a.controlMu.RLock()
	release := a.lockControlKey(key)
	return func() {
		release()
		a.controlMu.RUnlock()
	}
}

// Callers already holding the cleanup gate use this when a newly created
// thread gains its ID. Do not recursively take an RWMutex read lock: a queued
// cleanup writer could otherwise deadlock the creator before it can finish.
func (a *Service) lockControlKey(key string) func() {
	a.controlLocksMu.Lock()
	if a.controlLocks == nil {
		a.controlLocks = make(map[string]*sessionControlLock)
	}
	entry := a.controlLocks[key]
	if entry == nil {
		entry = &sessionControlLock{}
		a.controlLocks[key] = entry
	}
	entry.refs++
	a.controlLocksMu.Unlock()
	entry.mu.Lock()
	return func() {
		entry.mu.Unlock()
		a.controlLocksMu.Lock()
		entry.refs--
		if entry.refs == 0 {
			delete(a.controlLocks, key)
		}
		a.controlLocksMu.Unlock()
	}
}

func (a *Service) lockSessionControl(id string) func() {
	return a.lockControl("session:" + id)
}
