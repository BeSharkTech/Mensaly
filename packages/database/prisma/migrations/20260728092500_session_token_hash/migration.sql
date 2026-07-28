-- Session tokens are bearer credentials. Persist only their SHA-256 digest so a
-- database read cannot be used directly as an authenticated session.
ALTER TABLE "session" RENAME COLUMN "token" TO "tokenHash";
ALTER INDEX "session_token_key" RENAME TO "session_tokenHash_key";
