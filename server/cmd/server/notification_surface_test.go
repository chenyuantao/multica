package main

import "testing"

func TestNotificationSurface(t *testing.T) {
	cases := []struct {
		hasMembers bool
		origin     string
		want       string
	}{
		{hasMembers: false, origin: "", want: ""},
		{hasMembers: true, origin: "", want: "im"},
		{hasMembers: true, origin: "autopilot", want: "im"},
		{hasMembers: true, origin: "reminder", want: "reminder"},
	}
	for _, tc := range cases {
		if got := notificationSurface(tc.hasMembers, tc.origin); got != tc.want {
			t.Fatalf("notificationSurface(%v, %q) = %q, want %q", tc.hasMembers, tc.origin, got, tc.want)
		}
	}
}
