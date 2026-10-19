CREATE TABLE "TransactionTag" (
  "userId" TEXT NOT NULL,
  "label" VARCHAR(100) NOT NULL,
  CONSTRAINT "TransactionTag_pkey" PRIMARY KEY ("userId", "label"),
  CONSTRAINT "TransactionTag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "TransactionTag" ("userId", "label")
SELECT DISTINCT "userId", "label" FROM "TransactionLabel";

ALTER TABLE "TransactionLabel" ADD CONSTRAINT "TransactionLabel_userId_label_fkey"
  FOREIGN KEY ("userId", "label") REFERENCES "TransactionTag"("userId", "label") ON DELETE RESTRICT ON UPDATE CASCADE;
