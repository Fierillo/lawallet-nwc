-- Widen display aliases without truncating existing values.
ALTER TABLE "CounterpartyAlias"
    ALTER COLUMN "alias" TYPE VARCHAR(80);
