-- Keep every transaction assignment; remove only the redundant saved-tag catalog.
ALTER TABLE "TransactionLabel" DROP CONSTRAINT "TransactionLabel_userId_label_fkey";
DROP TABLE "TransactionTag";
