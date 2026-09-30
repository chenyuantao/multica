package handler

import (
	"context"
	"net/http"
	"slices"
	"testing"

	"github.com/multica-ai/multica/server/internal/testutil"
)

func TestUnusedRuntimeCleanup(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()

	setOffline := func(runtimeID string) {
		t.Helper()
		if _, err := testPool.Exec(ctx, `UPDATE agent_runtime SET status = 'offline' WHERE id = $1`, runtimeID); err != nil {
			t.Fatalf("mark runtime offline: %v", err)
		}
	}

	idle := createCascadeFixtureRuntime(t, ctx, "Unused Idle Runtime")
	setOffline(idle)

	withArchived := createCascadeFixtureRuntime(t, ctx, "Unused Runtime With Archived Agent")
	setOffline(withArchived)
	archivedAgentID := dbfx.Agent(t, "Unused Runtime Archived Agent", withArchived, testutil.Cols{
		"archived_at": testutil.Raw("now()"),
	})

	withActive := createCascadeFixtureRuntime(t, ctx, "Runtime With Active Agent")
	setOffline(withActive)
	createCascadeFixtureAgent(t, ctx, withActive, "Runtime Active Agent")

	online := createCascadeFixtureRuntime(t, ctx, "Online Runtime")

	profileBacked, _ := createProfileBackedRuntime(t, ctx, "Unused Profile Runtime")
	setOffline(profileBacked)

	var listed struct {
		Runtimes []AgentRuntimeResponse `json:"runtimes"`
	}
	testutil.Call(t, testHandler.ListUnusedAgentRuntimes, newRequest(http.MethodGet, "/api/runtimes/unused", nil)).
		Want(http.StatusOK).JSON(&listed)
	listedIDs := make([]string, len(listed.Runtimes))
	for i, rt := range listed.Runtimes {
		listedIDs[i] = rt.ID
	}
	for _, want := range []string{idle, withArchived} {
		if !slices.Contains(listedIDs, want) {
			t.Fatalf("unused list %v is missing %s", listedIDs, want)
		}
	}
	for _, blocked := range []string{withActive, online, profileBacked} {
		if slices.Contains(listedIDs, blocked) {
			t.Fatalf("unused list %v includes runtime %s that is still in use", listedIDs, blocked)
		}
	}

	// A stale client may submit runtimes that stopped qualifying; the server
	// skips them instead of cascading.
	var deleted struct {
		DeletedIDs []string `json:"deleted_ids"`
		SkippedIDs []string `json:"skipped_ids"`
	}
	testutil.Call(t, testHandler.DeleteUnusedAgentRuntimes, newRequest(http.MethodPost, "/api/runtimes/unused/delete", map[string]any{
		"runtime_ids": []string{idle, withArchived, withActive, online, profileBacked},
	})).Want(http.StatusOK).JSON(&deleted)

	slices.Sort(deleted.DeletedIDs)
	wantDeleted := []string{idle, withArchived}
	slices.Sort(wantDeleted)
	if !slices.Equal(deleted.DeletedIDs, wantDeleted) {
		t.Fatalf("deleted_ids = %v, want %v", deleted.DeletedIDs, wantDeleted)
	}
	slices.Sort(deleted.SkippedIDs)
	wantSkipped := []string{withActive, online, profileBacked}
	slices.Sort(wantSkipped)
	if !slices.Equal(deleted.SkippedIDs, wantSkipped) {
		t.Fatalf("skipped_ids = %v, want %v", deleted.SkippedIDs, wantSkipped)
	}

	var remaining int
	if err := testPool.QueryRow(ctx, `SELECT count(*) FROM agent_runtime WHERE id = ANY($1::uuid[])`,
		[]string{idle, withArchived, withActive, online, profileBacked}).Scan(&remaining); err != nil {
		t.Fatalf("count runtimes: %v", err)
	}
	if remaining != 3 {
		t.Fatalf("remaining runtimes = %d, want 3", remaining)
	}

	var archivedRuntime *string
	if err := testPool.QueryRow(ctx, `SELECT runtime_id::text FROM agent WHERE id = $1`, archivedAgentID).Scan(&archivedRuntime); err != nil {
		t.Fatalf("archived agent should survive the cleanup: %v", err)
	}
	if archivedRuntime != nil {
		t.Fatalf("archived agent runtime_id = %q, want unbound", *archivedRuntime)
	}
}

func TestDeleteUnusedAgentRuntimesRejectsInvalidInput(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	for name, body := range map[string]map[string]any{
		"empty":     {"runtime_ids": []string{}},
		"malformed": {"runtime_ids": []string{"not-a-uuid"}},
	} {
		t.Run(name, func(t *testing.T) {
			testutil.Call(t, testHandler.DeleteUnusedAgentRuntimes, newRequest(http.MethodPost, "/api/runtimes/unused/delete", body)).
				Want(http.StatusBadRequest)
		})
	}
}
