-- Cap private transaction notes at 80 characters (was 280).
ALTER TABLE "TransactionNote"
    ALTER COLUMN "note" TYPE VARCHAR(80) USING LEFT("note", 80);
