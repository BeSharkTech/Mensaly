-- Mercado Pago may return OAuth public keys and scope grants that exceed the
-- original provider-specific limits. These are opaque provider values, so they
-- must not be truncated or rejected during a successful authorization.
ALTER TABLE "mercado_pago_connection"
  ALTER COLUMN "mercadoPagoUserId" TYPE TEXT,
  ALTER COLUMN "publicKey" TYPE TEXT,
  ALTER COLUMN "scopes" TYPE TEXT;
