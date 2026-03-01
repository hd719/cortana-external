package tonal

import (
	"errors"
	"testing"
)

func TestIsRetriableTonalError(t *testing.T) {
	if !isRetriableTonalError(&tonalAPIError{StatusCode: 500, Status: "500", Body: "x"}) {
		t.Fatalf("expected 500 to be retriable")
	}
	if isRetriableTonalError(&tonalAPIError{StatusCode: 429, Status: "429", Body: "x"}) {
		t.Fatalf("expected 429 to be non-retriable")
	}
	if isRetriableTonalError(&tonalAPIError{StatusCode: 400, Status: "400", Body: "x"}) {
		t.Fatalf("expected 400 to be non-retriable")
	}
	if !isRetriableTonalError(errors.New("connection reset by peer")) {
		t.Fatalf("expected network-like errors to be retriable")
	}
}
