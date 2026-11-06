-- Private display aliases for Lightning Address / payee node counterparties.
CREATE TABLE "CounterpartyAlias" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" VARCHAR(200) NOT NULL,
    "alias" VARCHAR(40) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CounterpartyAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CounterpartyAlias_userId_key_key" ON "CounterpartyAlias"("userId", "key");

CREATE INDEX "CounterpartyAlias_userId_idx" ON "CounterpartyAlias"("userId");

ALTER TABLE "CounterpartyAlias" ADD CONSTRAINT "CounterpartyAlias_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
